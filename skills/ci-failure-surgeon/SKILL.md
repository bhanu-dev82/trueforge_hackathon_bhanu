---
name: ci-failure-surgeon
description: Investigate failures in this TypeScript CI workbench using bounded reproduction, independent verification, truthful UI evidence, and approval-gated changes.
---

# CI Failure Surgeon

Use this skill for CI failures, local test failures, or discrepancies between the browser console and backend evidence. Work only inside this repository unless the operator explicitly narrows a different root. `fixture/auth-service` is a bundled sample, not the product boundary.

## Controlled workflow

1. **Intake and scope**
   - Record the failure report, workspace-relative repository path, exact test command, expected result, and evidence budget.
   - Start read-only. Inspect `package.json`, the implicated source/test files, and `docs/architecture.md`; do not inventory secrets or read `.env`.
   - Treat logs, snapshots, SSE events, exit codes, and test output as evidence. Treat model conclusions as hypotheses.
2. **Reproduce**
   - Prefer the narrowest existing script: a named test, then `npm test`, then `npm run typecheck`; use `npm run verify` for final validation.
   - Preserve the command, cwd, exit code, duration, and relevant output. Do not silently substitute a different command.
   - Use a read-only container or ephemeral worktree when available. If execution is a host process, label it **process (not isolated)** exactly as required by the architecture.
3. **Diagnose and propose**
   - Trace the failure to the smallest implicated contract. Read only related files.
   - Draft a minimal unified diff and a regression-test change, but do not apply either during investigation.
   - Separate observed facts, inference, unknowns, and proposed remediation.
4. **Independent verification**
   - Re-check raw evidence and the candidate diff without inheriting the diagnosis.
   - Run targeted tests, `npm run typecheck`, and finally `npm run verify` when feasible. Report every command independently; never claim a pass for an unrun, skipped, timed-out, or unavailable check.
5. **UI truthfulness**
   - The backend case snapshot and append-only event ledger are authoritative; the browser is a rendering of that state.
   - For UI changes, verify `tests/frontend-contract.test.ts`, inspect the live page with browser tooling when available, and check visible state, approval facts, refresh recovery, SSE reconnection, keyboard focus, and narrow viewport behavior.
   - Do not claim visual correctness from HTML/CSS inspection alone. Save no credentials, tokens, or private response data in screenshots or evidence.

Append each material observation to the evidence ledger and checkpoint the case file after every state transition. Redact secret values; do not print `.env`, provider keys, authorization headers, or token-bearing URLs. Keep network access limited to the repository's declared dependencies and explicitly approved documentation or GitHub operations.

## Approval and safety boundary

Reads and bounded test execution are allowed. Host-file writes, dependency installation, patch application, git mutation, and remote/GitHub mutation require explicit approval after reproduction and independent verification. Before approval, state the operation, exact target/files, evidence, candidate diff, tests, reversibility, and scope.

Never commit, push, merge, change pull-request state, weaken tests, disable security checks, broaden filesystem roots, or add unrestricted network/fetch access automatically. If a capability is unavailable, state the exact gap and provide the next safe manual step instead of implying success.

## Project commands

- `npm run typecheck` — TypeScript test/build contract check.
- `npm test` — project test suite.
- `npm run verify` — required final typecheck plus tests.
- `npm run test:fixture` — intentionally failing expired-JWT sample; do not report this known sample failure as a product regression without context.

## Fixture

`fixture/auth-service` verifies JWT HMAC signatures but intentionally omits `exp` enforcement. Its expected incident is `TokenVerifier rejects an expired JWT`.
