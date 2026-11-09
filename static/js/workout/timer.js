// Timer di recupero basato su un orario di fine (non su contatori): sopravvive a schermo spento,
// cambi di scheda e ricariche.
import { $, fmtClock, storage } from "../util.js";

const KEY = "fitweek.restTimer.v1";
const PREFS = "fitweek.prefs.v1";
let tick = null;

export const prefs = () => ({ restSeconds: 90, kgStep: 2.5, sound: true, ...storage.get(PREFS, {}) });
export const setPrefs = (p) => storage.set(PREFS, { ...prefs(), ...p });

let audioCtx = null;
function beep() {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.6);
  } catch {
    /* audio non disponibile */
  }
}

function paint() {
  const bar = $("#rest-bar");
  const t = storage.get(KEY);
  if (!t) {
    bar.classList.add("hidden");
    document.body.classList.remove("has-rest");
    return;
  }
  const left = (t.end - Date.now()) / 1000;
  bar.classList.remove("hidden");
  document.body.classList.add("has-rest");
  $("#rest-label").textContent = left > 0 ? "Recupero" : "Recupero finito";
  $("#rest-time").textContent = left > 0 ? fmtClock(left) : "Vai!";
  $("#rest-progress").style.width = `${Math.max(0, Math.min(100, (left / t.total) * 100))}%`;
  bar.dataset.done = left <= 0 ? "1" : "";
  if (left <= 0 && !t.alerted) {
    storage.set(KEY, { ...t, alerted: true });
    navigator.vibrate?.([250, 120, 250]);
    if (prefs().sound) beep();
  }
  if (left < -30) stopRest();
}

export function startRest(seconds = prefs().restSeconds) {
  storage.set(KEY, { end: Date.now() + seconds * 1000, total: seconds, alerted: false });
  // Sblocca l'audio su iOS: deve nascere da un gesto dell'utente.
  if (prefs().sound) {
    try {
      audioCtx ??= new AudioContext();
      audioCtx.resume();
    } catch {
      /* ignora */
    }
  }
  run();
}
export function addRest(seconds) {
  const t = storage.get(KEY);
  if (!t) return startRest(seconds);
  const end = Math.max(Date.now(), t.end) + seconds * 1000;
  storage.set(KEY, { end, total: Math.max(t.total, (end - Date.now()) / 1000), alerted: false });
  run();
}
export function stopRest() {
  storage.remove(KEY);
  clearInterval(tick);
  tick = null;
  paint();
}
function run() {
  paint();
  clearInterval(tick);
  tick = setInterval(paint, 250);
}
export function initRestTimer() {
  if (storage.get(KEY)) run();
  else paint();
}
