// Proteine in polvere: regole pure (testate in tests/js/protein.test.mjs).
// L'app non calcola fabbisogni: confronta le proteine dei pasti registrati con il riferimento scelto
// dall'utente (D-020) e, solo se mancano, propone QUANDO prendere lo shaker e COSA mangiare in alternativa.
// I valori della polvere sono quelli dell'etichetta, inseriti dall'utente in Impostazioni.

export const SHAKER_ID = "shaker"; // `food_id` delle voci shaker: così si riconoscono anche se la polvere cambia nome
const REST_DAY_TIME = "17:00"; // giorno senza palestra e senza promemoria di spuntino: metà pomeriggio
const ALT_MIN_PROTEIN_G = 10; // sotto, un alimento non è un'alternativa sensata a uno shaker
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** La polvere è utilizzabile solo con nome e proteine per misurino. */
export const powderReady = (powder) => Boolean(powder?.name && powder.proteinG != null);

/** Voci del pasto per uno shaker: la polvere e, se scelto, il latte preso dal catalogo (mai valori inventati:
 *  un latte che non è nel catalogo resta "senza valori"). */
export function shakeItems(powder, scoops, milk = null) {
  const items = [{ name: powder.name, category: "altro", qty: scoops, kcal: powder.kcal ?? null, protein_g: powder.proteinG,
    nutrition_source: powder.kcal == null ? null : powder.source || "label", food_id: SHAKER_ID, takeaway: false }];
  if (milk) items.push({ name: milk.name, category: milk.category || "altro", qty: 1, kcal: milk.kcal ?? null, protein_g: milk.protein_g ?? null,
    nutrition_source: milk.nutrition_source ?? null, food_id: milk.id ?? null, takeaway: false });
  return items;
}

export const hadShake = (logs) => logs.some((m) => m.status === "eaten" && (m.items || []).some((i) => i.food_id === SHAKER_ID));

/** Latte del catalogo più usato (per lo shaker con il latte), o null. */
export const milkFood = (foods) =>
  foods.filter((f) => /^latte\b/i.test(f.name)).sort((a, b) => (b.use_count || 0) - (a.use_count || 0))[0] || null;

/**
 * Consiglio di oggi. null = niente da dire (nessun riferimento scelto).
 * @param agenda promemoria di oggi [{action, slot, time}]
 * @returns {{state: "suggest"|"reached"|"taken", time: "HH:MM", when: string, due: boolean, missing: number, protein: number, target: number}}
 *   `suggest` = mancano proteine; `due` = l'orario consigliato è arrivato; `missing` in grammi (0 se raggiunto)
 */
export function proteinAdvice({ target, protein, gymDay, agenda, logs, nowMin }) {
  if (!target) return null;
  const at = (pick) => agenda.find(pick)?.time;
  // Giorno di palestra: al rientro, con la cena. Altrimenti all'ora dello spuntino.
  const time = gymDay
    ? at((i) => i.action === "log_meal" && i.slot === "dinner") || "22:15"
    : at((i) => i.action === "log_meal" && (i.slot === "snack" || i.slot === "pre_workout")) || REST_DAY_TIME;
  const have = protein || 0;
  const missing = Math.max(0, Math.round(target - have));
  return {
    state: hadShake(logs) ? "taken" : missing === 0 ? "reached" : "suggest",
    time, when: gymDay ? "dopo la palestra" : "a metà pomeriggio",
    due: nowMin >= toMin(time), missing, protein: Math.round(have), target,
  };
}

/**
 * Alimenti del catalogo da proporre al posto dello shaker: almeno 10 g di proteine a porzione, prima quelli
 * che risultano in dispensa, poi i più proteici. La polvere stessa (che il catalogo impara dopo il primo
 * shaker) è esclusa.
 */
export function alternatives(foods, inventory, powderName = "", limit = 4) {
  const stocked = inventory.map((x) => x.name.trim().toLowerCase());
  const inPantry = (f) => stocked.some((n) => n && (f.name.toLowerCase().includes(n) || n.includes(f.name.toLowerCase())));
  return foods
    .filter((f) => (f.protein_g ?? 0) >= ALT_MIN_PROTEIN_G && f.name.toLowerCase() !== powderName.trim().toLowerCase())
    .map((f) => ({ ...f, inPantry: inPantry(f) }))
    .sort((a, b) => b.inPantry - a.inPantry || b.protein_g - a.protein_g)
    .slice(0, limit);
}
