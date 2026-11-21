# Orrery Integrations

Run `pnpm test` from the repo root. The installed Codex and Claude Code packages each ship `scripts/mcp-stdio.mjs`. When changing either copy, update both. The tests check that they match.

For changes to marketplace manifests, credentials, lifecycle hooks, or inbox replies, run the [installed-package verification skill](.cursor/skills/verify-orrery-integrations/SKILL.md). For changes to inbox wait or lease renewal, also run the [inbox claim verification skill](.agents/skills/verify-inbox-claim/SKILL.md).

## Agent skills

### Issue tracker

Use GitHub Issues in `forge-orbit/orrery-integrations`. See [issue tracker](docs/agents/issue-tracker.md).

### Triage labels

Use the five default roles. See [triage labels](docs/agents/triage-labels.md).

### Domain docs

Use a single context with root `GLOSSARY.md` and `docs/adr/`. See [domain docs](docs/agents/domain.md).
