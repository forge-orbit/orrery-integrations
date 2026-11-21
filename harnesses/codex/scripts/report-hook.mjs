#!/usr/bin/env node
// Codex CLI -> Orrery run reporting hook.
//
// Codex invokes command hooks with one JSON object on stdin. This script maps that object
// to Orrery's hook contract (`POST /api/runs/hook`, schema `orrery.run.hook.v1`) and exits.
// It is deliberately non-blocking: a hook that fails to reach Orrery must never stop the
// harness, print to stdout, or leak the API key. All diagnostics are opt-in and redacted;
// the key is read from the environment (or a local file) at run time and is never part of
// the request body, a log line, or a committed file.

import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "orrery.run.hook.v1";
export const HARNESS = "codex";

// Codex hook event -> Orrery run event. SessionStart covers both `startup` and `resume`:
// a resume reuses the native session id, and the service reactivates an ended run. Tool and
// prompt events are point-in-time observations (heartbeats), never leases. Subagent hooks
// keep the parent session id and carry child attribution in agent_id / agent_type.
const EVENT_MAP = {
  SessionStart: "run_started",
  SessionEnd: "run_ended",
  SubagentStart: "child_started",
  SubagentStop: "child_ended",
  PreToolUse: "run_heartbeat",
  PostToolUse: "run_heartbeat",
  UserPromptSubmit: "run_heartbeat",
  PermissionRequest: "run_heartbeat",
  Stop: "run_heartbeat",
  PreCompact: "run_heartbeat",
  PostCompact: "run_heartbeat",
  Interrupt: "run_heartbeat",
  PreModelRequest: "run_heartbeat",
  PostModelRequest: "run_heartbeat",
};

const MAX_STDIN_BYTES = 1024 * 1024;

/** Map a raw Codex hook event name to a RunEventType, or null when the event is ignored. */
export function mapEvent(hook) {
  const name = typeof hook?.hook_event_name === "string" ? hook.hook_event_name : "";
  return EVENT_MAP[name] ?? null;
}

function trimmedString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// Absent or blank metadata becomes null; the server stores null and the UI shows `unknown`.
// Never synthesise a model from a display name or from another run.
function nullableField(value) {
  return trimmedString(value);
}

/**
 * Build the exact REST body for one Codex hook event. Returns null when there is no run
 * identity to correlate (the contract requires a runKey), so such events are dropped rather
 * than collapsed into a shared "unknown" run.
 */
export function buildReport(hook, options = {}) {
  const event = mapEvent(hook);
  if (event === null) return null;
  const nativeSessionId = trimmedString(hook?.session_id);
  if (nativeSessionId === null) return null;

  const report = {
    schema: SCHEMA,
    event,
    runKey: { harness: HARNESS, nativeSessionId },
    model: nullableField(hook?.model),
    harnessVersion: nullableField(options.harnessVersion),
    at: options.at ?? new Date().toISOString(),
  };

  if (event === "child_started" || event === "child_ended") {
    report.agentId = nullableField(hook?.agent_id);
    report.agentType = nullableField(hook?.agent_type);
  }
  return report;
}

/** Remove credential-shaped substrings from anything we might write to a log or stderr. */
export function redact(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/orr_ak_[A-Za-z0-9_-]+/g, "orr_ak_<redacted>")
    .replace(/\b(?:sk|ghp|github_pat|xoxb)-[A-Za-z0-9_-]{8,}/g, "<redacted>")
    .replace(/(Authorization\s*[:=]\s*)"[^"]*"/gi, '$1"<redacted>"');
}

/** The API key comes from the process environment or a local file, never from the payload. */
export async function readKey() {
  const inline = trimmedString(process.env.ORRERY_API_KEY ?? process.env.ORRERY_AGENT_KEY);
  if (inline !== null) return inline;
  const file = trimmedString(process.env.ORRERY_API_KEY_FILE ?? process.env.ORRERY_AGENT_KEY_FILE);
  if (file === null) return null;
  try {
    return trimmedString(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function endpoint() {
  const base = trimmedString(process.env.ORRERY_URL) ?? "http://localhost:8080";
  return `${base.replace(/\/$/, "")}/api/runs/hook`;
}

/**
 * POST one report. Return true only on a 2xx. Every failure is swallowed: a hook must never
 * block the conversation, and the key must never appear in an error we might emit.
 */
export async function postReport(report, options = {}) {
  const key = options.key ?? (await readKey());
  if (key === null) return false;
  const timeoutMs = options.timeoutMs ?? Number(process.env.ORRERY_HOOK_TIMEOUT_MS ?? 3000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(report),
      signal: controller.signal,
    });
    await response.text(); // consume the body so the connection is released
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function trace(line) {
  const path = trimmedString(process.env.ORRERY_HOOK_TRACE);
  if (path === null) return;
  try {
    await appendFile(path, `${redact(line)}\n`, "utf8");
  } catch {
    // Tracing is best-effort and non-blocking too.
  }
}

export function readStdin() {
  return new Promise((resolvePromise) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      if (Buffer.byteLength(data) < MAX_STDIN_BYTES) data += chunk;
    });
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", () => resolvePromise(data));
  });
}

/** Entry point. Always resolves, always exits 0, and never writes to stdout. */
export async function main() {
  try {
    const raw = await readStdin();
    const hook = JSON.parse(raw);
    const report = buildReport(hook, { harnessVersion: process.env.ORRERY_CODEX_VERSION });
    if (report === null) return;
    const ok = await postReport(report);
    await trace(
      JSON.stringify({
        event: report.event,
        nativeSessionId: report.runKey.nativeSessionId,
        model: report.model,
        harnessVersion: report.harnessVersion,
        agentId: report.agentId ?? null,
        agentType: report.agentType ?? null,
        accepted: ok,
        at: report.at,
      }),
    );
    if (!ok && trimmedString(process.env.ORRERY_HOOK_DEBUG) !== null) {
      process.stderr.write(redact(`orrery hook: report failed for ${report.event}\n`));
    }
  } catch {
    // Malformed stdin, no key, network failure: all advisory. The harness continues.
  }
}

const invokedPath = trimmedString(process.argv[1]);
if (invokedPath !== null && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await main();
}
