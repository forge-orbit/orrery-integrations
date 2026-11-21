#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [mode, state, upstream] = process.argv.slice(2);

async function envFile(path) {
  return Object.fromEntries((await readFile(path, "utf8")).trim().split("\n")
    .map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
}

const { URL: base } = await envFile(join(upstream, "env"));
const { MAILPIT_HTTP, MAILPIT_SMTP } = await envFile(join(upstream, "mailpit.env"));
let cookie;

async function request(path, { method = "GET", body, bearer } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie && { Cookie: cookie }),
      ...(bearer && { Authorization: `Bearer ${bearer}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(response.ok, `${method} ${path.split("?", 1)[0]} returned HTTP ${response.status}`);
  if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";", 1)[0];
  return response.json();
}

const post = (path, body) => request(path, { method: "POST", body });
const write = (name, value) => writeFile(join(state, name), value + "\n", { mode: 0o600 });

switch (mode) {
  case "seed": {
    const human = { email: "plugin-smoke@orrery.test", password: randomBytes(24).toString("base64url") };
    assert.ok(process.env.BOOTSTRAP_SECRET, "Missing isolated bootstrap secret");
    await post("/api/setup/admin", { ...human, secret: process.env.BOOTSTRAP_SECRET });
    await post("/api/auth/login", human);
    await request("/api/settings/smtp", { method: "PUT", body: {
      host: "127.0.0.1", port: Number(MAILPIT_SMTP), security: "none",
      username: null, password: null, from: "orrery@orrery.test",
    } });
    const workspace = (await request("/api/workspaces")).find((row) => row.kind === "personal");
    assert.ok(workspace, "Setup created the personal workspace");
    const project = await post(`/api/workspaces/${workspace.id}/projects`, { name: "Installed plugin smoke" });
    const agent = await post("/api/agents", { name: "Installed plugin smoke agent" });
    const { secret } = await post("/api/agents/keys", {
      agentId: agent.id, workspaceId: workspace.id, projects: [{ projectId: project.id, level: "manage" }],
    });
    assert.ok(secret, "Created the scoped agent key");
    await write("agent.key", secret);
    await write("human.json", JSON.stringify(human));
    await write("fixture", [base, workspace.id, project.id].join("\n"));
    break;
  }
  case "doctor": {
    const [, workspaceId, projectId] = (await readFile(join(state, "fixture"), "utf8")).trim().split("\n");
    const secret = (await readFile(join(state, "agent.key"), "utf8")).trim();
    const identity = await request(`/api/agents/me?${new URLSearchParams({ workspaceId, projectId })}`,
      { bearer: secret });
    assert.equal(identity.workspaceId, workspaceId);
    assert.ok(identity.projects.some((row) => row.projectId === projectId && row.level === "manage"));
    const response = await fetch(`http://127.0.0.1:${MAILPIT_HTTP}/api/v1/messages`, { signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, "Mailpit accepts requests on this run's port");
    console.log("ok    scoped agent key and Mailpit");
    break;
  }
  case "mail": {
    const started = Date.parse((await readFile(join(state, "drive-started"), "utf8")).trim());
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetch(`http://127.0.0.1:${MAILPIT_HTTP}/api/v1/messages`, { signal: AbortSignal.timeout(5000) });
      assert.ok(response.ok, `Mailpit returned HTTP ${response.status}`);
      const { messages } = await response.json();
      const sent = messages.find((row) => row.Subject?.includes("Package smoke orrery-smoke-")
        && Date.parse(row.Created) >= started - 1000
        && row.To?.some((recipient) => recipient.Address === "plugin-smoke@orrery.test"));
      if (sent) {
        console.log(JSON.stringify({ subject: sent.Subject, to: sent.To.map((recipient) => recipient.Address) }));
        process.exit(0);
      }
      await sleep(500);
    }
    throw new Error("Mailpit did not receive this drive's inbox notification.");
  }
  default:
    throw new Error("Use seed, doctor, or mail.");
}
