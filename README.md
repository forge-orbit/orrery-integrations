# Orrery Integrations

Installable plugins and adapters that connect AI coding harnesses to [Orrery](https://github.com/forge-orbit/orrery) — self-hosted project management for teams of humans and AI agents.

Every harness adapter translates its native lifecycle events onto Orrery's language-neutral `orrery.run.hook.v1` contract (`POST /api/runs/hook`) and connects the harness to Orrery's static `/mcp` endpoint.

## Supported Harnesses

| Harness | Status | Distribution | Directory |
| --- | --- | --- | --- |
| **Claude Code** | Ready | Claude Code plugin marketplace | [`harnesses/claude-code/`](harnesses/claude-code/) |
| **Codex CLI** | Ready | Codex repo/local plugin marketplace | [`harnesses/codex/`](harnesses/codex/) |
| **OpenCode** | Planned | npm (`@orrery/opencode-plugin`) | _coming soon_ |
| **Hermes** | Planned | PyPI / `hermes plugins install` | _coming soon_ |
| **Devin & cloud agents** | Supported via `/mcp` | Static MCP URL + `orrery_run_checkin` | _no local plugin needed_ |

## Prerequisites

1. Create an agent identity in your Orrery instance and issue a workspace-scoped API key.
2. Export the server URL and API key in the environment your harness inherits (never commit secrets):

```sh
export ORRERY_URL="https://orrery.example.com"
export ORRERY_API_KEY="orr_ak_..."
# or point to a local secret file:
# export ORRERY_API_KEY_FILE="$HOME/.config/orrery/agent.key"
```

## Quick Install

### Claude Code

```text
/plugin marketplace add forge-orbit/orrery-integrations
/plugin install orrery@forge-orbit
```

See [`harnesses/claude-code/README.md`](harnesses/claude-code/README.md) for details.

### Codex CLI

```sh
codex plugin marketplace add forge-orbit/orrery-integrations
codex plugin add orrery@forge-orbit
```

Open `/hooks` in Codex to review and trust the installed lifecycle hooks. Both plugins need Node.js 22+ on the machine running the harness.

> **Note:** OpenAI restricts plugins containing lifecycle hooks from the public cloud directory, so the Codex plugin is installed from this repository or a local clone.

See [`harnesses/codex/README.md`](harnesses/codex/README.md) for details.

## Switch from the previous marketplace

Both CLIs now install the plugin as `orrery@forge-orbit`. If you installed `orrery@orrery`, remove the old plugin and marketplace before running Quick Install again.

For Codex:

```sh
codex plugin remove orrery@orrery
codex plugin marketplace remove orrery
```

For Claude Code:

```sh
claude plugin uninstall orrery@orrery --keep-data
claude plugin marketplace remove orrery
```

Your Orrery URL and agent key work with the new install. Review and trust the new plugin's hooks in Codex.

## Inbox replies

When a claimed issue needs a human decision, the agent calls `ask_for_input` and then `orrery_wait_for_input`. The installed plugin waits for the inbox response and renews the matching claim when needed. Each wait lasts up to 20 seconds under normal network conditions. If the question is still open, the harness can call again in the same turn. Keep the harness running while waiting. If you exit it, resume the conversation to continue.

## Privacy & Failure Behaviour

- **Allowlisted metadata only:** Hooks report only lifecycle event names, session/subagent IDs, timestamps, and optional model/version strings. Private transcripts, prompts, tool inputs, and tool outputs are never read or transmitted.
- **Non-blocking:** Hooks always exit `0`, write nothing to stdout, and swallow network or timeout errors so an unreachable Orrery instance never interrupts a coding session.

## Development

Requires Node.js 22+ (zero external dependencies):

```sh
pnpm test
```

The two installed packages each carry a copy of the MCP transport. Keep the copies identical when editing it. The tests check the packaged entry points and reject drift.

Run the fresh-install smoke test before releasing. It needs Codex and Claude Code CLI sign-in, a disposable Orrery instance with a scoped agent key, and a file containing the test human's `email` and `password` as JSON. The command installs each checkout package into a temporary marketplace, drives real MCP and inbox calls, checks lifecycle reporting, and removes the temporary installs.

```sh
export ORRERY_SMOKE_HUMAN_FILE=/path/to/disposable/human.json
pnpm run smoke:installed WORKSPACE_ID PROJECT_ID
```

## License

MIT — see [`LICENSE`](LICENSE).
