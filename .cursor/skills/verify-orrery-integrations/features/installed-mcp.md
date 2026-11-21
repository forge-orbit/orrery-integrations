# Installed MCP and credentials

## Sub-features

- Each marketplace installs the packaged MCP bridge.
- The bridge connects to the configured Orrery URL with the agent's scoped key.

## How to get to it (user POV)

Set `ORRERY_URL` and `ORRERY_API_KEY_FILE`. Install Orrery from GitHub through the Codex or Claude Code marketplace. In a new session, ask the CLI to list the workspace projects.

## Driving it with the installed-package smoke test

Run `scripts/verify.sh drive "$RUN_DIR"` from the main skill. Require Codex app-server's native `list_projects` call and Claude Code's model tool call to return the seeded project. Check `installed.log`.

## Gotchas

Installation success alone does not establish tool availability. The key-file path is exercised by the CLI smoke. The inline legacy key alias is exercised by `pnpm test`.
