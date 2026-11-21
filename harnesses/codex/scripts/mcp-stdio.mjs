import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const waitTool = {
  name: "orrery_wait_for_input",
  description:
    "Wait up to 20 seconds for an Orrery inbox answer, renewing this run's active claim when needed. " +
    "Call again while status is open. An answered question contains the human's reply. " +
    "A paused question requires a human answer; fallback_used carries the authorized fallback.",
  inputSchema: {
    type: "object",
    properties: {
      issueId: { type: "string", minLength: 1 },
      questionId: { type: "string", minLength: 1 },
      runId: { type: "string", minLength: 1 },
      sessionId: { type: "string", minLength: 1 },
    },
    required: ["issueId", "questionId", "runId", "sessionId"],
  },
};

class BridgeError extends Error {}

async function readKey() {
  const secret = process.env.ORRERY_API_KEY?.trim() || process.env.ORRERY_AGENT_KEY?.trim();
  if (secret) return secret;
  const file = process.env.ORRERY_API_KEY_FILE?.trim() || process.env.ORRERY_AGENT_KEY_FILE?.trim();
  if (file) {
    try {
      const token = (await readFile(file, "utf8")).trim();
      if (token) return token;
    } catch {
      throw new BridgeError("Could not read the configured Orrery agent key file.");
    }
  }
  throw new BridgeError("Set ORRERY_API_KEY or ORRERY_API_KEY_FILE for the Orrery plugin.");
}

function mcpUrl() {
  const base = process.env.ORRERY_URL?.trim() || "http://localhost:8080";
  const url = URL.canParse(base) ? new URL(base) : null;
  if (!url || !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash) {
    throw new BridgeError("ORRERY_URL must be an HTTP or HTTPS base URL.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/mcp";
  return url;
}

function parseResponse(body, contentType, id) {
  if (contentType?.startsWith("application/json")) {
    const message = JSON.parse(body);
    if (message.id === id) return message;
  }

  // Orrery's stateless SSE response carries the JSON-RPC result in a data event.
  if (contentType?.startsWith("text/event-stream")) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      const message = JSON.parse(data);
      if (message.id === id) return message;
    }
  }
  throw new BridgeError("Orrery returned no matching MCP response.");
}

let protocolVersion;
async function forward(request, signal) {
  const headers = {
    Authorization: `Bearer ${await readKey()}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (protocolVersion) headers["MCP-Protocol-Version"] = protocolVersion;
  const response = await fetch(mcpUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new BridgeError(`Orrery MCP returned HTTP ${response.status}.`);
  }
  if (!Object.hasOwn(request, "id")) {
    await response.body?.cancel();
    return;
  }
  const message = parseResponse(await response.text(), response.headers.get("content-type"), request.id);
  if (request.method === "initialize") protocolVersion = message.result?.protocolVersion;
  return message;
}

let sequence = 0;
async function call(name, args, signal) {
  const response = await forward({
    jsonrpc: "2.0",
    id: `orrery-local-${++sequence}`,
    method: "tools/call",
    params: { name, arguments: args },
  }, signal);
  if (response.error || response.result?.isError) {
    const code = response.result?.structuredContent?.code;
    throw new BridgeError(`Orrery could not ${name}${code ? ` (${code})` : ""}.`);
  }
  return response.result.structuredContent;
}

function toolResult(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

async function waitForInput(args, signal) {
  const { issueId, questionId, runId, sessionId } = args ?? {};
  if (![issueId, questionId, runId, sessionId].every((id) => typeof id === "string" && id.trim())) {
    throw new BridgeError("Provide issueId, questionId, runId and sessionId.");
  }
  const expires = performance.now() + 20_000;
  const readQuestion = async () => {
    const { questions } = await call("list_issue_questions", { issueId }, signal);
    const question = questions.find((row) => row.id === questionId && row.runId === runId);
    if (!question) throw new BridgeError("This run has no such question on the issue.");
    return question;
  };

  let question = await readQuestion();
  if (question.status !== "open") return toolResult({ question });

  const { resume } = await call("resume_work_session", { issueId, runId }, signal);
  if (resume.disposition !== "active" || resume.session?.id !== sessionId) {
    throw new BridgeError("This run no longer holds the specified active claim.");
  }
  if (resume.session.stopRequested) return toolResult({ question, stopRequested: true });

  if (Date.parse(resume.session.leaseExpiresAt) - Date.now() < 120_000) {
    const { session } = await call("renew_claim", { issueId, sessionId }, signal);
    if (session.stopRequested) return toolResult({ question, stopRequested: true });
  }

  while (question.status === "open") {
    const remaining = expires - performance.now();
    if (remaining <= 0) break;
    await sleep(Math.min(remaining, 3000), undefined, { signal });
    question = await readQuestion();
  }
  return toolResult({ question });
}

const pending = new Map();
const write = (message) => process.stdout.write(JSON.stringify(message) + "\n");

async function dispatch(request, signal) {
  if (request.method === "tools/call" && request.params?.name === waitTool.name) {
    return { jsonrpc: "2.0", id: request.id, result: await waitForInput(request.params.arguments, signal) };
  }

  const response = await forward(request, signal);
  if (request.method === "tools/list" && response?.result?.tools) {
    for (const tool of response.result.tools) {
      if (tool.name === "ask_for_input") {
        tool.description += " To continue this conversation when the human replies, keep calling orrery_wait_for_input with the returned question ID and your active session ID. Honor stopRequested and use stop_session if asked to stop.";
      }
    }
    if (!response.result.nextCursor) response.result.tools.push(waitTool);
  }
  return response;
}

async function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } });
    return;
  }
  if (request?.jsonrpc !== "2.0" || typeof request.method !== "string") {
    write({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32600, message: "Invalid request" } });
    return;
  }
  if (request.method === "notifications/cancelled") {
    pending.get(request.params?.requestId)?.abort();
    return;
  }
  const controller = new AbortController();
  const hasId = Object.hasOwn(request, "id");
  if (hasId) pending.set(request.id, controller);
  try {
    const response = await dispatch(request, controller.signal);
    if (response && hasId) write(response);
  } catch (error) {
    if (hasId && !controller.signal.aborted) {
      const message = error instanceof BridgeError ? error.message : "Could not reach Orrery MCP or read its response.";
      if (request.method === "tools/call") {
        write({ jsonrpc: "2.0", id: request.id, result: toolResult({ message }, true) });
      } else {
        write({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message } });
      }
    }
  } finally {
    if (hasId) pending.delete(request.id);
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
input.on("line", (line) => { if (line.trim()) void handle(line); });
input.on("close", () => { for (const controller of pending.values()) controller.abort(); });
