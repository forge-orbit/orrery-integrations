# Orrery Plugin for Codex CLI

Bundles Orrery run-lifecycle reporting hooks and the static `/mcp` server configuration into an installable Codex plugin.

## Install

Requires Node.js 22 or later.

1. Export your Orrery server URL and workspace-scoped agent API key in the environment Codex inherits:

   ```sh
   export ORRERY_URL="https://orrery.example.com"
   export ORRERY_API_KEY="orr_ak_..."
   # or: export ORRERY_API_KEY_FILE="$HOME/.config/orrery/agent.key"
   ```

2. Add the marketplace and install the plugin.

   ```sh
   codex plugin marketplace add forge-orbit/orrery-integrations
   codex plugin add orrery@orrery
   ```
3. Open `/hooks` in Codex to review and trust the plugin's lifecycle hooks.

> **Note:** OpenAI restricts plugins containing lifecycle hooks from the public cloud directory, so this plugin is distributed through this repository marketplace.

## What's Included

- **Lifecycle hooks** (`hooks/hooks.json` -> `scripts/report-hook.mjs`): reports `SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SubagentStart`, and `SubagentStop` to `POST /api/runs/hook` (`orrery.run.hook.v1`).
- **Orrery MCP** (`.mcp.json`) runs the bundled Node.js transport and connects to the configured Orrery instance. Both the transport and the hooks accept an inline API key or a key file.
- **Inbox replies** use `orrery_wait_for_input` to wait inside the running harness after `ask_for_input`. The tool checks for the answer and renews the matching lease when needed.

## Environment Variables

| Variable | Description |
| --- | --- |
| `ORRERY_URL` | Base URL of your Orrery server (default `http://localhost:8080`). |
| `ORRERY_API_KEY` | Agent API key secret (also accepts `ORRERY_AGENT_KEY`). |
| `ORRERY_API_KEY_FILE` | Path to a local file containing the API key (also accepts `ORRERY_AGENT_KEY_FILE`). |
| `ORRERY_CODEX_VERSION` | Optional Codex CLI version to record; omitted stores `unknown`. |
| `ORRERY_HOOK_TIMEOUT_MS` | Optional POST timeout in ms (default `3000`). |
| `ORRERY_HOOK_DEBUG` | Set to any non-empty value to log redacted failures to stderr. |
| `ORRERY_HOOK_TRACE` | Optional local file path for redacted JSONL hook trace lines. |
