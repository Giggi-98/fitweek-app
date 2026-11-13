// Ripristino da backup JSON: cosa viene sostituito e cosa resta (regole pure, FW-ARCH-001).
// Il server sostituisce sempre stato e sedute; gli altri domini solo se il file li contiene
// (stesso elenco e stesso ordine di BACKUP_OPTIONAL_DOMAINS in app/schemas.py). I backup più vecchi non li
// hanno tutti: quei dati restano come sono ora, e l'utente lo deve leggere PRIMA di confermare.
const ALWAYS = ["state", "workouts"];
const OPTIONAL = ["meal_templates", "meal_logs", "reminders", "foods", "sleep_logs", "exercise_notes", "grocery_spend"];
export const DOMAIN_LABELS = {
  state: "profilo, scheda, piano pasti, lista della spesa, dispensa e pesate",
  workouts: "sedute e serie di allenamento",
  meal_templates: "pasti abituali",
  meal_logs: "diario dei pasti",
  reminders: "promemoria",
  foods: "catalogo degli alimenti",
  sleep_logs: "sonno",
  exercise_notes: "note degli esercizi",
  grocery_spend: "spese settimanali",
};

export const isBackup = (obj) => /^fitweek-backup-v[1234]$/.test(obj?.format || "");

/** @returns {{replaced: string[], kept: string[]}} chiavi dei domini, come nella risposta di /api/v1/restore */
export function restorePlan(obj) {
  const present = OPTIONAL.filter((d) => obj?.[d] != null);
  return { replaced: [...ALWAYS, ...present], kept: OPTIONAL.filter((d) => !present.includes(d)) };
}

const list = (keys) => keys.map((k) => `• ${DOMAIN_LABELS[k] || k}`).join("\n");

/** Testo della conferma prima del ripristino. */
export function restoreConfirmText(obj) {
  const { replaced, kept } = restorePlan(obj);
  return `Il ripristino SOSTITUISCE con il contenuto del backup:\n${list(replaced)}\n\n`
    + (kept.length
      ? `RESTANO come sono ora, perché questo backup non li contiene:\n${list(kept)}\n\n`
      : "")
    + "Prima di procedere il server salva una copia di tutti i dati attuali. Continuare?";
}

/** Messaggio dopo il ripristino, dalla risposta del server. */
export function restoreDoneText(out) {
  const kept = out.kept || [];
  return `Backup ripristinato (${out.sessions} sedute)`
    + (kept.length ? `. Non toccati: ${kept.map((k) => DOMAIN_LABELS[k] || k).join(", ")}` : "");
}
