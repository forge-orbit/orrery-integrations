// Claude Code hook that reports run lifecycle events to Orrery.
//
// Claude Code invokes this with one JSON object on stdin (hook_event_name, session_id,
// tool_name, ...). It maps that object onto the `orrery.run.hook.v1` contract and POSTs
// it to /api/runs/hook with the agent key in the Authorization header. Nothing is written
// to stdout: a hook must not change Claude Code's behaviour, and a failed report must
// never block a tool call.
//
// Configuration (environment, never committed):
//   ORRERY_URL              base URL, e.g. http://127.0.0.1:8080
//   ORRERY_API_KEY          the agent's API key secret (fallback: ORRERY_AGENT_KEY)
//   ORRERY_API_KEY_FILE     path to a file containing it (fallback: ORRERY_AGENT_KEY_FILE)
//   ORRERY_HOOK_TIMEOUT_MS  fetch timeout in ms (default 2000)
//   ORRERY_HOOK_DEBUG       "1" writes only an event name and HTTP status to stderr
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const HARNESS = "claude-code";
export const HOOK_SCHEMA = "orrery.run.hook.v1";

function text(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// Map one Claude Code hook payload onto the shared run-reporting contract. Only an
// allowlist of fields is copied. `transcript_path`, `tool_input`, `tool_response`,
// `prompt` and `last_assistant_message` are deliberately never read: private transcripts
// stay on the machine.
export function mapHookEvent(input, at = new Date().toISOString()) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const nativeSessionId = text(input.session_id);
  if (nativeSessionId === null) return null; // no correlation key: report nothing

  const agentId = text(input.agent_id);
  const agentType = text(input.agent_type);
  const name = text(input.hook_event_name) ?? "";

  let event;
  if (name === "SessionStart" || name === "UserPromptSubmit") {
    event = "run_started";
  } else if (name === "SessionEnd" || name === "Stop" || name === "SubagentStop") {
    // A Stop with child attribution ends the child; otherwise it ends the run.
    event = agentId !== null && name !== "SessionEnd" ? "child_ended" : "run_ended";
  } else if (agentId !== null) {
    event = "child_started";
  } else {
    // PreToolUse / PostToolUse are point-in-time observations, not a claim lease.
    event = "run_heartbeat";
  }

  return {
    schema: HOOK_SCHEMA,
    event,
    runKey: { harness: HARNESS, nativeSessionId },
    runId: null,
    model: text(input.model),
    harnessVersion: text(input.harness_version ?? input.version),
    agentId,
    agentType,
    at,
  };
}

async function apiKey(env) {
  const direct = text(env.ORRERY_API_KEY ?? env.ORRERY_AGENT_KEY);
  if (direct !== null) return direct;
  const file = text(env.ORRERY_API_KEY_FILE ?? env.ORRERY_AGENT_KEY_FILE);
  if (file === null) return null;
  try {
    return text(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readHookInput() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The whole hook is best-effort. Any failure is swallowed and the hook exits 0, so an
// unreachable or misconfigured Orrery never blocks Claude Code. Debug output contains
// only the event name and the HTTP status — never the body, key, or transcript path.
export async function run(env = process.env, fetchImpl = fetch, stdin = readHookInput) {
  try {
    const payload = mapHookEvent(stdin());
    if (payload === null) return;
    const base = text(env.ORRERY_URL);
    const key = await apiKey(env);
    if (base === null || key === null) return; // not configured: still a valid no-op hook

    const timeout = Number(env.ORRERY_HOOK_TIMEOUT_MS ?? "2000");
    const response = await fetchImpl(new URL("/api/runs/hook", base), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Number.isFinite(timeout) ? timeout : 2000),
    });
    if (env.ORRERY_HOOK_DEBUG === "1") {
      process.stderr.write(`orrery hook ${payload.event}: ${response.status}\n`);
    }
  } catch {
    // Non-blocking by design: a dropped report is preferable to a stuck tool call.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
