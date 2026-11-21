# Run lifecycle reporting

## Sub-features

- Codex reports start, heartbeat, and end for one native session.
- Claude Code reports an ended run with its native session identity.

## How to get to it (user POV)

Trust the Orrery hooks in Codex. Run a short prompt and exit the CLI. Open the workspace runs view in Orrery to find the conversation.

## Driving it with the installed-package smoke test

Run `scripts/verify.sh drive "$RUN_DIR"` from the main skill. In `installed.log`, require confirmation of all three accepted Codex reports and the persisted ended Claude Code run.

## Gotchas

The Codex smoke trusts hooks from the checkout under test for that invocation. The normal install requires hook review. Claude Code's gate reads the recorded run through the human REST session.
