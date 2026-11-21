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
/plugin install orrery@orrery
```

See [`harnesses/claude-code/README.md`](harnesses/claude-code/README.md) for details.

### Codex CLI

Clone or add this repository as a Codex marketplace, then install the `orrery` plugin from `/plugins` and trust its lifecycle hooks in `/hooks`.

> **Note:** OpenAI restricts plugins containing lifecycle hooks from the public cloud directory, so the Codex plugin is installed from this repository or a local clone.

See [`harnesses/codex/README.md`](harnesses/codex/README.md) for details.

## Privacy & Failure Behaviour

- **Allowlisted metadata only:** Hooks report only lifecycle event names, session/subagent IDs, timestamps, and optional model/version strings. Private transcripts, prompts, tool inputs, and tool outputs are never read or transmitted.
- **Non-blocking:** Hooks always exit `0`, write nothing to stdout, and swallow network or timeout errors so an unreachable Orrery instance never interrupts a coding session.

## Development

Requires Node.js 22+ (zero external dependencies):

```sh
npm test
```

## License

MIT — see [`LICENSE`](LICENSE).
