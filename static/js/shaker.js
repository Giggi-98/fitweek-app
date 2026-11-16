// Proteine di oggi: quanto manca al riferimento scelto dall'utente, lo shaker (misurini, acqua o latte) e
// gli alimenti del catalogo da mangiare al suo posto. Le regole sono in protein.js.
import { SOURCE_LABEL } from "./constants.js";
import { icon } from "./icons.js";
import { haptic } from "./motion.js";
import { alternatives, milkFood, powderReady, proteinAdvice, shakeItems } from "./protein.js";
import { app } from "./store.js";
import { choices, openModal, toast } from "./ui.js";
import { esc, fmtNum, isoDate, storage, uid } from "./util.js";
import { commit, enqueue } from "./workout/queue.js";

const PREFS_KEY = "fitweek.shaker.v1"; // ultima scelta su questo dispositivo: misurini e liquido
const prefs = () => ({ scoops: 1, liquid: "water", ...storage.get(PREFS_KEY, {}) });

/** Il consiglio di adesso, dai dati già caricati. null se l'utente non ha scelto un riferimento. */
export function adviceNow(now = new Date()) {
  const today = app.weekly?.days?.find((d) => d.date === app.today.date);
  return proteinAdvice({
    target: app.weekly?.targets?.protein_g, protein: today?.protein_estimate_g, gymDay: Boolean(app.today.routine),
    agenda: app.agenda, logs: app.dayLogs, nowMin: now.getHours() * 60 + now.getMinutes(),
  });
}

const STATUS = {
  taken: () => "Shaker già registrato oggi.",
  reached: () => "Riferimento raggiunto: oggi lo shaker non serve.",
  suggest: (a) => (a.due ? `Mancano circa ${a.missing} g: è il momento dello shaker, oppure di una delle alternative qui sotto.` : `Mancano circa ${a.missing} g. Se a quell'ora mancano ancora: shaker ${a.when}, verso le ${a.time}.`),
};

const values = (i) => `${i.protein_g != null ? `${fmtNum(i.protein_g * (i.qty || 1))} g proteine` : "proteine non indicate"}${i.kcal != null ? ` · ${fmtNum(i.kcal * (i.qty || 1), 0)} kcal` : ""}`;

function logMeal(items, message) {
  enqueue("PUT", `/api/v1/meal-logs/${uid()}`, { date: app.today?.date || isoDate(), slot: "other", status: "eaten", items, description: "", note: "" });
  haptic(12);
  toast(message);
  commit();
}

export function openProtein() {
  const st = prefs();
  const powder = app.state.profile.proteinPowder;
  const ready = powderReady(powder);
  const milk = milkFood(app.foods);
  const others = alternatives(app.foods, app.state.inventory, powder?.name);

  const render = () => {
    const a = adviceNow();
    const pct = a ? Math.min(100, Math.round((a.protein / a.target) * 100)) : 0;
    const items = ready ? shakeItems(powder, st.scoops, st.liquid === "milk" ? milk || { name: "Latte" } : null) : [];
    const head = a
      ? `<div class="protein-now"><strong>~${a.protein}<small> / ${fmtNum(a.target, 0)} g</small></strong><span class="badge-calc">stima dai pasti registrati</span>
          <div class="bar" role="img" aria-label="${pct}% del riferimento"><div data-pct-w="${pct}"></div></div>
          <p>${esc(STATUS[a.state](a))}</p></div>`
      : `<div class="inline-note">${icon("info")}<div>Per sapere quando serve lo shaker scegli il tuo riferimento di proteine in Impostazioni → Generale. L'app non lo calcola al posto tuo.</div></div>`;
    const shaker = ready
      ? `<div class="shaker">
          <div class="shaker-row"><span><strong>${esc(powder.name)}</strong><small>${st.scoops === 1 ? "1 misurino" : `${String(st.scoops).replace(".", ",")} misurini`}${powder.scoopG ? ` · ${fmtNum(powder.scoopG * st.scoops, 0)} g` : ""}</small></span>
            <div class="qty"><button type="button" data-scoops="-1" aria-label="Meno polvere">${icon("minus", "sm")}</button><span>${String(st.scoops).replace(".", ",")}×</span><button type="button" data-scoops="1" aria-label="Più polvere">${icon("plus", "sm")}</button></div></div>
          ${choices([["water", "Con acqua"], ["milk", "Con latte"]], st.liquid, "Liquido", "liquid")}
          <p class="subtle">${items.map((i) => `${esc(i.name)}: ${esc(values(i))}${i.kcal != null || i.protein_g != null ? ` (${esc(SOURCE_LABEL[i.nutrition_source] || "etichetta")})` : ""}`).join("<br>")}${st.liquid === "milk" && !milk ? "<br>Il latte non è nel tuo catalogo: resta senza valori finché non lo aggiungi da un pasto." : ""}</p>
          <button type="button" class="btn primary xl full" data-m="shake">${icon("check")}Registra shaker</button>
        </div>`
      : `<div class="inline-note">${icon("info")}<div>Per registrare lo shaker servono i valori dell'etichetta della tua polvere (proteine per misurino).</div></div>
        <button type="button" class="btn primary full" data-m="setup">Imposta la polvere</button>`;
    const alt = others.length
      ? `<div class="pick-group"><span class="eyebrow">Oppure, al posto dello shaker</span><div class="pick-list">${others
          .map((f) => `<button type="button" class="pick" data-alt="${esc(f.id)}"><span>${esc(f.name)}${f.inPantry ? "<em>in dispensa</em>" : ""}</span><small>${fmtNum(f.protein_g)} g prot.${f.kcal != null ? ` · ${f.nutrition_source === "estimate" ? "~" : ""}${fmtNum(f.kcal, 0)} kcal` : ""} · ${esc(SOURCE_LABEL[f.nutrition_source] || "stima")}</small></button>`)
          .join("")}</div></div>`
      : "";
    openModal(
      `<div class="modal-ic">${icon("beef")}</div>
      <h2 id="modal-title">Proteine di oggi</h2>
      ${head}${shaker}${alt}
      <div class="modal-secondary"><button type="button" data-m="close">Chiudi</button></div>`,
      handle,
    );
  };

  function handle(t) {
    if (t.dataset.m === "close") return true;
    if (t.dataset.m === "setup") return (location.hash = "#settings"), true;
    if (t.dataset.scoops) st.scoops = Math.max(0.5, Math.min(4, st.scoops + 0.5 * Number(t.dataset.scoops)));
    else if (t.dataset.liquid) st.liquid = t.dataset.liquid;
    else if (t.dataset.m === "shake") {
      storage.set(PREFS_KEY, st);
      logMeal(shakeItems(powder, st.scoops, st.liquid === "milk" ? milk || { name: "Latte" } : null), "Shaker registrato");
      return true;
    } else if (t.dataset.alt) {
      const f = others.find((x) => x.id === t.dataset.alt);
      logMeal([{ name: f.name, category: f.category, qty: 1, kcal: f.kcal, protein_g: f.protein_g, nutrition_source: f.nutrition_source, food_id: f.id, takeaway: false }], `${f.name} registrato`);
      return true;
    } else return false;
    render();
    return false;
  }
  render();
}
