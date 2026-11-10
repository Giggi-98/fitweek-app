// Utilità pure, senza stato.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape obbligatorio per OGNI valore interpolato in HTML. */
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const money = (n) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(num(n));
export const fmtNum = (n, digits = 1) =>
  num(n).toLocaleString("it-IT", { maximumFractionDigits: digits });

export const isoDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fmtDate = (iso) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }) : "";
export const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
export const fmtClock = (secs) => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id${Date.now()}${Math.random().toString(36).slice(2)}`;

/** Solo link https: i video arrivano dai dati. */
export const safeUrl = (u) => (/^https:\/\/[^\s"'<>]+$/.test(String(u || "")) ? String(u) : "");

/** localStorage che non lancia mai (modalità privata, quota piena…). */
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* niente da fare */
    }
  },
};

export const TIME24 = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Campo orario 24 ore: aggiunge da solo i ":" mentre scrivi (es. 0730 → 07:30). */
export function normalizeTime(v) {
  const digits = String(v).replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}
/** Minuti → "7 h 30". */
export const fmtDuration = (min) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(Math.round(min % 60)).padStart(2, "0")}` : ""}`;
