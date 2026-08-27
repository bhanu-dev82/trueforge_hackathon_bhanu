# Three-minute demo storyboard

## Before recording

- Use Node.js 22+, run `npm ci`, and keep `DEMO_AUTO_APPROVE=false`.
- Close unrelated tabs and notifications. Never show `.env`, tokens, provider dashboards, or private case files.
- Start `npm run demo`; open <http://127.0.0.1:8787> at 1440×900 or larger.
- Decide the truthful path from the capability strip: LOCAL-ONLY is the reliable baseline; only narrate TrueForge/subagents/MCP if the UI reports them available.

## 0:00–0:25 — Problem and promise

**Screen:** Hero and capability strip.

**Say:** “CI logs can identify a symptom, but autonomous repair can silently widen scope. CI Failure Surgeon turns any repository path, failure report, and test command into a controlled investigation: bounded reproduction, durable evidence, independent verification, and an explicit gate before any write.”

Point out that capabilities are detected, not assumed.

## 0:25–0:50 — Reusable intake and sample

**Screen:** Prefilled incident form.

**Say:** “This is a reusable intake contract. The bundled auth service is only a sample: it verifies the JWT signature but intentionally ignores expiration. The expected demo signal is one failing assertion—expired token returns 200 instead of 401.”

Point to repository path and exact no-shell command, then select **Start investigation**.

## 0:50–1:35 — Evidence, not chat

**Screen:** Control room, runtime evidence, ledger.

**Say:** “The backend chooses the safest available runtime: configured rootless container, ephemeral detached worktree, or a bounded process clearly marked not isolated. It records command, exit code, duration, output, actor, and state in a durable case file. Here, exit 1 is expected fixture evidence—not a product regression.”

Point to `200 !== 401`, runtime mode, and planner/executor/verifier rows.

## 1:35–2:10 — TrueForge and truthful fallback

**LOCAL-ONLY screen:**

**Say:** “TrueForge is unavailable in this recording environment, so the product says LOCAL-ONLY and makes no model, subagent, research, sandbox, patch, or approval claim. The deterministic investigation remains useful and honest.”

**If TrueForge is actually available instead:**

**Say:** “TrueForge creates session-bound agents, delegates planner, executor, and independent-verifier roles, streams evidence and metrics, and lazily exposes Exa plus optional GitHub MCP tools. Mutation-capable sandbox tools remain disabled in this version.”

Do not mix the two narratives.

## 2:10–2:35 — Human control

If an approval drawer is genuinely visible, show target, operation, evidence, and reversibility, then choose **Deny**.

**Say:** “TrueForge classifies write and destructive MCP calls as approval-required. Denial is recorded in the append-only decision ledger. The application itself never commits, pushes, merges, or updates a PR.”

If LOCAL-ONLY, show the documented control boundary instead; do not fabricate an approval.

## 2:35–3:00 — Proof and close

**Screen:** Terminal, then PR #1.

Run/show:

```bash
npm run verify
npm run build
npm audit --omit=dev
```

**Say:** “The product suite passes 46 of 46, TypeScript builds, and the production audit reports zero vulnerabilities. The separate fixture command is intentionally red. Public PR #1 contains Qodo review evidence and the follow-up fixes. The result is a reusable investigation harness that fails safely when enhanced capabilities are unavailable.”

End on the README’s 30-second summary or the completed ledger.
