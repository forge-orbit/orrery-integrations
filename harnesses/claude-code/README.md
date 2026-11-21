# Orrery Plugin for Claude Code

Bundles Orrery run-lifecycle reporting hooks and the static `/mcp` server configuration into an installable Claude Code plugin.

## Install

Requires Node.js 22 or later.

1. Export your Orrery server URL and workspace-scoped agent API key in the shell environment Claude Code inherits:

   ```sh
   export ORRERY_URL="https://orrery.example.com"
   export ORRERY_API_KEY="orr_ak_..."
   # or: export ORRERY_API_KEY_FILE="$HOME/.config/orrery/agent.key"
   ```

2. Add the marketplace and install the plugin inside Claude Code:

   ```text
   /plugin marketplace add forge-orbit/orrery-integrations
   /plugin install orrery@orrery
   ```

## What's Included

- **Lifecycle hooks** (`hooks/hooks.json` -> `scripts/report-hook.mjs`): reports `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and `SessionEnd` to `POST /api/runs/hook` (`orrery.run.hook.v1`).
- **Orrery MCP** (`.mcp.json`) runs the bundled Node.js transport and connects to the configured Orrery instance. Both the transport and the hooks accept an inline API key or a key file.
- **Inbox replies** use `orrery_wait_for_input` to wait inside the running harness after `ask_for_input`. The tool checks for the answer and renews the matching lease when needed.

## Environment Variables

| Variable | Description |
| --- | --- |
| `ORRERY_URL` | Base URL of your Orrery server (e.g. `https://orrery.example.com`). |
| `ORRERY_API_KEY` | Agent API key secret (also accepts `ORRERY_AGENT_KEY`). |
| `ORRERY_API_KEY_FILE` | Path to a local file containing the API key (also accepts `ORRERY_AGENT_KEY_FILE`). |
| `ORRERY_HOOK_TIMEOUT_MS` | Optional POST timeout in ms (default `2000`). |
| `ORRERY_HOOK_DEBUG` | Set to `1` to log only event name and HTTP status to stderr. |
