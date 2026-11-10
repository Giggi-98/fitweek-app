// Movimento: micro-interazioni, conteggi, celebrazioni. Tutto è decorativo: con
// "riduci movimento" attivo (o API non disponibili) l'interfaccia funziona identica, senza animazioni.

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Vibrazione breve (Android/Chrome e app). */
export const haptic = (pattern = 12) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* non supportata */
  }
};

/** Transizione tra viste con View Transitions API, se presente. */
export function transition(update) {
  if (reducedMotion() || !document.startViewTransition) return update();
  document.startViewTransition(update);
}

/** Animazione d'ingresso a cascata dei blocchi di una vista (solo al cambio pagina). */
export function enter(container) {
  if (reducedMotion()) return;
  container.dataset.anim = "enter";
  clearTimeout(enter.t);
  enter.t = setTimeout(() => delete container.dataset.anim, 1200);
  countUp(container);
}

const fmt = (n, d) => n.toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Conta da 0 al valore per gli elementi [data-count] (testo finale già presente: accessibile). */
export function countUp(root) {
  if (reducedMotion()) return;
  root.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = Number(el.dataset.decimals || 0);
    const final = el.textContent;
    const start = performance.now();
    const dur = 750;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = t < 1 ? fmt(target * eased, decimals) : final;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** "Pop" elastico su un elemento (es. ✓ di una serie, valore cambiato con lo stepper). */
export function pop(el, scale = 1.18) {
  if (!el || reducedMotion() || !el.animate) return;
  el.animate(
    [{ transform: "scale(1)" }, { transform: `scale(${scale})` }, { transform: "scale(1)" }],
    { duration: 320, easing: "cubic-bezier(.34,1.56,.64,1)" },
  );
}

/** Piccolo sobbalzo verticale per un numero modificato. */
export function bump(el, dir = 1) {
  if (!el || reducedMotion() || !el.animate) return;
  el.animate(
    [{ transform: `translateY(${dir > 0 ? 6 : -6}px)`, opacity: 0.4 }, { transform: "translateY(0)", opacity: 1 }],
    { duration: 220, easing: "cubic-bezier(.22,1,.36,1)" },
  );
}

const CONFETTI_COLORS = ["#c8ff47", "#5eead4", "#fbbf24", "#f1f5f2", "#a3e635"];
/** Coriandoli leggeri (DOM + WAAPI, nessuna libreria). origin: elemento o null = centro schermo. */
export function confetti(origin = null, count = 36) {
  if (reducedMotion() || !document.body.animate) return;
  const r = origin?.getBoundingClientRect?.();
  const x = r ? r.left + r.width / 2 : innerWidth / 2;
  const y = r ? r.top + r.height / 2 : innerHeight / 3;
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  document.body.append(layer);
  let done = 0;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    if (i % 3 === 0) p.style.borderRadius = "50%";
    layer.append(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * (origin ? 120 : 220);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 60;
    const rot = (Math.random() - 0.5) * 720;
    p.animate(
      [
        { transform: "translate(-50%,-50%) scale(0.6) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 180}px)) scale(0.9) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 500, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" },
    ).onfinish = () => {
      if (++done === count) layer.remove();
    };
  }
}

/** Anello di progresso SVG (valore 0..1). Il disegno parte da 0 grazie a CSS (@keyframes ring-draw). */
export function ring(value, { size = 96, stroke = 9, label = "", sub = "", cls = "" } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return `<div class="ring ${cls}" data-vars="size:${size}px">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="ring-value" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${c.toFixed(2)}" data-vars="c:${c.toFixed(2)};off:${(c * (1 - v)).toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}"/>
    </svg>
    <div class="ring-label"><strong>${label}</strong>${sub ? `<small>${sub}</small>` : ""}</div>
  </div>`;
}
