# Human inbox replies

## Sub-features

- The agent opens an inbox question and Orrery sends a notification.
- The installed wait tool receives the reply and retains the original work session until completion.

## How to get to it (user POV)

Have an agent claim an issue, call `ask_for_input`, and use `orrery_wait_for_input`. Answer the question in the Orrery inbox while the CLI is running.

## Driving it with the installed-package smoke test

Run `scripts/verify.sh drive "$RUN_DIR"` from the main skill. The smoke starts a Codex MCP wait, then posts `green` as the seeded human. Require the same session ID, a completed issue with that answer in the body, and `needsInput` cleared. Require the associated Mailpit message in `notification.json`.

## Gotchas

Mailpit must be started and seeded as the run's relay. The smoke exercises the inbox answer API and the installed MCP binding. A scripting client selects the installed wait tool through Codex app-server.
