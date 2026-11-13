# FitWeek — Independent Engineering Review Ledger

## Repository and review archive
- Repository: `Giggi-98/fitweek-app`
- Application branch: `main`
- Review archive branch: `review/engineering`
- Initialized: 2026-11-13
- Branch creation base commit (application): `2dac1ab955224228659143f70fff8c01cef01029`
- Last verified reviewed application commit: **NONE (null)**
- Review status: **INITIAL_BASELINE_STATIC_AUDIT_COMPLETED — RUNTIME_VERIFICATION_PENDING**
- Initial review verdict: **MODIFICHE RICHIESTE**
- Last review report: `docs/reviews/2026-11-13-2dac1ab.md`
- Candidate baseline SHA (static code audit, *not* approved checkpoint): `2dac1ab955224228659143f70fff8c01cef01029`

> Branch creation base and candidate baseline are not automatically approved or fully verified checkpoints. The audit was static and its findings remain open. Production and APK have not been tested.

## Checkpoint tracking
| Field | Value |
| --- | --- |
| Initial Git base | `2dac1ab955224228659143f70fff8c01cef01029` |
| Candidate static baseline | `2dac1ab955224228659143f70fff8c01cef01029` |
| Last verified reviewed application commit | `null` |
| Latest fully reviewed application SHA | `null` |
| Pending review | Complete verification of initial baseline, including key tests and uncovered paths |
| Checkpoint advancement authorized | No automatic advancement |

The initial baseline review did not compare incremental diffs: there is no earlier reviewed application checkpoint. Review-only branch commits must not be counted as application changes.

## Findings registry
| ID | Severity | Summary | State | First seen | Last verified |
| --- | --- | --- | --- | --- | --- |
| FW-REV-001 | P1 | In-flight queue dedup can discard newer set operation | Open | 2026-11-13 | Static code evidence at `2dac1ab` |
| FW-REV-002 | P1 | Deleted set can be recreated by stale offline PUT (no tombstone) | Open | 2026-11-13 | Static code evidence at `2dac1ab` |
| FW-REV-003 | P1 | Same-day meal plan merge overwrites independent slot edits | Open | 2026-11-13 | Static code evidence at `2dac1ab` |
| FW-REV-004 | P2 | JSON export lacks cross-table read snapshot | Open | 2026-11-13 | Static code evidence at `2dac1ab` |
| FW-REV-005 | P2 | Failed Android Keystore migration can drop legacy persistent token | Open | 2026-11-13 | Static code evidence at `2dac1ab` |
| FW-REV-006 | P2 | Logout leaves pending queue to replay on next login | Open | 2026-11-13 | Static code evidence at `2dac1ab` |
| FW-REV-007 | P3 | Training-program documentation stale vs current seed | Open | 2026-11-13 | Static code evidence at `2dac1ab` |
| FW-REV-008 | P2 | Local delete vs remote update is silently resolved without conflict notification | Open | 2026-11-13 | Static code evidence at `2dac1ab` |

**Resolved findings:** none. Stable IDs must remain unchanged; do not close without code-and-test verification. **Risk tracked, not an unproven vulnerability finding:** unencrypted HTTP on LAN documented in `docs/SECURITY.md`.

## Review history
| Date | Application range | Verdict | Report | Notes |
| --- | --- | --- | --- | --- |
| 2026-11-13 | Not reviewed | Not issued | — | Branch initialization; Git base `2dac1ab` only |
| 2026-11-13 | Initial baseline audit targeting `2dac1ab` | MODIFICHE RICHIESTE | `2026-11-13-2dac1ab.md` | Static audit; eight open findings, full checkpoint remains null |

## Test evidence
- Reviewer-executed application tests: **none** (container GitHub clone DNS failure; no runnable checkout).
- Developer-declared tests: `CLAUDE.md` states 85 pytest and 44 JS tests; claims not independently validated.
- Tests present in GitHub tree: Python tests, Node `tests/js`, Playwright `tests/e2e`; execution status **unknown**.
- Missing: concurrency and offline regressions for FW-REV-001/002/003/008, consistent snapshot export, Android token error case, logout queue, Android APK/device, responsive visual review, real restore rehearsal and PDF cross-check.

## Next action
Complete runnable and device checks and decide whether the candidate may be promoted to a fully verified checkpoint. Do not conflate review completion with code approval; findings may remain open.

## Concurrency and safeguards
Reread the branch HEAD and Ledger blob SHA immediately before writing. If changed, reconcile, do not overwrite concurrent changes. Write only to `review/engineering` with owner authorization, reread the saved files, never edit `main`, application code, issues or PRs without separate approval.

## Maker notes
Sezione scritta dal maker (Claude Code), solo in aggiunta. Non è stato verificato dal reviewer e non cambia lo stato dei finding né il checkpoint qui sopra.

| Data | Risponde a | `main` da revisionare | Risposta | Nota |
| --- | --- | --- | --- | --- |
| 2026-11-13 | `2026-11-13-2dac1ab.md` | `2dac1ab955224228659143f70fff8c01cef01029..5e333bd8ca290f96fc81dfddff66934de623614a` | `docs/reviews/2026-11-13-2dac1ab.maker.md` | FW-REV-001…008: correzione implementata, in attesa di verifica indipendente. Nessun finding contestato. FW-REV-008 risolto tenendo la voce modificata in remoto (scelta da valutare). FW-ARCH-001/002 letti, non ancora affrontati. Nessun deploy. |
