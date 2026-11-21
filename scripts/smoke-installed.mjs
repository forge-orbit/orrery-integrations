import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [workspaceId, projectId] = args;
const { ORRERY_URL, ORRERY_SMOKE_HUMAN_FILE } = process.env;
assert.ok(args.length === 2 && workspaceId && projectId && ORRERY_URL && ORRERY_SMOKE_HUMAN_FILE,
  "Set ORRERY_URL and ORRERY_SMOKE_HUMAN_FILE, then pass the disposable workspace and project IDs.");
const human = JSON.parse(await readFile(ORRERY_SMOKE_HUMAN_FILE, "utf8"));
const dir = await mkdtemp(join(tmpdir(), "orrery-package-"));
const market = `orrery-smoke-${randomUUID().slice(0, 8)}`;
const plugin = `orrery@${market}`;
const work = join(dir, "work");
const trace = join(dir, "codex-hooks.jsonl");
const pruneOriginal = ["-c", 'plugins."orrery@orrery".enabled=false'];

function cli(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: work, env, encoding: "utf8", timeout: 120_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed (${result.error?.code ?? result.status})`);
  }
  return result.stdout;
}

const parseLines = (body) => body.split("\n").filter((line) => line.startsWith("{")).map(JSON.parse);
let cookie;
async function api(path, body) {
  const response = await fetch(new URL(path, ORRERY_URL), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(response.ok, `${path} returned HTTP ${response.status}`);
  if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";", 1)[0];
  return response.json();
}

async function checkCodexMcp() {
  const child = spawn("codex", ["app-server", ...pruneOriginal], {
    cwd: work,
    stdio: ["pipe", "pipe", "ignore"],
    signal: AbortSignal.timeout(100_000),
  });
  child.on("error", () => {}); // Closing stdout causes the outstanding RPC assertion to fail.
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let sequence = 0;
  const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  async function rpc(method, params) {
    const id = ++sequence;
    send({ id, method, params });
    for (;;) {
      const next = await lines.next();
      assert.equal(next.done, false, `Codex app-server stopped during ${method}`);
      const event = JSON.parse(next.value);
      if (event.id !== id || event.method) continue;
      assert.ok(!event.error, `Codex app-server ${method}: ${event.error?.message}`);
      return event.result;
    }
  }
  try {
    await rpc("initialize", { clientInfo: { name: "orrery-package-smoke", version: "1" },
      capabilities: { experimentalApi: true } });
    send({ method: "initialized" });
    const { thread } = await rpc("thread/start", { cwd: work, ephemeral: true, sandbox: "read-only" });
    async function call(tool, args) {
      const result = await rpc("mcpServer/tool/call", {
        threadId: thread.id, server: "orrery", tool, arguments: args,
      });
      assert.ok(!result.isError, `Bundled Codex tool ${tool} returned an error`);
      return result.structuredContent;
    }
    const { projects } = await call("list_projects", { workspaceId });
    assert.ok(projects.some((project) => project.id === projectId), "Installed Codex MCP authenticated");
    const { issue } = await call("create_issue", { projectId, title: `Package smoke ${market}`, status: "todo" });
    const { runId } = await call("orrery_run_checkin", {
      event: "run_started", runKey: { harness: "codex", nativeSessionId: thread.id },
    });
    const { session } = await call("claim_issue", { issueId: issue.id, runId });
    const { question } = await call("ask_for_input", {
      issueId: issue.id, runId, question: "Which test color, blue or green?", proposedFallback: "Leave unchanged.",
    });
    assert.equal(question.status, "open");
    const waiting = call("orrery_wait_for_input", {
      issueId: issue.id, questionId: question.id, runId, sessionId: session.id,
    });
    const [humanAnswer, observed] = await Promise.all([
      sleep(1000).then(() => api(`/api/questions/${question.id}/answer`, { answer: "green" })),
      waiting,
    ]);
    assert.ok(humanAnswer.answeredByHumanId);
    assert.equal(observed.question.status, "answered");
    assert.equal(observed.question.answer, "green");
    const { resume } = await call("resume_work_session", { issueId: issue.id, runId });
    assert.equal(resume.session.id, session.id);
    await call("update_issue", { issueId: issue.id, body: "Installed plugin received green." });
    await call("stop_session", { issueId: issue.id, sessionId: session.id, outcome: "done" });
    const final = (await call("get_issue", { issueId: issue.id })).issue;
    assert.equal(final.status, "done");
    assert.equal(final.needsInput, false);
    assert.equal(final.body, "Installed plugin received green.");
    await call("orrery_run_checkin", { event: "run_ended", runKey: null, runId });
    console.log("Codex package authenticated, received a human reply, and completed its original claim.");
  } finally {
    child.stdin.end();
    child.kill();
  }
}

async function checkCodexHooks() {
  const events = parseLines(cli("codex", ["-a", "never", "-s", "read-only", ...pruneOriginal,
    "exec", "--ephemeral", "--json", "--skip-git-repo-check", "--dangerously-bypass-hook-trust",
    "Reply with OK. Do not call any tools."], { ...process.env, ORRERY_HOOK_TRACE: trace }));
  const thread = events.find((event) => event.type === "thread.started").thread_id;
  const reports = parseLines(await readFile(trace, "utf8"));
  assert.deepEqual(new Set(reports.filter((row) => row.accepted && row.nativeSessionId === thread)
    .map((row) => row.event)), new Set(["run_started", "run_heartbeat", "run_ended"]));
  console.log("Codex start, heartbeat, and end hooks reached Orrery.");
}

async function checkClaude() {
  const name = "mcp__plugin_orrery_orrery__list_projects";
  const events = parseLines(cli("claude", ["-p",
    `Call only ${name} for workspace ${workspaceId}. Then report the project names.`,
    "--output-format", "stream-json", "--verbose", "--tools", "", "--allowedTools", name]));
  const init = events.find((event) => event.type === "system" && event.subtype === "init");
  const content = events.flatMap((event) => event.message?.content ?? []);
  const call = content.find((block) => block.type === "tool_use" && block.name === name);
  const result = content.find((block) => block.type === "tool_result" && block.tool_use_id === call?.id);
  assert.ok(result && !result.is_error, "Expected successful tool call through installed Claude Code plugin");
  const projects = JSON.parse(typeof result.content === "string" ? result.content : result.content[0].text).projects;
  assert.ok(projects.some((project) => project.id === projectId), "Installed Claude Code MCP authenticated");
  const inventory = await api(`/api/workspaces/${workspaceId}/runs`);
  const run = (Array.isArray(inventory) ? inventory : inventory.runs)
    .find((row) => row.harness === "claude-code" && row.nativeSessionId === init.session_id);
  assert.equal(run?.status, "ended", "Claude Code lifecycle was stored");
  console.log("Claude Code package authenticated and reported an ended run.");
}

const cleanup = [];
try {
  await mkdir(work);
  for (const file of [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"]) {
    const config = JSON.parse(await readFile(file, "utf8"));
    const target = join(dir, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({ ...config, name: market }));
  }
  await cp("harnesses", join(dir, "harnesses"), { recursive: true });
  await api("/api/auth/login", human);
  cli("codex", ["plugin", "marketplace", "add", dir]);
  cleanup.push(["codex", ["plugin", "marketplace", "remove", market]]);
  cli("codex", ["plugin", "add", plugin]);
  cleanup.push(["codex", ["plugin", "remove", plugin]]);
  await checkCodexMcp();
  await checkCodexHooks();
  cli("claude", ["plugin", "marketplace", "add", dir]);
  cleanup.push(["claude", ["plugin", "marketplace", "remove", market]]);
  cli("claude", ["plugin", "install", plugin]);
  cleanup.push(["claude", ["plugin", "uninstall", plugin]]);
  await checkClaude();
} finally {
  for (const [command, args] of cleanup.reverse()) {
    try {
      cli(command, args);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
  await rm(dir, { recursive: true, force: true });
}
