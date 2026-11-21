import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const credential = "integration-test-agent-key";

async function withPlugin(t, harness, handler, env) {
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/mcp");
    assert.equal(request.headers.authorization, `Bearer ${credential}`);
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    const result = handler(rpc, request.headers);
    const payload = JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result });
    if (rpc.method === "initialize") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(payload);
    } else {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(`event: message\r\ndata: ${payload}\r\n\r\n`);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const root = fileURLToPath(new URL(`../harnesses/${harness}/`, import.meta.url));
  const config = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")).mcpServers.orrery;
  const args = config.args.map((arg) => arg.replace("${CLAUDE_PLUGIN_ROOT}", root.replace(/\/$/, "")));
  const child = spawn(config.command, args, {
    cwd: join(root, config.cwd ?? "."),
    env: {
      PATH: process.env.PATH,
      ORRERY_URL: `http://127.0.0.1:${server.address().port}`,
      ...env,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let id = 0;
  return async (method, params = {}) => {
    const currentId = ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: currentId, method, params }) + "\n");
    const line = await lines.next();
    assert.equal(line.done, false, "packaged MCP command should return a response");
    const result = JSON.parse(line.value);
    assert.equal(result.id, currentId);
    return result;
  };
}

for (const harness of ["codex", "claude-code"]) {
  test(`${harness} packaged transport authenticates with a key file`, { timeout: 10_000 }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "orrery-test-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const keyFile = join(dir, "agent.key");
    await writeFile(keyFile, credential + "\n", { mode: 0o600 });
    const call = await withPlugin(t, harness, (rpc, headers) => {
      if (rpc.method === "initialize") return { protocolVersion: "2025-06-18" };
      assert.equal(headers["mcp-protocol-version"], "2025-06-18");
      if (rpc.method === "tools/list") return { tools: [{ name: "list_projects" }] };
      assert.equal(rpc.params.name, "list_projects");
      assert.deepEqual(rpc.params.arguments, { workspaceId: "workspace" });
      return { content: [], structuredContent: { projects: [{ id: "project" }] } };
    }, { ORRERY_API_KEY_FILE: keyFile });

    assert.equal((await call("initialize")).result.protocolVersion, "2025-06-18");
    assert.deepEqual((await call("tools/list")).result.tools.map(({ name }) => name),
      ["list_projects", "orrery_wait_for_input"]);
    const result = await call("tools/call", {
      name: "list_projects",
      arguments: { workspaceId: "workspace" },
    });
    assert.deepEqual(result.result.structuredContent, { projects: [{ id: "project" }] });
  });
}

test("the installed wait tool renews only the matching claim and returns the inbox answer",
  { timeout: 10_000 }, async (t) => {
    const calls = [];
    const call = await withPlugin(t, "codex", (rpc) => {
      const { name, arguments: args } = rpc.params;
      calls.push(name);
      assert.equal(args.issueId, "issue");
      let structuredContent;
      if (name === "list_issue_questions") {
        const answered = calls.includes("renew_claim");
        structuredContent = {
          questions: [
            { id: "different", runId: "other", status: "answered", answer: "wrong" },
            { id: "question", runId: "run", status: answered ? "answered" : "open", answer: answered ? "green" : null },
          ],
        };
      } else if (name === "resume_work_session") {
        assert.equal(args.runId, "run");
        structuredContent = {
          resume: {
            disposition: "active",
            session: { id: "session", leaseExpiresAt: new Date(Date.now() + 20_000).toISOString() },
          },
        };
      } else {
        assert.equal(name, "renew_claim");
        assert.equal(args.sessionId, "session");
        structuredContent = { session: { id: "session", stopRequested: false } };
      }
      return { structuredContent };
    }, { ORRERY_AGENT_KEY: credential });

    const result = await call("tools/call", {
      name: "orrery_wait_for_input",
      arguments: { issueId: "issue", questionId: "question", runId: "run", sessionId: "session" },
    });
    assert.deepEqual(calls, ["list_issue_questions", "resume_work_session", "renew_claim", "list_issue_questions"]);
    assert.equal(result.result.structuredContent.question.answer, "green");
  });
