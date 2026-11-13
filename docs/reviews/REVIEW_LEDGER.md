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
- Last review report: `docs/reviews/2026-11-13-5e333bd.md`
- Candidate baseline SHA (static code audit, *not* approved checkpoint): `2dac1ab955224228659143f70fff8c01cef01029`
- Candidate latest statically examined application HEAD: `5e333bd8ca290f96fc81dfddff66934de623614a`

> Branch creation base and candidate baseline are not automatically approved or fully verified checkpoints. The audit was static and its findings remain open. Production and APK have not been tested.

## Checkpoint tracking
| Field | Value |
| --- | --- |
| Initial Git base | `2dac1ab955224228659143f70fff8c01cef01029` |
| Candidate static baseline | `2dac1ab955224228659143f70fff8c01cef01029` |
| Candidate static reviewed HEAD | `5e333bd8ca290f96fc81dfddff66934de623614a` |
| Last verified reviewed application commit | `null` |
| Latest fully reviewed application SHA | `null` |
| Pending review | Runtime verification of baseline and incremental fixes; independently verify FW-REV-002/009/010 |
| Checkpoint advancement authorized | No automatic advancement |

The initial baseline review did not compare incremental diffs: there is no earlier reviewed application checkpoint. Review-only branch commits must not be counted as application changes.

## Findings registry
| ID | Severity | Summary | State | First seen | Last verified |
| --- | --- | --- | --- | --- | --- |
| FW-REV-001 | P1 | In-flight queue dedup can discard newer set operation | Open — fix supported statically; tests pending | 2026-11-13 | `5e333bd`: identity-based queue settlement |
| FW-REV-002 | P1 | Deleted set can be recreated by stale offline PUT (no tombstone) | Open — partially mitigated; FW-REV-009 | 2026-11-13 | `5e333bd`: tombstones exist; timestamp precision flaw |
| FW-REV-003 | P1 | Same-day meal plan merge overwrites independent slot edits | Open — fix supported statically; tests pending | 2026-11-13 | `5e333bd`: per-day/per-slot merge |
| FW-REV-004 | P2 | JSON export lacks cross-table read snapshot | Open — fix supported statically; tests pending | 2026-11-13 | `5e333bd`: SQLite snapshot |
| FW-REV-005 | P2 | Failed Android Keystore migration can drop legacy persistent token | Open — migration fix supported; tests pending | 2026-11-13 | `5e333bd`: guarded legacy deletion; see FW-REV-010 |
| FW-REV-006 | P2 | Logout leaves pending queue to replay on next login | Open — queue fix supported; tests pending | 2026-11-13 | `5e333bd`: consent + actual queue clearing; see FW-REV-010 |
| FW-REV-007 | P3 | Training-program documentation stale vs current seed | Corrected in repository (static verification); production not checked | 2026-11-13 | `5e333bd`: documentation corrected |
| FW-REV-008 | P2 | Local delete vs remote update is silently resolved without conflict notification | Open — fix supported statically; tests pending | 2026-11-13 | `5e333bd`: keep edited remote record + notice |

| FW-REV-009 | P1 | Timestamp truncated to seconds allows stale offline PUT after same-second DELETE | Open — new finding | 2026-11-13 | `5e333bd`: `app/workouts.py:39-51,225-246` |
| FW-REV-010 | P2 | Logout may leave valid Keystore token after clear and HTTP revoke fail | Open — new finding | 2026-11-13 | `5e333bd`: `static/js/logout.js:15-30`, `platform.js:60-73` |

**Resolved findings:** no application finding formally closed. FW-REV-007 documentation corrected in code inspection. Stable IDs must remain unchanged; do not close without code-and-test verification. **Risk tracked, not an unproven vulnerability finding:** unencrypted HTTP on LAN documented in `docs/SECURITY.md`.

## Review history
| Date | Application range | Verdict | Report | Notes |
| --- | --- | --- | --- | --- |
| 2026-11-13 | Not reviewed | Not issued | — | Branch initialization; Git base `2dac1ab` only |
| 2026-11-13 | Initial baseline audit targeting `2dac1ab` | MODIFICHE RICHIESTE | `2026-11-13-2dac1ab.md` | Static audit; eight open findings, full checkpoint remains null |
| 2026-11-13 | `2dac1ab..5e333bd` (5 commits, static) | MODIFICHE RICHIESTE | `2026-11-13-5e333bd.md` | Seven original fixes supported statically, FW-REV-002 incomplete, FW-REV-009/010 new; checkpoint null |

## Test evidence
- Reviewer-executed application tests: **none** (container GitHub clone DNS failure; no runnable checkout).
- Developer-declared tests: latest `CLAUDE.md` claims 94 pytest, 52 JS and 143 Playwright checks; claims and pass status not independently validated.
- Tests present in GitHub tree: Python tests, Node `tests/js`, Playwright `tests/e2e`; execution status **unknown**.
- Static review verified added regression test source for FW-REV-001/002/003/004/005/006/008; none executed by reviewer. Missing: timestamp subsecond collision test FW-REV-009, failed Keystore clear and failed server revoke test FW-REV-010, execution of suites, Android APK/device, responsive visual review, real restore rehearsal and PDF cross-check.

## Next action
Have Claude correct FW-REV-009/010 and complete FW-REV-002, then independently verify runnable test suites and device checks before deciding whether to promote candidate HEAD to a fully verified checkpoint. Do not conflate review completion with code approval; findings may remain open.

## Concurrency and safeguards
Reread the branch HEAD and Ledger blob SHA immediately before writing. If changed, reconcile, do not overwrite concurrent changes. Write only to `review/engineering` with owner authorization, reread the saved files, never edit `main`, application code, issues or PRs without separate approval.

## Maker notes
Sezione scritta dal maker (Claude Code), solo in aggiunta. Non è stato verificato dal reviewer e non cambia lo stato dei finding né il checkpoint qui sopra.

| Data | Risponde a | `main` da revisionare | Risposta | Nota |
| --- | --- | --- | --- | --- |
| 2026-11-13 | `2026-11-13-2dac1ab.md` | `2dac1ab955224228659143f70fff8c01cef01029..5e333bd8ca290f96fc81dfddff66934de623614a` | `docs/reviews/2026-11-13-2dac1ab.maker.md` | FW-REV-001…008: correzione implementata, in attesa di verifica indipendente. Nessun finding contestato. FW-REV-008 risolto tenendo la voce modificata in remoto (scelta da valutare). FW-ARCH-001/002 letti, non ancora affrontati. Nessun deploy. |
