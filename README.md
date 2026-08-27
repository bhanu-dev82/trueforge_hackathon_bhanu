# CI Failure Surgeon

A TrueForge agent for [The Agent Harness Hackathon](https://www.wemakedevs.org/hackathons/trueforge).

**Team:** agent-i · **Author:** [Bhanu Nagpure](https://github.com/bhanu-dev82)

Paste a failing test. The harness reproduces it in an isolated sandbox, looks up the API, drafts a minimal patch, writes a regression test, and **stops** until a human allows the write. There is no login wall.

The bundled fixture is a JWT verifier that checks HMAC signatures and ignores `exp`. `npm run test:fixture` fails until that check exists.

## What the agent does

| Capability | How |
|---|---|
| Tools | Exa MCP for docs; GitHub MCP only if `GITHUB_TOKEN` is set |
| Sandbox | TrueForge sandbox enabled — Hunter runs `node --test` on the fixture |
| Approval | Write / destructive tools pause; Allow or Deny in the console |
| Subagents | `hunter-repro` → `surgeon-patch` → `insurance-tests` |
| Usage | Token counts come from TrueForge `turn.done.state.metrics` |

## Quickstart

Node.js 22.14+ and a Google AI Studio key.

```bash
# terminal 1
npx @truefoundry/trueforge@latest
# http://localhost:8790 — Settings → Models should list google-gemini

# terminal 2
cp .env.example .env   # set GEMINI_API_KEY and EXA_API_KEY
npm install
npm test
npm run demo
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). Press **Reproduce the expired JWT**. When a write is gated, choose Allow or Deny.

`npm run dev` is the CLI path. `GITHUB_TOKEN` is optional; without it the agent still reproduces, diffs, and waits.

## Runtime notes

- Models are bound at session create. On `429` / `quota_exceeded` the client opens a **new** session and reseeds a short case file. It does not swap models mid-session (that would drop the KV cache).
- Default chain on this project’s free-tier dashboard: `gemini-3.1-flash-lite` (500 RPD) → `gemini-3.5-flash-lite` (500 RPD) → `gemma-4-26b` (14.4k RPD, 16k TPM). `gemini-3.7-flash` is deep-only (20 RPD). Details: `docs/gemini-rate-limits.md`.
- MCP tool schemas stay deferred (`preload: false`). GitHub writes require approval.

## Layout

```
src/        TrueForge client, router, console
public/     judge console (no auth)
fixture/    auth-service — the failing JWT test
skills/     SKILL.md playbook
tests/      unit tests
```

## Qodo Code Review Evidence

Hackathon rule: substantive work lands through pull requests Qodo reviewed before merge.

- Representative PR: _this submission PR — fill the URL after merge_
- What Qodo found / what changed or was dismissed: _fill after the review thread_

Install the [Qodo GitHub App](https://app.qodo.ai/signin) on the repo if reviews do not appear automatically, then comment `/agentic_review`.

## AI assistance

AI coding tools were used, as allowed by the event. The authors reviewed the code and can explain the agent, the architecture, and the decisions.

## License

MIT
