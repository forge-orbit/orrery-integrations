// Unit tests for the Codex CLI run-reporting hook.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildReport, mapEvent, redact, SCHEMA } from "./report-hook.mjs";

const HOOK_PATH = fileURLToPath(new URL("./report-hook.mjs", import.meta.url));

const hook = (overrides = {}) => ({
  session_id: "01a1f6bc-75fa-7ca3-8ffa-232951c1e0eb",
  transcript_path: null,
  cwd: "/tmp",
  hook_event_name: "SessionStart",
  model: "gpt-6.2-sol",
  source: "startup",
  ...overrides,
});

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ORRERY_")) delete env[key];
  }
  return { ...env, ...overrides };
}

function runHook(input, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [HOOK_PATH], { env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", () => {
      clearTimeout(timer);
      done({ code: -1, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

test("session start maps to run_started with the contract run key", () => {
  const report = buildReport(hook(), { harnessVersion: "0.171.0" });
  assert.equal(report.schema, SCHEMA);
  assert.equal(report.event, "run_started");
  assert.deepEqual(report.runKey, {
    harness: "codex",
    nativeSessionId: "01a1f6bc-75fa-7ca3-8ffa-232951c1e0eb",
  });
  assert.equal(report.model, "gpt-6.2-sol");
  assert.equal(report.harnessVersion, "0.171.0");
  assert.ok(!Number.isNaN(Date.parse(report.at)));
});

test("a resumed session still starts the same run, not a new one", () => {
  const report = buildReport(hook({ source: "resume" }));
  assert.equal(mapEvent(hook({ source: "resume" })), "run_started");
  assert.equal(report.event, "run_started");
  assert.equal(report.runKey.nativeSessionId, "01a1f6bc-75fa-7ca3-8ffa-232951c1e0eb");
});

test("tool use and prompt events are heartbeats; session end ends the run", () => {
  for (const name of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"]) {
    assert.equal(mapEvent(hook({ hook_event_name: name })), "run_heartbeat", name);
  }
  assert.equal(mapEvent(hook({ hook_event_name: "SessionEnd" })), "run_ended");
  const ended = buildReport(hook({ hook_event_name: "SessionEnd" }));
  assert.equal(ended.event, "run_ended");
  assert.ok(!("agentId" in ended));
});

test("subagent events carry agent_id and agent_type on the parent run", () => {
  const started = buildReport(
    hook({ hook_event_name: "SubagentStart", agent_id: "01a1f6bd", agent_type: "default" }),
  );
  assert.equal(started.event, "child_started");
  assert.equal(started.runKey.nativeSessionId, "01a1f6bc-75fa-7ca3-8ffa-232951c1e0eb");
  assert.equal(started.agentId, "01a1f6bd");
  assert.equal(started.agentType, "default");

  const stopped = buildReport(
    hook({ hook_event_name: "SubagentStop", agent_id: "01a1f6bd", agent_type: "default" }),
  );
  assert.equal(stopped.event, "child_ended");
  assert.equal(stopped.agentId, "01a1f6bd");
  assert.equal(stopped.agentType, "default");
});

test("missing model and version stay null instead of being invented", () => {
  const bare = hook();
  delete bare.model;
  const report = buildReport(bare);
  assert.equal(report.model, null);
  assert.equal(report.harnessVersion, null);
});

test("events without a run identity are dropped, never merged", () => {
  assert.equal(mapEvent(hook({ hook_event_name: "Unknown" })), null);
  assert.equal(buildReport(hook({ hook_event_name: "Unknown" })), null);
  assert.equal(buildReport(hook({ session_id: "" })), null);
  assert.equal(buildReport(hook({ session_id: "   " })), null);
});

test("redact removes credential-shaped values from diagnostics", () => {
  assert.equal(
    redact("Authorization: Bearer orr_ak_abc123XYZ_-99"),
    "Authorization: Bearer <redacted>",
  );
  assert.equal(redact("key=orr_ak_abc123XYZ_-99"), "key=orr_ak_<redacted>");
  assert.equal(redact("token sk-abcdefgh1234"), "token <redacted>");
  assert.equal(redact('Authorization: "secret-value"'), 'Authorization: "<redacted>"');
});

test("the child process POSTs the mapped body with bearer auth and no stdout", async () => {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(body),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"runId":"run_1","accepted":true}');
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  try {
    const env = cleanEnv({
      ORRERY_URL: `http://127.0.0.1:${port}`,
      ORRERY_API_KEY: "orr_ak_testsecret",
      ORRERY_CODEX_VERSION: "0.171.0",
    });
    const result = await runHook(JSON.stringify(hook()), env);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(received.length, 1);
    const request = received[0];
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/runs/hook");
    assert.equal(request.auth, "Bearer orr_ak_testsecret");
    assert.equal(request.body.schema, SCHEMA);
    assert.equal(request.body.event, "run_started");
    assert.deepEqual(request.body.runKey, {
      harness: "codex",
      nativeSessionId: "01a1f6bc-75fa-7ca3-8ffa-232951c1e0eb",
    });
    assert.equal(request.body.model, "gpt-6.2-sol");
    assert.equal(request.body.harnessVersion, "0.171.0");
    assert.ok(typeof request.body.at === "string");

    // With no key configured the hook makes no request but still exits cleanly.
    const keyless = await runHook(JSON.stringify(hook()), cleanEnv({ ORRERY_URL: env.ORRERY_URL }));
    assert.equal(keyless.code, 0);
    assert.equal(keyless.stdout, "");
    assert.equal(received.length, 1);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("an unreachable server or malformed input never blocks the harness", async () => {
  const unreachable = await runHook(
    JSON.stringify(hook()),
    cleanEnv({ ORRERY_URL: "http://127.0.0.1:1", ORRERY_AGENT_KEY: "orr_ak_testsecret" }),
  );
  assert.equal(unreachable.code, 0);
  assert.equal(unreachable.stdout, "");

  const malformed = await runHook("not json", cleanEnv({ ORRERY_AGENT_KEY: "orr_ak_testsecret" }));
  assert.equal(malformed.code, 0);
  assert.equal(malformed.stdout, "");
});
