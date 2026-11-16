import test from "node:test";
import assert from "node:assert/strict";
import { SHAKER_ID, alternatives, hadShake, milkFood, powderReady, proteinAdvice, shakeItems } from "../../static/js/protein.js";

const agenda = [
  { action: "log_meal", slot: "lunch", time: "13:00" },
  { action: "log_meal", slot: "pre_workout", time: "18:30" },
  { action: "start_workout", slot: null, time: "19:15" },
  { action: "log_meal", slot: "dinner", time: "22:30" },
];
const advice = (over = {}) => proteinAdvice({ target: 130, protein: 42, gymDay: true, agenda, logs: [], nowMin: 14 * 60, ...over });
const powder = { name: "Whey", scoopG: 30, proteinG: 24, kcal: 118 };

test("senza un riferimento scelto dall'utente non c'è nessun consiglio", () => {
  assert.equal(advice({ target: null }), null);
  assert.equal(advice({ target: 0 }), null);
});

test("giorno di palestra: shaker dopo la palestra, all'ora della cena; scatta solo a quell'ora", () => {
  const a = advice();
  assert.deepEqual([a.state, a.time, a.when, a.due, a.missing], ["suggest", "22:30", "dopo la palestra", false, 88]);
  assert.equal(advice({ nowMin: 22 * 60 + 30 }).due, true);
  assert.equal(advice({ agenda: [] }).time, "22:15"); // nessun promemoria della cena: rientro dalla palestra
});

test("giorno senza palestra: a metà pomeriggio, all'ora dello spuntino se c'è", () => {
  assert.deepEqual([advice({ gymDay: false }).time, advice({ gymDay: false }).when], ["18:30", "a metà pomeriggio"]);
  assert.equal(advice({ gymDay: false, agenda: [] }).time, "17:00");
});

test("riferimento raggiunto o shaker già preso: nessun suggerimento", () => {
  assert.deepEqual([advice({ protein: 130 }).state, advice({ protein: 150 }).missing], ["reached", 0]);
  const shake = [{ status: "eaten", items: shakeItems(powder, 1) }];
  assert.equal(advice({ logs: shake }).state, "taken");
  assert.equal(hadShake([{ status: "skipped", items: shakeItems(powder, 1) }, { status: "eaten", items: [{ name: "Whey" }] }]), false);
});

test("nessun pasto con valori: mancano tutte le proteine del riferimento", () => {
  assert.deepEqual([advice({ protein: null }).missing, advice({ protein: null }).protein], [130, 0]);
});

test("voci dello shaker: valori dell'etichetta per misurino, latte dal catalogo o senza valori", () => {
  const [p] = shakeItems(powder, 1.5);
  assert.deepEqual([p.qty, p.protein_g, p.kcal, p.nutrition_source, p.food_id], [1.5, 24, 118, "label", SHAKER_ID]);
  assert.equal(shakeItems({ ...powder, source: "off" }, 1)[0].nutrition_source, "off");
  assert.equal(shakeItems({ name: "Whey", proteinG: 24 }, 1)[0].nutrition_source, null); // senza calorie: nessuna fonte da dichiarare
  const milk = milkFood([{ id: "a", name: "Cioccolatte", use_count: 9 }, { id: "b", name: "Latte intero", kcal: 160, protein_g: 8, nutrition_source: "label", use_count: 1 }, { id: "c", name: "Latte di soia", use_count: 3 }]);
  assert.equal(milk.id, "c");
  assert.deepEqual(shakeItems(powder, 1, { name: "Latte" })[1], { name: "Latte", category: "altro", qty: 1, kcal: null, protein_g: null, nutrition_source: null, food_id: null, takeaway: false });
  assert.equal(powderReady({ name: "Whey" }), false);
  assert.equal(powderReady(powder), true);
});

test("alternative: almeno 10 g di proteine, prima ciò che è in dispensa, mai la polvere stessa", () => {
  const foods = [
    { id: "1", name: "Mela", protein_g: 0 }, { id: "2", name: "Pollo alla griglia", protein_g: 35 }, { id: "3", name: "Yogurt greco", protein_g: 17 },
    { id: "4", name: "Whey", protein_g: 24 }, { id: "5", name: "Pane", protein_g: null }, { id: "6", name: "Uova sode", protein_g: 13 },
  ];
  const out = alternatives(foods, [{ name: "Yogurt greco" }, { name: "Uova" }], "whey");
  assert.deepEqual(out.map((f) => [f.name, f.inPantry]), [["Yogurt greco", true], ["Uova sode", true], ["Pollo alla griglia", false]]);
  assert.equal(alternatives(foods, [], "", 1).length, 1);
});
