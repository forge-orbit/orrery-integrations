// Unit tests for the Claude Code run-reporting hook.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HARNESS, HOOK_SCHEMA, mapHookEvent } from "./report-hook.mjs";

const hook = fileURLToPath(new URL("./report-hook.mjs", import.meta.url));
const AT = "2026-11-20T12:00:00.000Z";
const SESSION = "claude-session-01";

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ORRERY_")) delete env[key];
  }
  return { ...env, ...overrides };
}

async function call(input, env = {}) {
  const child = spawn(process.execPath, [hook], {
    env: cleanEnv(env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const closed = new Promise((resolve) => child.on("close", resolve));
  child.stdin.end(JSON.stringify(input));
  const code = await closed;
  assert.equal(code, 0, `hook must exit 0 (stderr: ${stderr})`);
  return stdout;
}

function capturedServer(t) {
  const received = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      received.push({ headers: request.headers, body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"accepted":true}');
    });
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return { server, received };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("SessionStart maps to run_started with a stable (harness, session) key", () => {
  const payload = mapHookEvent(
    { hook_event_name: "SessionStart", session_id: SESSION, source: "startup" },
    AT,
  );
  assert.deepEqual(payload, {
    schema: HOOK_SCHEMA,
    event: "run_started",
    runKey: { harness: HARNESS, nativeSessionId: SESSION },
    runId: null,
    model: null,
    harnessVersion: null,
    agentId: null,
    agentType: null,
    at: AT,
  });
});

test("tool events map to heartbeats and Stop ends the run", () => {
  const base = { session_id: SESSION, hook_event_name: "PreToolUse", tool_name: "Read" };
  assert.equal(mapHookEvent(base, AT).event, "run_heartbeat");
  assert.equal(
    mapHookEvent({ ...base, hook_event_name: "PostToolUse" }, AT).event,
    "run_heartbeat",
  );
  assert.equal(mapHookEvent({ ...base, hook_event_name: "Stop" }, AT).event, "run_ended");
  assert.equal(mapHookEvent({ ...base, hook_event_name: "SessionEnd" }, AT).event, "run_ended");
  assert.equal(
    mapHookEvent({ ...base, hook_event_name: "UserPromptSubmit" }, AT).event,
    "run_started",
  );
});

test("child tool events carry agent attribution on the parent run", () => {
  const child = {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    agent_id: "a0d5e888b4be56d01",
    agent_type: "general-purpose",
    tool_name: "mcp__orrery__list_projects",
  };
  const started = mapHookEvent(child, AT);
  assert.equal(started.event, "child_started");
  assert.equal(started.agentId, "a0d5e888b4be56d01");
  assert.equal(started.agentType, "general-purpose");
  assert.deepEqual(started.runKey, { harness: HARNESS, nativeSessionId: SESSION });
  assert.equal(
    mapHookEvent({ ...child, hook_event_name: "SubagentStop" }, AT).event,
    "child_ended",
  );
  assert.equal(mapHookEvent({ ...child, hook_event_name: "Stop" }, AT).event, "child_ended");
});

test("missing model and version stay null; a reported one is stored as given", () => {
  const input = { hook_event_name: "PostToolUse", session_id: SESSION };
  assert.equal(mapHookEvent(input, AT).model, null);
  assert.equal(mapHookEvent(input, AT).harnessVersion, null);
  assert.equal(mapHookEvent({ ...input, model: "claude-opus-5-5" }, AT).model, "claude-opus-5-5");
  assert.equal(
    mapHookEvent({ ...input, harness_version: "2.1.329" }, AT).harnessVersion,
    "2.1.329",
  );
});

test("a payload without a native session id is not reported", () => {
  assert.equal(mapHookEvent({ hook_event_name: "Stop" }, AT), null);
  assert.equal(mapHookEvent(null, AT), null);
  assert.equal(mapHookEvent([], AT), null);
});

test("the POST body is allowlisted: no transcript, tool input or prompt is copied", async (t) => {
  const { server, received } = capturedServer(t);
  const url = await listen(server);
  await call(
    {
      hook_event_name: "PostToolUse",
      session_id: SESSION,
      agent_id: "child-1",
      agent_type: "general-purpose",
      transcript_path: "/home/private/.claude/projects/secret-session.jsonl",
      tool_input: { prompt: "PRIVATE_TRANSCRIPT_MARKER" },
      tool_response: { content: "PRIVATE_TOOL_RESPONSE_MARKER" },
      prompt: "PRIVATE_PROMPT_MARKER",
      last_assistant_message: "PRIVATE_ANSWER_MARKER",
    },
    { ORRERY_URL: url, ORRERY_API_KEY: "unit-test-key-not-a-real-secret" },
  );
  assert.equal(received.length, 1);
  const sent = JSON.parse(received[0].body);
  assert.deepEqual(Object.keys(sent).toSorted(), [
    "agentId",
    "agentType",
    "at",
    "event",
    "harnessVersion",
    "model",
    "runId",
    "runKey",
    "schema",
  ]);
  assert.equal(sent.event, "child_started");
  assert.equal(sent.agentId, "child-1");
  assert.equal(received[0].headers.authorization, "Bearer unit-test-key-not-a-real-secret");
  for (const secret of [
    "PRIVATE_TRANSCRIPT_MARKER",
    "PRIVATE_TOOL_RESPONSE_MARKER",
    "PRIVATE_PROMPT_MARKER",
    "PRIVATE_ANSWER_MARKER",
    "/home/private",
    "unit-test-key-not-a-real-secret",
  ]) {
    assert.ok(!received[0].body.includes(secret), `${secret} leaked into the request body`);
  }
});

test("ORRERY_AGENT_KEY works as a fallback alias for ORRERY_API_KEY", async (t) => {
  const { server, received } = capturedServer(t);
  const url = await listen(server);
  await call(
    { hook_event_name: "SessionStart", session_id: SESSION },
    { ORRERY_URL: url, ORRERY_AGENT_KEY: "agent-key-alias-secret" },
  );
  assert.equal(received.length, 1);
  assert.equal(received[0].headers.authorization, "Bearer agent-key-alias-secret");
});

test("the key may come from a file and is still kept out of the body", async (t) => {
  const { server, received } = capturedServer(t);
  const url = await listen(server);
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orrery-hook-key-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, "key.txt");
  writeFileSync(keyFile, "file-key-not-a-real-secret\n");
  await call(
    { hook_event_name: "SessionStart", session_id: SESSION },
    { ORRERY_URL: url, ORRERY_API_KEY_FILE: keyFile },
  );
  assert.equal(received[0].headers.authorization, "Bearer file-key-not-a-real-secret");
  assert.ok(!received[0].body.includes("file-key-not-a-real-secret"));
});

test("an unreachable Orrery is non-blocking: exit 0, no stdout", async () => {
  const output = await call(
    { hook_event_name: "PostToolUse", session_id: SESSION },
    { ORRERY_URL: "http://127.0.0.1:1", ORRERY_API_KEY: "x", ORRERY_HOOK_TIMEOUT_MS: "250" },
  );
  assert.equal(output, "");
});

test("an unconfigured hook is a silent no-op with exit 0", async () => {
  const env = {
    ORRERY_URL: "",
    ORRERY_API_KEY: "",
    ORRERY_API_KEY_FILE: "/nonexistent/key",
  };
  assert.equal(await call({ hook_event_name: "Stop", session_id: SESSION }, env), "");
});
