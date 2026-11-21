---
name: verify-orrery-integrations
description: Verify a fresh Codex and Claude Code marketplace install against disposable Orrery. Use for manifests, MCP credentials, lifecycle hooks, inbox replies, or a plugin release.
---

# Verify Orrery Integrations

Run from the integrations repo root. Use the installed CLI packages and an isolated Orrery server. The [feature map](features/README.md) tells you which assertions to inspect.

## Run the full check

```sh
.agents/skills/verify-orrery-integrations/scripts/verify.sh run
```

The full check runs all four stages below in one invocation and cleans up on exit. Capture the printed `RUN_DIR` for evidence.

## Launch

Use a sibling `orrery` checkout with its dependencies installed via `pnpm install`. The launcher reuses its `verify-orrery` scripts. Use Linux, Node 26 for the Orrery server, Bash, Docker, `pnpm`, `openssl`, `curl`, `ss`, and `setsid`. Sign in to Codex and Claude Code before the drive. The smoke test temporarily installs each package using the CLI's active user configuration.

```sh
verify=.agents/skills/verify-orrery-integrations/scripts/verify.sh
"$verify" up
```

Pass the Orrery checkout path after `up` if it lives elsewhere. Capture the printed `RUN_DIR`. Launch is ready when it reports that Orrery and Mailpit are seeded. The run owns a Postgres container, an Orrery process, a Mailpit container, an administrator, a project, and a scoped agent key.

## Doctor

```sh
"$verify" doctor "$RUN_DIR"
```

Require a passing ownership and readiness check, an authenticated agent with access to the fixture project, a responding Mailpit, and both CLI logins. Read `evidence/orrery-up.log` or `evidence/mailpit-up.log` if launch failed.

## Drive

```sh
"$verify" drive "$RUN_DIR"
```

The helper passes only the disposable key file to both CLIs. It runs `pnpm run smoke:installed` against the fixture project, then checks Mailpit. Require all three installed-package success lines and an inbox notification for this drive. Run `pnpm test` for manifest and transport regressions, including the inline key alias.

## Evidence

Keep `$RUN_DIR/evidence/versions.txt`, `doctor.log`, `installed.log`, and `notification.json`. They record the build, checked connection, CLI behavior, and notification. Keep the agent key and administrator file outside `evidence/`. The drive uses real marketplace installs and real MCP and REST endpoints. The test administrator answers through the inbox API. For browser behavior and manual reply testing, use the Orrery checkout's inbox verification.

## Cleanup

Run cleanup after every drive, including a failed drive.

```sh
"$verify" down "$RUN_DIR"
test -s "$RUN_DIR/evidence/versions.txt"
```

Check that evidence from the attempted drive still exists. Cleanup stops the recorded server and removes the two owned containers and credential files. Keep the evidence directory.

## Helpers

`scripts/verify.sh` is the executable entry point for `run`, `up`, `doctor`, `drive`, and `down`. It calls `scripts/fixture.mjs` to seed the REST fixture, check the agent and Mailpit, and export notification evidence. Update the [feature map](features/README.md) when release coverage changes. Use `/maintain-verification-skill` to reconcile the map with the shipped behavior.
