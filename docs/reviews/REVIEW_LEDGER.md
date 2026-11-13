# FitWeek — Independent Engineering Review Ledger

## Repository and review archive
- Repository: `Giggi-98/fitweek-app`
- Application branch: `main`
- Review archive branch: `review/engineering`
- Initialized: 2026-11-13
- Branch creation base commit (application): `2dac1ab955224228659143f70fff8c01cef01029`
- Last verified reviewed application commit: **NONE (null)**
- Review status: **INCREMENTAL_REVIEW_COMPLETED_TO_24F1A8B — MODIFICHE RICHIESTE; OFFICIAL CHECKPOINT NULL**
- Initial review verdict: **MODIFICHE RICHIESTE**
- Last review report: `docs/reviews/2026-11-13-24f1a8b.md`
- Candidate baseline SHA (static code audit, *not* approved checkpoint): `2dac1ab955224228659143f70fff8c01cef01029`
- Candidate latest incrementally examined application HEAD: `24f1a8bd46d51fc49b93ac8863e7693e3f98adb6`

> Branch creation base and candidate baseline are not automatically approved or fully verified checkpoints. Reviews now include static analysis and independently executed JS tests, but production, APK and real-device behavior have not been tested.

## Checkpoint tracking
| Field | Value |
| --- | --- |
| Initial Git base | `2dac1ab955224228659143f70fff8c01cef01029` |
| Candidate static baseline | `2dac1ab955224228659143f70fff8c01cef01029` |
| Candidate incrementally examined HEAD | `24f1a8bd46d51fc49b93ac8863e7693e3f98adb6` |
| Last verified reviewed application commit | `null` |
| Latest fully reviewed application SHA | `null` |
| Pending review | Correct FW-REV-010 legacy-token rollback; runtime verification of baseline and FW-REV-002/009; Python, Playwright, Android/APK and real-device checks pending |
| Checkpoint advancement authorized | No automatic advancement |

The initial baseline review did not compare incremental diffs: there is no earlier reviewed application checkpoint. Review-only branch commits must not be counted as application changes.

## Findings registry
| ID | Severity | Summary | State | First seen | Last verified |
| --- | --- | --- | --- | --- | --- |
| FW-REV-001 | P1 | In-flight queue dedup can discard newer set operation | Open — reviewer JS tests pass; broader runtime pending | 2026-11-13 | `24f1a8b`: queue settlement tests passed independently |
| FW-REV-002 | P1 | Deleted set can be recreated by stale offline PUT (no tombstone) | Open — tombstone and millisecond fixes supported statically; runtime pending | 2026-11-13 | `e014e0d`: migration 9 and `1418d74` timestamp fix; linked FW-REV-009 |
| FW-REV-003 | P1 | Same-day meal plan merge overwrites independent slot edits | Open — reviewer JS tests pass; broader runtime pending | 2026-11-13 | `24f1a8b`: per-slot merge tests passed independently |
| FW-REV-004 | P2 | JSON export lacks cross-table read snapshot | Open — fix supported statically; tests pending | 2026-11-13 | `5e333bd`: SQLite snapshot |
| FW-REV-005 | P2 | Failed Android Keystore migration can drop legacy persistent token | Open — migration tests pass; legacy-token interaction still fails; see FW-REV-010 | 2026-11-13 | `24f1a8b`: independent probe confirmed persistent-copy loss on incomplete logout |
| FW-REV-006 | P2 | Logout leaves pending queue to replay on next login | Open — queue-clearing JS test passes; Android/relogin E2E pending | 2026-11-13 | `24f1a8b`: clearQueue test passed independently; see FW-REV-010 |
| FW-REV-007 | P3 | Training-program documentation stale vs current seed | Corrected in repository (static verification); production not checked | 2026-11-13 | `5e333bd`: documentation corrected |
| FW-REV-008 | P2 | Local delete vs remote update is silently resolved without conflict notification | Open — conflict JS tests pass; multi-device runtime pending | 2026-11-13 | `24f1a8b`: conflict tests passed independently |

| FW-REV-009 | P1 | Timestamp truncated to seconds allows stale offline PUT after same-second DELETE | Open — specific code defect corrected; runtime verification pending | 2026-11-13 | `1418d74`: `app/workouts.py:39-51`, `tests/test_edit_time.py`; same-ms ties remain last-arrival wins |
| FW-REV-010 | P2 | Logout may leave valid Keystore token after clear and HTTP revoke fail | Open — `8277cb1` main path passes; legacy-token rollback defect confirmed | 2026-11-13 | `24f1a8b`: `setToken(null)` removes legacy token before incomplete outcome; independent reproduction |

**Resolved findings:** no application finding formally closed. FW-REV-007 documentation corrected in code inspection. Stable IDs must remain unchanged; do not close without code-and-test verification. **Risk tracked, not an unproven vulnerability finding:** unencrypted HTTP on LAN documented in `docs/SECURITY.md`.

## Review history
| Date | Application range | Verdict | Report | Notes |
| --- | --- | --- | --- | --- |
| 2026-11-13 | Not reviewed | Not issued | — | Branch initialization; Git base `2dac1ab` only |
| 2026-11-13 | Initial baseline audit targeting `2dac1ab` | MODIFICHE RICHIESTE | `2026-11-13-2dac1ab.md` | Static audit; eight open findings, full checkpoint remains null |
| 2026-11-13 | `2dac1ab..5e333bd` (5 commits, static) | MODIFICHE RICHIESTE | `2026-11-13-5e333bd.md` | Seven original fixes supported statically, FW-REV-002 incomplete, FW-REV-009/010 new; checkpoint null |
| 2026-11-13 | `5e333bd..e014e0d` (7 commits, static) | APPROVATO CON RISERVE (static only) | `2026-11-13-e014e0d.md` | FW-REV-009 and original FW-REV-002 code path corrected statically; FW-REV-010 conditional localStorage failure remains untested; checkpoint null |
| 2026-11-13 | `e014e0d..439dc83` (4 commits, static) | APPROVATO CON RISERVE (static only) | `2026-11-13-439dc83.md` | FW-REV-010 triple-failure mitigations, UX/ARCH fixes; storage-recovery residual risk and all runtime tests pending; checkpoint null |
| 2026-11-13 | `439dc83..24f1a8b` (4 commits) | MODIFICHE RICHIESTE | `2026-11-13-24f1a8b.md` | Main FW-REV-010 path and UX fixes supported; 88/88 JS tests pass; legacy-token rollback defect confirmed; checkpoint null |

## Test evidence
- Reviewer-executed application tests at `24f1a8b`: targeted logout/UI Node tests **21 passed, 0 failed**; complete `tests/js` suite **88 passed, 0 failed**.
- Reviewer-executed independent probe: FW-REV-010 legacy token + failed migration/revocation/wipe/markers reproduced persistent-token loss after `signOut() === false`; server session remains valid.
- Test source was reconstructed from exact GitHub blobs because ordinary HTTPS clone was blocked by the container proxy (403). This is not a repository test failure.
- Developer-declared tests: maker handoffs at `d57212b`, `1e7702d`, `439dc83` and the 1.10.7 commits remain unverified except for the independently executed JS suite above.
- Not executed: pytest, Playwright/E2E, responsive visual review, real Android APK/WebView/SecureToken, real offline/multi-device synchronization, production/deployment, restore rehearsal and PDF cross-check.

## Next action
Correct FW-REV-010 without creating a duplicate finding: an incomplete logout must not delete a pre-existing legacy persistent token, while a token originating only in Keystore must never be copied into clear-text storage. Add the legacy migration-failure regression matrix, then run Python, Playwright and Android/real-device verification. Continue runtime validation of FW-REV-002/009. Official checkpoint remains `null`; candidate examined chronology is `24f1a8b`.

## Concurrency and safeguards
Reread the branch HEAD and Ledger blob SHA immediately before writing. If changed, reconcile, do not overwrite concurrent changes. Write only to `review/engineering` with owner authorization, reread the saved files, never edit `main`, application code, issues or PRs without separate approval.

## Maker notes
Sezione scritta dal maker (Claude Code), solo in aggiunta. Non è stato verificato dal reviewer e non cambia lo stato dei finding né il checkpoint qui sopra.

| Data | Risponde a | `main` da revisionare | Risposta | Nota |
| --- | --- | --- | --- | --- |
| 2026-11-13 | `2026-11-13-2dac1ab.md` | `2dac1ab955224228659143f70fff8c01cef01029..5e333bd8ca290f96fc81dfddff66934de623614a` | `docs/reviews/2026-11-13-2dac1ab.maker.md` | FW-REV-001…008: correzione implementata, in attesa di verifica indipendente. Nessun finding contestato. FW-REV-008 risolto tenendo la voce modificata in remoto (scelta da valutare). FW-ARCH-001/002 letti, non ancora affrontati. Nessun deploy. |
