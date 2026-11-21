import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const placements = ["before question read", "before claim inspection", "before renewal", "after renewal"];
const schedules = [
  { at: "none", owner: "same run" },
  ...placements.flatMap((at) => ["same run", "other run"].map((owner) => ({ at, owner }))),
];
const questionStatuses = ["open", "answered", "paused", "fallback_used"];
const bools = [false, true];
const original = { id: "original-session", runId: "requested-run" };

function scenarios() {
  const traces = new Map();
  for (const replacement of schedules) {
    for (const status of questionStatuses) {
      for (const ownQuestion of bools) {
        for (const stopRequested of bools) {
          for (const renewalDue of bools) {
            const issueId = `issue-${traces.size + 1}`;
            traces.set(issueId, {
              issueId, replacement, status, ownQuestion, stopRequested, renewalDue,
              current: original, questionReads: 0, renewals: [], steps: [],
            });
          }
        }
      }
    }
  }
  return traces;
}

function replaceAt(trace, at) {
  if (trace.replacement.at !== at) return;
  trace.current = {
    id: "replacement-session",
    runId: trace.replacement.owner === "same run" ? original.runId : "other-run",
  };
  trace.steps.push(`The server replaced the claim ${at} (${trace.replacement.owner}).`);
}

function dispatch(trace, tool, args) {
  switch (tool) {
    case "list_issue_questions": {
      if (trace.questionReads === 0) replaceAt(trace, "before question read");
      const status = trace.questionReads++ ? "answered" : trace.status;
      const runId = trace.ownQuestion ? original.runId : "other-run";
      trace.steps.push(`The bridge read a question with status ${status} for ${runId}.`);
      return { structuredContent: { questions: [{ id: "question", runId, status }] } };
    }
    case "resume_work_session": {
      replaceAt(trace, "before claim inspection");
      assert.equal(args.runId, original.runId, "The bridge must inspect the requesting run");
      const active = trace.current.runId === args.runId;
      trace.steps.push(`The server reported ${active ? trace.current.id : "an expired claim"}.`);
      const session = active ? {
        ...trace.current,
        stopRequested: trace.stopRequested,
        leaseExpiresAt: new Date(Date.now() + (trace.renewalDue ? 30_000 : 240_000)).toISOString(),
      } : { ...original };
      return { structuredContent: { resume: { disposition: active ? "active" : "expired", session } } };
    }
    case "renew_claim": {
      replaceAt(trace, "before renewal");
      // The Orrery server uses the optional session ID to fence delayed renewals.
      const accepted = args.sessionId === undefined || args.sessionId === trace.current.id;
      trace.renewals.push({ supplied: args.sessionId, accepted, target: trace.current.id });
      trace.steps.push(`The bridge sent ${args.sessionId ?? "no session ID"}. The server ${accepted ? "renewed" : "refused"} ${trace.current.id}.`);
      replaceAt(trace, "after renewal");
      return accepted
        ? { structuredContent: { session: { stopRequested: false } } }
        : { isError: true, structuredContent: { code: "session_required" } };
    }
    default:
      throw new Error(`Unexpected MCP call ${tool}`);
  }
}

async function check(adapter) {
  const traces = scenarios();
  const failures = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, "/mcp");
      assert.equal(request.headers.authorization, "Bearer bounded-check-key");
      let body = "";
      for await (const chunk of request) body += chunk;
      const call = JSON.parse(body);
      const { name, arguments: args } = call.params;
      const trace = traces.get(args.issueId);
      assert.ok(trace, "The bridge must keep the original issue ID");
      const result = dispatch(trace, name, args);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
    } catch (error) {
      failures.push(error.message);
      response.writeHead(500).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(process.execPath, [resolve(adapter)], {
    env: { ORRERY_URL: `http://127.0.0.1:${server.address().port}`, ORRERY_API_KEY: "bounded-check-key" },
    stdio: ["pipe", "pipe", "inherit"],
    signal: AbortSignal.timeout(30_000),
  });
  child.on("error", (error) => failures.push(error.message));
  child.stdin.on("error", (error) => failures.push(error.message));

  try {
    const ids = new Set(traces.keys());
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    for (const id of ids) {
      child.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id, method: "tools/call",
        params: { name: "orrery_wait_for_input", arguments: {
          issueId: id, questionId: "question", runId: original.runId, sessionId: original.id,
        } },
      }) + "\n");
    }
    while (ids.size) {
      const line = await lines.next();
      assert.equal(line.done, false, `Bridge exited with ${ids.size} traces unresolved`);
      const reply = JSON.parse(line.value);
      assert.ok(ids.delete(reply.id), `Unexpected response ID ${reply.id}`);
    }

    let renewed = 0;
    let fenced = 0;
    for (const trace of traces.values()) {
      const earlyReplacement = ["before question read", "before claim inspection"].includes(trace.replacement.at);
      const shouldAttempt = trace.status === "open" && trace.ownQuestion &&
        !trace.stopRequested && trace.renewalDue && !earlyReplacement;
      const invalidRenewal = trace.renewals.some(({ supplied, accepted, target }) =>
        supplied !== original.id || (accepted && target !== original.id));
      if (trace.renewals.length !== Number(shouldAttempt) || invalidRenewal) {
        failures.push([
          `${trace.issueId}: ${trace.replacement.at}, ${trace.replacement.owner}, ${trace.status}, own question=${trace.ownQuestion}, stop=${trace.stopRequested}, renewal due=${trace.renewalDue}`,
          ...trace.steps,
          `Expected ${Number(shouldAttempt)} renewal attempt with the original work-session ID.`,
        ].join("\n  "));
      }
      renewed += trace.renewals.filter(({ accepted }) => accepted).length;
      fenced += trace.renewals.filter(({ accepted }) => !accepted).length;
    }
    assert.ok(renewed > 0, "The bound must exercise an accepted renewal");
    if (failures.length) {
      throw new Error(`${failures.length} failing traces in ${adapter}\n${failures.slice(0, 4).join("\n")}`);
    }
    assert.ok(fenced > 0, "The bound must exercise a renewal refused by the server fence");
    console.log(`${adapter}: ${traces.size} traces passed, ${renewed} renewals accepted, ${fenced} stale renewals fenced.`);
  } finally {
    child.stdin.end();
    child.kill();
    server.closeAllConnections();
    server.close();
  }
}

const adapters = process.argv.slice(2);
if (!adapters.length) {
  adapters.push("harnesses/codex/scripts/mcp-stdio.mjs", "harnesses/claude-code/scripts/mcp-stdio.mjs");
}
for (const adapter of adapters) await check(adapter);
