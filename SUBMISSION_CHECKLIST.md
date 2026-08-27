# Submission checklist

Deadline supplied by the entrant: **2026-08-30 20:00 Europe/London**. Verify the organizer’s current deadline and form requirements before publication.

## Repository readiness

- [ ] Run `npm ci`, `npm run verify`, `npm run build`, and `npm audit --omit=dev`.
- [ ] Confirm product suite reports 46/46 and build/audit pass.
- [ ] Run `npm run test:fixture`; confirm exactly one expected failure (`200 !== 401`) and do not describe it as a regression.
- [ ] Start `npm run demo`; verify `/api/health`, LOCAL-ONLY wording, fixture run, refresh recovery, and narrow viewport.
- [ ] If recording enhanced mode, verify the live TrueForge catalog/model, three roles, metrics, and a real approval pause. Never claim unavailable capabilities.
- [ ] Keep `DEMO_AUTO_APPROVE=false`.
- [ ] Search tracked content for secrets, private paths, placeholders, stale screenshots, and obsolete model/quota claims.
- [ ] Confirm `.env`, `.ci-surgeon/`, `audit/`, `dist/`, `node_modules/`, `.grok/`, and `skills-lock.json` are ignored and not staged.
- [ ] Include all implementation tests/docs needed to reproduce; include `package-lock.json`.
- [ ] Review `git diff --check`, `git diff --stat`, and the complete staged diff before committing.

## Demo video (~3 minutes)

- [ ] Follow `docs/demo-script.md`; show problem/value in the first 25 seconds.
- [ ] Show the capability strip before narrating capabilities.
- [ ] Show reusable intake, exact command, runtime evidence, and expected fixture failure.
- [ ] Show the security/control boundary; deny a real gated write if enhanced mode is available.
- [ ] Show verification output and Qodo PR #1 evidence.
- [ ] Do not expose `.env`, tokens, private paths/data, notifications, or unrelated tabs.
- [ ] Capture at readable resolution; verify audio, captions, link access, and duration.

## Public submission

- [ ] Public repository URL resolves without authentication.
- [ ] README has the 30-second product explanation, setup, architecture, controls, fallback, demo, verification, Qodo evidence, and limitations.
- [ ] About-three-minute demo video is publicly viewable.
- [ ] Short write-up states the problem, reusable workflow, TrueForge capabilities actually demonstrated, and limitations.
- [ ] PR #1 remains linked and shows Qodo review evidence.
- [ ] Request a fresh Qodo review after publishing the currently uncommitted changes; address or explicitly explain every material finding.
- [ ] Confirm license and author/team information.
- [ ] Submit the external form manually only after checking every URL in a signed-out/private window.

## Final no-go conditions

Do not submit if secrets are staged, README commands fail, the demo overclaims TrueForge/sandbox activity, Qodo has not reviewed the final published diff, or repository/video links are inaccessible.
