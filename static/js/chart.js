// Grafico a linea su asse temporale reale (SVG, nessuna libreria). Regole in docs/DESIGN_SYSTEM.md:
// linea 2 px, punti ≥ 8 px con anello di superficie, griglia hairline, mirino + tooltip su hover/tocco,
// testo sempre con i token del testo. I valori sono comunque disponibili in tabella accanto al grafico.
//
// Il grafico è disegnato alla larghezza reale del contenitore (1 unità SVG = 1 px): testi e punti hanno
// la stessa misura su telefono e su uno schermo largo, invece di ingrandirsi con la pagina.
import { dayNumber, niceTicks } from "./stats.js";
import { esc, fmtDate, fmtNum } from "./util.js";

const L = 44, R = 14, T = 14, B = 30;
const MIN_LABEL_GAP = 96; // px tra due date sull'asse del tempo
const specs = new Map();
let nextId = 1;

/**
 * @param points  serie principale [{date, value, tip?}] in ordine di data; `tip` = riga extra nel tooltip
 * @param overlay serie calcolata facoltativa {name, points: [{date, value}]} disegnata come linea
 * @param dots    "series" (punti = la serie, uniti da una linea) | "raw" (punti neutri, la linea è l'overlay)
 * @returns segnaposto: il disegno avviene in `mountCharts()` dopo l'inserimento nel DOM
 */
export function lineChart(spec) {
  const id = String(nextId++);
  specs.set(id, { dots: "series", legend: [], unit: "", area: true, ...spec });
  const legend = spec.legend?.length
    ? `<div class="chart-legend">${spec.legend.map(([kind, text]) => `<span><i class="key ${esc(kind)}"></i>${text}</span>`).join("")}</div>`
    : "";
  return `<div class="chart-wrap" data-chart="${id}"><div class="chart-tip"></div></div>${legend}`;
}

const shortDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "short" });

/** Date da scrivere sull'asse: prima, ultima e quelle intermedie che non si toccano. */
function timeLabels(points, x) {
  const out = [];
  const last = points[points.length - 1];
  for (const p of points) {
    const px = x(p.date);
    if (out.length && px - out[out.length - 1].px < MIN_LABEL_GAP) continue;
    if (p !== last && x(last.date) - px < MIN_LABEL_GAP) continue;
    out.push({ px, text: shortDay(p.date) });
  }
  const end = x(last.date);
  if (points.length > 1 && out[out.length - 1].px !== end) {
    if (out.length > 1 && end - out[out.length - 1].px < MIN_LABEL_GAP) out.pop();
    out.push({ px: end, text: shortDay(last.date) });
  }
  return out;
}

function draw(wrap, s, W) {
  const H = Math.round(wrap.clientHeight) || 240;
  const { points, overlay } = s;
  const show = (v) => (s.format ? s.format(v) : `${fmtNum(v)} ${s.unit}`.trim());
  const all = [...points, ...(overlay?.points || [])].map((p) => p.value);
  const ticks = s.ticks || niceTicks(Math.min(...all), Math.max(...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const d0 = dayNumber(points[0].date);
  const span = Math.max(1, dayNumber(points[points.length - 1].date) - d0);
  const x = (iso) => (points.length === 1 ? (L + W - R) / 2 : L + ((dayNumber(iso) - d0) / span) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = (pts) => pts.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const linePts = overlay ? overlay.points : points;
  const line = path(linePts);
  const area = s.area && linePts.length > 1 && s.dots === "series"
    ? `<path class="area" d="M${x(linePts[0].date).toFixed(1)},${H - B} L${line.replaceAll(" ", " L")} L${x(linePts[linePts.length - 1].date).toFixed(1)},${H - B} Z"/>`
    : "";
  const avgAt = new Map((overlay?.points || []).map((p) => [p.date, p.value]));
  wrap.tips = points.map((p) => ({
    x: x(p.date), y: y(p.value), d: fmtDate(p.date), v: show(p.value),
    extra: [p.tip, avgAt.has(p.date) && overlay ? `${overlay.name} ${show(avgAt.get(p.date))}` : ""].filter(Boolean).join(" · "),
  }));
  const labels = timeLabels(points, x);
  const anchor = (i) => (points.length === 1 ? "middle" : i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle");
  const svg = `<svg class="chart${wrap.dataset.drawn ? " still" : ""}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.label || "")}">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="axis" x="${L - 10}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(s.format ? s.format(v) : fmtNum(v))}</text>`).join("")}
      ${area}
      ${linePts.length > 1 ? `<polyline class="line" pathLength="1" points="${line}"/>` : ""}
      ${points.map((p) => `<circle class="dot ${s.dots === "raw" ? "raw" : ""}" cx="${x(p.date).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4.5"/>`).join("")}
      ${labels.map((l, i) => `<text class="axis" x="${l.px.toFixed(1)}" y="${H - 8}" text-anchor="${anchor(i)}">${esc(l.text)}</text>`).join("")}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}"/>
      <circle class="hot" r="6" cx="0" cy="0"/>
    </svg>`;
  wrap.querySelector("svg")?.remove();
  wrap.insertAdjacentHTML("afterbegin", svg);
  wrap.dataset.drawn = `${W}x${H}`;
}

// Ridisegna quando cambia la misura (rotazione, finestra, scheda che diventa visibile).
const observer = globalThis.ResizeObserver
  ? new ResizeObserver((entries) => {
      for (const e of entries) {
        const s = specs.get(e.target.dataset.chart);
        const W = Math.round(e.contentRect.width);
        if (s && W > 0 && `${W}x${Math.round(e.contentRect.height)}` !== e.target.dataset.drawn) draw(e.target, s, W);
      }
    })
  : null;

/** Disegna i grafici presenti in `root` e dimentica quelli non più in pagina. Da chiamare dopo ogni render. */
export function mountCharts(root = document) {
  const live = new Set();
  root.querySelectorAll(".chart-wrap[data-chart]").forEach((wrap) => {
    const s = specs.get(wrap.dataset.chart);
    live.add(wrap.dataset.chart);
    if (!s) return;
    const W = Math.round(wrap.clientWidth);
    if (W > 0) draw(wrap, s, W);
    observer?.observe(wrap);
  });
  for (const id of specs.keys()) if (!live.has(id) && !document.querySelector(`.chart-wrap[data-chart="${id}"]`)) specs.delete(id);
}

// Mirino: si aggancia al punto più vicino al puntatore.
function crosshair(e) {
  const wrap = e.target.closest?.(".chart-wrap[data-chart]");
  document.querySelectorAll(".chart-wrap.hover").forEach((w) => w !== wrap && w.classList.remove("hover"));
  if (!wrap?.tips?.length) return;
  const box = wrap.getBoundingClientRect();
  const rel = e.clientX - box.left;
  const p = wrap.tips.reduce((a, b) => (Math.abs(b.x - rel) < Math.abs(a.x - rel) ? b : a));
  const svg = wrap.querySelector("svg");
  for (const a of ["x1", "x2"]) svg.querySelector(".cross").setAttribute(a, p.x);
  svg.querySelector(".hot").setAttribute("cx", p.x);
  svg.querySelector(".hot").setAttribute("cy", p.y);
  const tip = wrap.querySelector(".chart-tip");
  const strong = document.createElement("strong");
  strong.textContent = p.v;
  tip.replaceChildren(strong, document.createTextNode(` · ${p.d}`));
  if (p.extra) {
    const small = document.createElement("small");
    small.textContent = p.extra;
    tip.append(small);
  }
  tip.style.left = `${Math.min(Math.max(p.x, 80), box.width - 80)}px`;
  // Il fumetto sta sopra il punto; vicino al bordo alto passa sotto, così non esce dal riquadro.
  tip.classList.toggle("below", p.y < 56);
  tip.style.top = `${p.y}px`;
  wrap.classList.add("hover");
}
document.addEventListener("pointermove", crosshair);
document.addEventListener("pointerdown", crosshair); // tocco su telefono
