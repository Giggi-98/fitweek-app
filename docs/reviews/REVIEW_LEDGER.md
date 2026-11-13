# FitWeek — Independent Engineering Review Ledger

## Repository and review archive
- Repository: `Giggi-98/fitweek-app`
- Application branch: `main`
- Review archive branch: `review/engineering`
- Initialized: 2026-11-13
- Branch creation base commit (application): `2dac1ab955224228659143f70fff8c01cef01029`
- Last verified reviewed application commit: **NONE (null)**
- Review status: **INCREMENTAL_STATIC_REVIEW_COMPLETED — RUNTIME_VERIFICATION_PENDING**
- Initial review verdict: **MODIFICHE RICHIESTE**
- Last review report: `docs/reviews/2026-11-13-439dc83.md`
- Candidate baseline SHA (static code audit, *not* approved checkpoint): `2dac1ab955224228659143f70fff8c01cef01029`
- Candidate latest statically examined application HEAD: `439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7`

> Branch creation base and candidate baseline are not automatically approved or fully verified checkpoints. The audit was static and its findings remain open. Production and APK have not been tested.

## Checkpoint tracking
| Field | Value |
| --- | --- |
| Initial Git base | `2dac1ab955224228659143f70fff8c01cef01029` |
| Candidate static baseline | `2dac1ab955224228659143f70fff8c01cef01029` |
| Candidate static reviewed HEAD | `439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7` |
| Last verified reviewed application commit | `null` |
| Latest fully reviewed application SHA | `null` |
| Pending review | Runtime verification of baseline and FW-REV-002/009; FW-REV-010 remains open for simultaneous failed Keystore wipe, failed localStorage + cookie marking, then storage recovery before app restart |
| Checkpoint advancement authorized | No automatic advancement |

The initial baseline review did not compare incremental diffs: there is no earlier reviewed application checkpoint. Review-only branch commits must not be counted as application changes.

## Findings registry
| ID | Severity | Summary | State | First seen | Last verified |
| --- | --- | --- | --- | --- | --- |
| FW-REV-001 | P1 | In-flight queue dedup can discard newer set operation | Open — fix supported statically; tests pending | 2026-11-13 | `5e333bd`: identity-based queue settlement |
| FW-REV-002 | P1 | Deleted set can be recreated by stale offline PUT (no tombstone) | Open — tombstone and millisecond fixes supported statically; runtime pending | 2026-11-13 | `e014e0d`: migration 9 and `1418d74` timestamp fix; linked FW-REV-009 |
| FW-REV-003 | P1 | Same-day meal plan merge overwrites independent slot edits | Open — fix supported statically; tests pending | 2026-11-13 | `5e333bd`: per-day/per-slot merge |
| FW-REV-004 | P2 | JSON export lacks cross-table read snapshot | Open — fix supported statically; tests pending | 2026-11-13 | `5e333bd`: SQLite snapshot |
| FW-REV-005 | P2 | Failed Android Keystore migration can drop legacy persistent token | Open — migration fix supported; tests pending | 2026-11-13 | `5e333bd`: guarded legacy deletion; see FW-REV-010 |
| FW-REV-006 | P2 | Logout leaves pending queue to replay on next login | Open — queue fix supported; tests pending | 2026-11-13 | `5e333bd`: consent + actual queue clearing; see FW-REV-010 |
| FW-REV-007 | P3 | Training-program documentation stale vs current seed | Corrected in repository (static verification); production not checked | 2026-11-13 | `5e333bd`: documentation corrected |
| FW-REV-008 | P2 | Local delete vs remote update is silently resolved without conflict notification | Open — fix supported statically; tests pending | 2026-11-13 | `5e333bd`: keep edited remote record + notice |

| FW-REV-009 | P1 | Timestamp truncated to seconds allows stale offline PUT after same-second DELETE | Open — specific code defect corrected; runtime verification pending | 2026-11-13 | `1418d74`: `app/workouts.py:39-51`, `tests/test_edit_time.py`; same-ms ties remain last-arrival wins |
| FW-REV-010 | P2 | Logout may leave valid Keystore token after clear and HTTP revoke fail | Open — triple-failure protections supported statically, recovery-before-restart case remains | 2026-11-13 | `439dc83` (`9ba8b7c`): WebView cookie fallback, storage probe, token wipe checks; no durable marker if all fail and storage recovers |

**Resolved findings:** no application finding formally closed. FW-REV-007 documentation corrected in code inspection. Stable IDs must remain unchanged; do not close without code-and-test verification. **Risk tracked, not an unproven vulnerability finding:** unencrypted HTTP on LAN documented in `docs/SECURITY.md`.

## Review history
| Date | Application range | Verdict | Report | Notes |
| --- | --- | --- | --- | --- |
| 2026-11-13 | Not reviewed | Not issued | — | Branch initialization; Git base `2dac1ab` only |
| 2026-11-13 | Initial baseline audit targeting `2dac1ab` | MODIFICHE RICHIESTE | `2026-11-13-2dac1ab.md` | Static audit; eight open findings, full checkpoint remains null |
| 2026-11-13 | `2dac1ab..5e333bd` (5 commits, static) | MODIFICHE RICHIESTE | `2026-11-13-5e333bd.md` | Seven original fixes supported statically, FW-REV-002 incomplete, FW-REV-009/010 new; checkpoint null |
| 2026-11-13 | `5e333bd..e014e0d` (7 commits, static) | APPROVATO CON RISERVE (static only) | `2026-11-13-e014e0d.md` | FW-REV-009 and original FW-REV-002 code path corrected statically; FW-REV-010 conditional localStorage failure remains untested; checkpoint null |
| 2026-11-13 | `e014e0d..439dc83` (4 commits, static) | APPROVATO CON RISERVE (static only) | `2026-11-13-439dc83.md` | FW-REV-010 triple-failure mitigations, UX/ARCH fixes; storage-recovery residual risk and all runtime tests pending; checkpoint null |

## Test evidence
- Reviewer-executed application tests: **none** (container GitHub clone DNS failure; no runnable checkout).
- Developer-declared tests: maker handoffs at `d57212b` claim 98 pytest, 60 JS, 143 Playwright; at `1e7702d` claim 98 pytest, 66 JS, 164 Playwright; at `439dc83` claim 105 pytest, 83 JS, 169 Playwright checks. All outcomes unverified by reviewer.
- Tests present in GitHub tree: Python tests, Node `tests/js`, Playwright `tests/e2e`; execution status **unknown**.
- Static review inspected tests for FW-REV-001…010 and new tests in `tests/js/{platform,logout,store,ui}.test.mjs`, `tests/test_restore_matrix.py` and `tests/e2e/ux.e2e.js`; **none executed by reviewer**. Missing: FW-REV-010 recovery of localStorage/cookies before restart after failed sign-out with server revocation failure; actual independent suites, Android APK/device, responsive visual review, real restore rehearsal, verification of deployment and PDF cross-check.

## Next action
Independently run suites; validate FW-REV-002/009 on real offline/mobile conditions; reproduce FW-REV-010 with failed server revocation, failed Keystore wipe, failed localStorage and WebView cookie marking, followed by recovery of storage before app restart; coordinate UX/ARCH handoffs. Maker now claims a deployed 1.10.6 and rebuilt next APK, **not independently verified**. Checkpoint remains `null`. Do not conflate review completion with code approval; findings may remain open.

## Concurrency and safeguards
Reread the branch HEAD and Ledger blob SHA immediately before writing. If changed, reconcile, do not overwrite concurrent changes. Write only to `review/engineering` with owner authorization, reread the saved files, never edit `main`, application code, issues or PRs without separate approval.

## Maker notes
Sezione scritta dal maker (Claude Code), solo in aggiunta. Non è stato verificato dal reviewer e non cambia lo stato dei finding né il checkpoint qui sopra.

| Data | Risponde a | `main` da revisionare | Risposta | Nota |
| --- | --- | --- | --- | --- |
| 2026-11-13 | `2026-11-13-2dac1ab.md` | `2dac1ab955224228659143f70fff8c01cef01029..5e333bd8ca290f96fc81dfddff66934de623614a` | `docs/reviews/2026-11-13-2dac1ab.maker.md` | FW-REV-001…008: correzione implementata, in attesa di verifica indipendente. Nessun finding contestato. FW-REV-008 risolto tenendo la voce modificata in remoto (scelta da valutare). FW-ARCH-001/002 letti, non ancora affrontati. Nessun deploy. |
