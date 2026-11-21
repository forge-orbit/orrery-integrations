// Validates all marketplace catalogs, plugin manifests, hook configs, and MCP configs.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function readJson(relPath) {
  const full = resolve(ROOT, relPath);
  assert.ok(existsSync(full), `expected file to exist: ${relPath}`);
  return JSON.parse(readFileSync(full, "utf8"));
}

test("Claude Code marketplace and plugin manifests are valid and consistent", () => {
  const marketplace = readJson(".claude-plugin/marketplace.json");
  assert.equal(marketplace.name, "forge-orbit");
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length >= 1);

  for (const entry of marketplace.plugins) {
    assert.equal(entry.name, "orrery");
    assert.equal(typeof entry.source, "string");
    const pluginDir = resolve(ROOT, entry.source);
    assert.ok(existsSync(pluginDir), `plugin source missing: ${entry.source}`);

    const manifest = readJson(`${entry.source}/.claude-plugin/plugin.json`);
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, entry.version);

    const mcp = readJson(`${entry.source}/.mcp.json`);
    assert.ok(mcp.mcpServers && mcp.mcpServers.orrery, "expected mcpServers.orrery");

    const hooks = readJson(`${entry.source}/hooks/hooks.json`);
    assert.ok(hooks.hooks && Object.keys(hooks.hooks).length > 0, "expected hooks entries");
    for (const [eventName, groups] of Object.entries(hooks.hooks)) {
      for (const group of groups) {
        for (const h of group.hooks) {
          assert.equal(h.type, "command", `${eventName} hook must be a command`);
          assert.ok(
            h.command.includes("${CLAUDE_PLUGIN_ROOT}/scripts/report-hook.mjs"),
            `${eventName} hook must reference \${CLAUDE_PLUGIN_ROOT}/scripts/report-hook.mjs`,
          );
        }
      }
    }
    assert.ok(existsSync(resolve(pluginDir, "scripts/report-hook.mjs")));
  }
});

test("Codex marketplace and plugin manifests are valid and consistent", () => {
  const marketplace = readJson(".agents/plugins/marketplace.json");
  assert.equal(marketplace.name, "forge-orbit");
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length >= 1);

  for (const entry of marketplace.plugins) {
    assert.equal(entry.name, "orrery");
    assert.equal(entry.source?.source, "local");
    assert.equal(typeof entry.source?.path, "string");
    const pluginDir = resolve(ROOT, entry.source.path);
    assert.ok(existsSync(pluginDir), `plugin source missing: ${entry.source.path}`);

    const manifest = readJson(`${entry.source.path}/.codex-plugin/plugin.json`);
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, entry.version);
    assert.equal(manifest.mcpServers, "./.mcp.json");
    assert.equal(manifest.hooks, "./hooks/hooks.json");

    const mcp = readJson(`${entry.source.path}/${manifest.mcpServers}`);
    assert.ok(mcp.mcpServers && mcp.mcpServers.orrery, "expected mcpServers.orrery");

    const hooks = readJson(`${entry.source.path}/hooks/hooks.json`);
    assert.ok(hooks.hooks && Object.keys(hooks.hooks).length > 0, "expected hooks entries");
    for (const [eventName, groups] of Object.entries(hooks.hooks)) {
      for (const group of groups) {
        for (const h of group.hooks) {
          assert.equal(h.type, "command", `${eventName} hook must be a command`);
          assert.ok(
            h.command.includes("${PLUGIN_ROOT}/scripts/report-hook.mjs"),
            `${eventName} hook must reference \${PLUGIN_ROOT}/scripts/report-hook.mjs`,
          );
        }
      }
    }
    assert.ok(existsSync(resolve(pluginDir, "scripts/report-hook.mjs")));
  }
});

test("both installable packages carry the same MCP transport", () => {
  const script = "scripts/mcp-stdio.mjs";
  assert.deepEqual(
    readFileSync(resolve(ROOT, "harnesses/codex", script)),
    readFileSync(resolve(ROOT, "harnesses/claude-code", script)),
  );
});
