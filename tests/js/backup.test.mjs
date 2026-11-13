// Ripristino da backup JSON (static/js/backup.js, FW-ARCH-001): la conferma deve dire quali dati vengono
// sostituiti e quali restano, e deve coincidere con ciò che fa il server (tests/test_restore_matrix.py).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMAIN_LABELS, isBackup, restoreConfirmText, restoreDoneText, restorePlan } from "../../static/js/backup.js";

const V3 = ["meal_templates", "meal_logs", "reminders", "foods"];
const V4 = ["sleep_logs", "exercise_notes", "grocery_spend"];
const file = (format, fields) => ({ format, data: {}, workout_sessions: [], ...Object.fromEntries(fields.map((f) => [f, []])) });

test("FW-ARCH-001: stesso elenco di domini del server, nello stesso ordine", () => {
  const py = readFileSync(new URL("../../app/schemas.py", import.meta.url), "utf8");
  const server = [...py.match(/BACKUP_OPTIONAL_DOMAINS = \(([^)]*)\)/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(restorePlan(file("fitweek-backup-v4", [])).kept, server);
  for (const d of ["state", "workouts", ...server]) assert.ok(DOMAIN_LABELS[d], `manca il nome leggibile di ${d}`);
});

test("FW-ARCH-001: backup v1 e v2 sostituiscono solo stato e sedute, il resto resta", () => {
  for (const format of ["fitweek-backup-v1", "fitweek-backup-v2"]) {
    assert.deepEqual(restorePlan(file(format, [])), { replaced: ["state", "workouts"], kept: [...V3, ...V4] });
    const text = restoreConfirmText(file(format, []));
    assert.match(text, /RESTANO come sono ora/);
    assert.match(text, /diario dei pasti/);
    assert.doesNotMatch(text, /tutti i dati attuali \(/, "non promette più di sostituire tutto");
  }
});

test("FW-ARCH-001: backup v3 tiene sonno, note e spese; v4 sostituisce tutto e non parla di dati che restano", () => {
  assert.deepEqual(restorePlan(file("fitweek-backup-v3", V3)).kept, V4);
  const v4 = file("fitweek-backup-v4", [...V3, ...V4]);
  assert.deepEqual(restorePlan(v4).kept, []);
  assert.doesNotMatch(restoreConfirmText(v4), /RESTANO/);
  assert.match(restoreConfirmText(v4), /salva una copia di tutti i dati attuali/);
});

test("FW-ARCH-001: conta la presenza del campo: assente o null resta, vuoto viene sostituito", () => {
  const odd = { ...file("fitweek-backup-v4", [...V3, "grocery_spend"]), exercise_notes: null };
  assert.deepEqual(restorePlan(odd).kept, ["sleep_logs", "exercise_notes"]);
  assert.ok(restorePlan(odd).replaced.includes("grocery_spend"));
});

test("FW-ARCH-001: dopo il ripristino il messaggio ripete ciò che il server non ha toccato", () => {
  assert.equal(restoreDoneText({ sessions: 3, kept: [] }), "Backup ripristinato (3 sedute)");
  assert.equal(restoreDoneText({ sessions: 1, kept: ["sleep_logs", "grocery_spend"] }), "Backup ripristinato (1 sedute). Non toccati: sonno, spese settimanali");
  assert.equal(isBackup({ format: "fitweek-backup-v4" }), true);
  assert.equal(isBackup({ format: "altro" }), false);
});
