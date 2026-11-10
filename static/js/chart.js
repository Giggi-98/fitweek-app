// Grafico a linea su asse temporale reale (SVG, nessuna libreria). Regole in docs/DESIGN_SYSTEM.md:
// linea 2 px, punti ≥ 8 px con anello di superficie, griglia hairline, mirino + tooltip su hover/tocco,
// testo sempre con i token del testo. I valori sono comunque disponibili in tabella accanto al grafico.
import { dayNumber, niceTicks } from "./stats.js";
import { esc, fmtDate, fmtNum } from "./util.js";

// Tela stretta: su telefono il grafico è largo ~330 px, così testi e punti restano leggibili (punti ≥ 8 px).
const W = 420, H = 210, L = 40, R = 12, T = 12, B = 28;

/**
 * @param points  serie principale [{date, value, tip?}] in ordine di data; `tip` = riga extra nel tooltip
 * @param overlay serie calcolata facoltativa {name, points: [{date, value}]} disegnata come linea
 * @param dots    "series" (punti = la serie, uniti da una linea) | "raw" (punti neutri, la linea è l'overlay)
 */
export function lineChart({ points, overlay = null, unit = "", label = "", dots = "series", legend = [], ticks: fixedTicks = null, format = null, area: withArea = true }) {
  const show = (v) => (format ? format(v) : `${fmtNum(v)} ${unit}`.trim());
  const all = [...points, ...(overlay?.points || [])].map((p) => p.value);
  const ticks = fixedTicks || niceTicks(Math.min(...all), Math.max(...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const d0 = dayNumber(points[0].date);
  const span = Math.max(1, dayNumber(points[points.length - 1].date) - d0);
  const x = (iso) => (points.length === 1 ? (L + W - R) / 2 : L + ((dayNumber(iso) - d0) / span) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = (pts) => pts.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const linePts = overlay ? overlay.points : points;
  const line = path(linePts);
  const area = withArea && linePts.length > 1 && dots === "series"
    ? `<path class="area" d="M${x(linePts[0].date).toFixed(1)},${H - B} L${line.replaceAll(" ", " L")} L${x(linePts[linePts.length - 1].date).toFixed(1)},${H - B} Z"/>`
    : "";
  const avgAt = new Map((overlay?.points || []).map((p) => [p.date, p.value]));
  const tips = points.map((p) => ({
    x: x(p.date) / W, y: y(p.value), d: fmtDate(p.date), v: show(p.value),
    extra: [p.tip, avgAt.has(p.date) && overlay ? `${overlay.name} ${show(avgAt.get(p.date))}` : ""].filter(Boolean).join(" · "),
  }));
  const first = points[0], last = points[points.length - 1];
  return `<div class="chart-wrap" data-points="${esc(JSON.stringify(tips))}" data-w="${W}">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${esc(format ? format(v) : fmtNum(v))}</text>`).join("")}
      ${area}
      ${linePts.length > 1 ? `<polyline class="line" pathLength="1" points="${line}"/>` : ""}
      ${points.map((p) => `<circle class="dot ${dots === "raw" ? "raw" : ""}" cx="${x(p.date).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="5"/>`).join("")}
      <text class="axis" x="${L}" y="${H - 8}">${esc(fmtDate(first.date))}</text>
      ${points.length > 1 ? `<text class="axis" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(fmtDate(last.date))}</text>` : ""}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}"/>
      <circle class="hot" r="6" cx="0" cy="0"/>
    </svg>
    <div class="chart-tip"></div>
  </div>${legend.length ? `<div class="chart-legend">${legend.map(([kind, text]) => `<span><i class="key ${esc(kind)}"></i>${text}</span>`).join("")}</div>` : ""}`;
}

// Mirino: si aggancia al punto più vicino al puntatore.
function crosshair(e) {
  const wrap = e.target.closest?.(".chart-wrap[data-points]");
  document.querySelectorAll(".chart-wrap.hover").forEach((w) => w !== wrap && w.classList.remove("hover"));
  if (!wrap) return;
  const pts = JSON.parse(wrap.dataset.points);
  const box = wrap.getBoundingClientRect();
  const rel = (e.clientX - box.left) / box.width;
  const p = pts.reduce((a, b) => (Math.abs(b.x - rel) < Math.abs(a.x - rel) ? b : a));
  const width = Number(wrap.dataset.w);
  const svg = wrap.querySelector("svg");
  for (const a of ["x1", "x2"]) svg.querySelector(".cross").setAttribute(a, p.x * width);
  svg.querySelector(".hot").setAttribute("cx", p.x * width);
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
  tip.style.left = `${Math.min(Math.max(p.x * box.width, 80), box.width - 80)}px`;
  tip.style.top = `${p.y * (box.width / width)}px`;
  wrap.classList.add("hover");
}
document.addEventListener("pointermove", crosshair);
document.addEventListener("pointerdown", crosshair); // tocco su telefono
