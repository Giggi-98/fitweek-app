# FitWeek — Engineering Review Policy

## Purpose and authority
This branch stores independent engineering reviews of `Giggi-98/fitweek-app`. Claude Code is the MAKER; ChatGPT is the independent REVIEWER. GitHub code, diffs, and tests are the technical source of truth. Claims in commit messages or documentation are not proof of correctness.

## Scope and branches
- Application branch: `main` (read-only for the reviewer).
- Review archive branch: `review/engineering`.
- Only authorized writes to `docs/reviews/` on the review branch.
- Never modify application code, `main`, issues, or pull requests without separate authorization.
- Before each write, reread the current branch, check for concurrent changes, and never overwrite unreviewed changes.

## Incremental review procedure
1. Read `docs/reviews/REVIEW_LEDGER.md` from GitHub on `review/engineering`.
2. Resolve the last **verified reviewed application checkpoint** and current HEAD of `main`.
3. Identify *every* intervening application commit, including merges/rebases/force-push anomalies; inspect their diffs.
4. Inspect surrounding code, configurations, migrations, and tests wherever needed.
5. Check logic, security, authentication, authorization, data integrity, SQLite transactions and migrations, offline synchronization, Android/Capacitor, FastAPI, frontend/UX, Docker, compatibility, and regression risk as applicable.
6. Compare earlier findings against actual fixes; do not close a finding on developer claims alone.
7. Separate reviewer-executed tests, developer-declared tests, and missing/unexecuted tests.
8. Deliver a verdict, supported findings, regression analysis, actionable Claude Code prompt, and proposed checkpoint and ledger changes.
9. Advance the application checkpoint only after a sufficiently complete review of the entire commit range. An open finding does not prevent advancing a fully examined checkpoint, but must remain open until independently verified.
10. Request authorization before committing review reports or ledger changes to GitHub. Read the committed files back to verify persistence.

If the checkpoint is unknown, use an explicit unreviewed baseline and perform an initial review. Never silently promote the branch creation commit to a reviewed checkpoint. Exclude review-only documentation commits from application review ranges.

## Verdicts and severities
Verdicts: `APPROVATO`, `APPROVATO CON RISERVE`, `MODIFICHE RICHIESTE`, `BLOCCANTE`.
- P0: Critical data loss, security compromise, or severe outage.
- P1: Important bug, regression, or critical-function failure.
- P2: Concrete medium-impact defect or material robustness issue.
- P3: Minor polish, documentation, or low-impact improvement.
Findings use stable IDs `FW-REV-001`, `FW-REV-002`, etc.; reuse IDs across subsequent reviews.

## Evidence and report format
Each review report must record:
- Date, starting and ending application commit SHA, exact commits covered, verdict and rationale.
- Verified changes, relevant files/lines, evidence, triggering scenario, impact, recommended fix, regression test, and status for each finding.
- Regressions and compatibility implications.
- Reviewer-executed vs declared vs missing tests.
- Product quality and Android/mobile daily-use implications.
- Resolved, persistent and new findings with stable IDs.
- Copy-ready Claude Code remediation prompt, distinguishing mandatory from optional tasks.
- New checkpoint proposal and rationale, plus next verification.

Do not claim tests passed without verified results; distinguish repository state from local environment and production. Do not label speculative issues as established bugs. Prioritize safety, data retention, backup and restoration, and reliability over cosmetic refactors.

## Files
- `docs/reviews/REVIEW_POLICY.md`: this policy.
- `docs/reviews/REVIEW_LEDGER.md`: persistent checkpoints, findings and history.
- `docs/reviews/YYYY-MM-DD-SHA.md`: individual review reports.

## Initial state rule
The branch may start from the current `main` HEAD as a Git base, but this is **not** a code review. `last_verified_reviewed_application_commit` remains `null` until an actual initial review is completed.
