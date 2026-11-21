---
name: verify-inbox-claim
description: Check the Orrery Integrations inbox wait lease fence. Use when changing orrery_wait_for_input, claim inspection, or renewal arguments in either MCP bridge.
---

# Verify the inbox claim fence

A delayed inbox wait must send its original work-session ID when it renews. A replacement claim could otherwise stay alive because of an older wait.

## Run the check

Run from the integrations repo root with Node 22 or later. The first verification used Node 26.13.1.

```sh
node .agents/skills/verify-inbox-claim/scripts/check.mjs
```

Require 288 traces per bundled bridge. The check must report both accepted renewals and refused stale renewals. A failure prints the first failing traces in request order.

## Bound and mapping

The checker runs the real `mcp-stdio.mjs` as a subprocess. A loopback server supplies a finite set of Orrery MCP replies. The check runs locally with Node alone.

Each bridge runs all combinations of nine replacement schedules, four question outcomes, question ownership, stop request state, and lease age. A replacement can occur before the question read, before claim inspection, before renewal applies, or after renewal. It can belong to the same run or a different run. The ninth schedule keeps the original claim. The lease is either due for renewal or fresh.

- `waitForInput` reads the question through `list_issue_questions`. A question for another run or a closed question does not trigger a renewal.
- `resume_work_session` reports the live claim or the expired original. A different session or a stop request does not trigger a renewal.
- `call` sends `renew_claim` with the work-session ID from the original wait request. Model the server as comparing that ID against the live claim when renewal applies. The fixture treats an omitted ID as an unfenced renewal, as documented by the server contract.

The check covers one wait, at most one replacement, and the protocol boundary. The real server's database transaction, clock, and lease expiry are outside this check. Run [installed-package verification](../../../.cursor/skills/verify-orrery-integrations/SKILL.md) for the real inbox path. Use Orrery's formal skill for the server's claims and leases.

## Prove the check catches a break

Copy one shipped bridge to a scratch directory. Remove the `sessionId` field from the arguments passed to `renew_claim` in the scratch copy. Pass the copied file to the checker. Require failure with a trace where the server renewed the replacement session. Delete the scratch copy and rerun the normal command.

## Coverage record

Synced to integrations commit `66d2830c72d47ffe7f82ff3f280645c4a36d3602`. Covered code is `waitForInput` and `call` in both `harnesses/*/scripts/mcp-stdio.mjs` copies. Inspect changes to these functions and to the server's `renew_claim` contract before trusting a pass. When semantics change, update the trace fixture, rerun the check and the scratch break, and then update the sync commit. Use `/maintain-formal-verification-skill` to reconcile later changes.
