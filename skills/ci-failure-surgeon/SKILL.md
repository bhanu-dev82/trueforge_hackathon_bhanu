---
name: ci-failure-surgeon
description: Reproduce a failing test in the sandbox, look up the API, draft a minimal patch, add a regression test, and wait for human approval before applying it.
---

# CI Failure Surgeon

Use this skill when the user pastes a test failure, CI log, or asks to fix `fixture/auth-service`.

## Pipeline

1. **Hunter** — run the exact failing command in the sandbox. Return command, exit code, assertion, file:line.
2. **Surgeon** — read only the implicated files. If the API is unfamiliar, search Exa. Return a unified diff and one-sentence cause. Do not apply.
3. **Insurance** — add or tighten a test that fails before the patch and passes after. Do not mutate production source until approval.

## Stop condition

Call a write or GitHub tool only after Hunter and Insurance have numbers. The harness must pause on `@write` / `@destructive`. If those tools are unavailable, present the diff and wait.

## Fixture

`fixture/auth-service` is a JWT verifier that checks HMAC signatures but not `exp`. The failing test is `TokenVerifier rejects an expired JWT`.
