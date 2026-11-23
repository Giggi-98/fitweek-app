// Finestra "Stato dei dati" (1.21, tappa 4): si apre toccando l'indicatore in alto e dice in un colpo solo se
// tutto è sul server, cosa è ancora sul dispositivo, cosa è stato rifiutato e da dove arrivano i dati
// dell'orologio. Un'azione sola: "Invia ora", quando c'è qualcosa in attesa.
import { net } from "./api.js";
import { icon } from "./icons.js";
import { live } from "./live.js";
import { standalone } from "./platform.js";
import { syncState, unsentStateCount } from "./store.js";
import { openModal } from "./ui.js";
import { esc } from "./util.js";
import { healthStatus } from "./watch.js";
import { canUseWatch, wearLink } from "./wear.js";
import { flush, pendingPaths, rejected } from "./workout/queue.js";

const DOMAIN = {
  "workout-sessions": "allenamento", "workout-heart": "battito delle sedute", "meal-logs": "pasti", "meal-templates": "pasti abituali",
  foods: "catalogo dei piatti", reminders: "promemoria", sleep: "sonno", "health-days": "dati dell'orologio",
  "exercise-notes": "note degli esercizi", "grocery-spend": "spese",
};

/** "3 allenamento · 1 pasti": operazioni in attesa raggruppate per tipo di dato, nell'ordine in cui compaiono. */
export function pendingSummary(paths) {
  const counts = new Map();
  for (const p of paths) {
    const seg = p.match(/^\/api\/v1\/([a-z-]+)/)?.[1];
    const name = DOMAIN[seg] || "altro";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].map(([name, n]) => `${n} ${name}`).join(" · ");
}

const clock = (t) => new Date(t).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const row = (ic, title, sub) => `<div class="summary-row"><i>${icon(ic, "sm")}</i><div><strong>${esc(title)}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</div></div>`;

function body() {
  const paths = pendingPaths();
  const waiting = paths.length + unsentStateCount();
  const refused = rejected().length;
  const offline = net.offlineSince != null;
  const noNetwork = !offline && navigator.onLine === false; // webapp: il dispositivo sa di non avere rete
  const rows = [
    offline ? row("wifi-off", "Server non raggiungibile", `Lavori sui dati delle ${clock(net.offlineSince)}: tutto quello che registri resta sul dispositivo e parte da solo.`)
      : noNetwork ? row("wifi-off", "Senza rete", "Quello che registri resta sul dispositivo e parte appena torna la rete.")
      : live.connected ? row("circle-check", "Collegato al server", "Le modifiche fatte su altri dispositivi arrivano subito.")
      : row("info", "Collegamento in tempo reale non attivo", "Le modifiche fatte qui partono appena il server risponde; quelle fatte altrove arrivano quando torni sull'app."),
    waiting ? row("hourglass", `${waiting} ${waiting === 1 ? "modifica" : "modifiche"} ancora sul dispositivo`, [pendingSummary(paths), unsentStateCount() ? "profilo, spesa o pesate" : ""].filter(Boolean).join(" · "))
      : row("check", "Tutto salvato sul server", ""),
    refused ? row("triangle-alert", `${refused} ${refused === 1 ? "modifica rifiutata" : "modifiche rifiutate"}`, "Il server non le ha accettate: le trovi in Impostazioni → Dati e accesso, dove puoi riprovarle o scartarle.") : "",
    standalone && healthStatus.last ? row("watch", "Health Connect", `Ultima lettura: ${clock(healthStatus.last)}`) : "",
    canUseWatch() ? row("activity", "App sull'orologio", wearLink.lastAt ? `Ultimo messaggio: ${clock(wearLink.lastAt)}` : "Nessun messaggio da quando l'app è aperta") : "",
  ].filter(Boolean);
  return `<h2 id="modal-title">Stato dei dati</h2>
    <div class="summary-list">${rows.join("")}</div>
    ${waiting && !offline && !noNetwork ? `<button type="button" class="btn primary full" data-m="send">${icon("refresh-cw", "sm")}Invia ora</button>` : ""}
    <div class="modal-secondary"><button type="button" data-m="close">Chiudi</button></div>`;
}

export function openStatus() {
  openModal(body(), async (t) => {
    if (t.dataset.m === "close") return true;
    if (t.dataset.m !== "send") return false;
    await Promise.all([flush(), syncState()]);
    document.querySelector("#modal-body").innerHTML = body();
    return false;
  });
}
