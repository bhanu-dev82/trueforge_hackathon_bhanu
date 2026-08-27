# CI Failure Surgeon architecture

CI Failure Surgeon is a controlled CI investigation workbench. The expired-JWT repository under `fixture/` is a bundled sample, not the product boundary.

## Run contract

A run starts from an `IncidentIntake`:

```ts
{
  title: string;
  failureReport: string;
  repositoryPath: string; // workspace-relative
  testCommand: string;    // argv parsed; no shell
  source: "sample" | "user";
}
```

The server returns a durable `InvestigationCase`. Each case has a monotonic state, an append-only evidence ledger, runtime facts, an optional approval request, and an outcome. The browser consumes both a snapshot (`GET /api/runs/:id`) and SSE envelopes (`GET /api/runs/:id/events`). Events are evidence, not chat history.

## State machine

`intake → planning → reproducing → diagnosing → verifying → awaiting_approval → applying → completed`

Any active state may enter `failed`; an approval denial enters `blocked`. Transitions outside this graph are rejected. A case is written atomically to `.ci-surgeon/runs/<run-id>.json` after every material transition, so refresh/restart recovery does not depend on an in-memory stream.

## Roles

- **Planner** makes a bounded investigation plan and identifies read/execute/write boundaries.
- **Executor** uses preserved controlled-runtime evidence, diagnoses, and drafts a candidate change without mutation capabilities.
- **Independent verifier** receives evidence and the candidate diff, not the executor's conclusions, and reports verification separately.

TrueForge dynamic subagents implement these roles when available. If TrueForge is unavailable, the local path performs reproduction and deterministic evidence review only; it does not claim subagent work or patch generation.

## Runtime selection

1. Keep mutation-capable TrueForge sandbox tools disabled during the analysis phase.
2. Prefer an ephemeral detached git worktree for local repository isolation.
3. Use rootless Podman or Docker when available and appropriate.
4. Fall back to a bounded direct process with `shell: false`, a scrubbed environment, output cap, and timeout. The UI labels this fallback as **process (not isolated)**.

No provider or MCP secret is copied into a worktree, process environment, evidence record, browser payload, or agent manifest. Exa is optional documentation assistance. GitHub is optional and all writes remain approval-gated.

## Approval boundary

Reads and bounded reproduction may run after the operator starts a case. Host-file writes, patch application, git mutation, and remote/GitHub mutation require a concrete approval request containing operation, target, candidate diff summary, verification result, and reversibility. Approval decisions are append-only evidence. This application never commits, pushes, merges, or changes pull-request state automatically.

## Backend/frontend vocabulary

The backend is authoritative for state. The frontend renders:

- **Incident intake** — source, repository, command, failure report.
- **Investigation ledger** — ordered, typed evidence with actor and timestamp.
- **Control plane** — state, runtime mode, model, budget, resume identifier.
- **Approval drawer** — exact proposed operation and consequences.
- **Runtime evidence** — command, exit code, duration, isolation facts.
- **Outcome** — verified, blocked, failed, or awaiting approval.

The bundled sample pre-fills intake only; it does not alter the contracts above.
