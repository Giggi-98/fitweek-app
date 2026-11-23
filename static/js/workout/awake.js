// Schermo acceso durante la seduta (Screen Wake Lock API, Chrome e WebView Android). Android rilascia il blocco
// quando l'app va in secondo piano: al ritorno si richiede se la seduta è ancora aperta. Dove l'API non c'è,
// non succede nulla.
let lock = null;
let wanted = false;

async function acquire() {
  if (!wanted || lock || document.visibilityState !== "visible" || !navigator.wakeLock) return;
  try {
    lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => (lock = null));
  } catch {
    lock = null; // es. risparmio energetico attivo: lo schermo si comporta come sempre
  }
}

/** true durante una seduta aperta, false altrimenti. */
export function keepAwake(on) {
  wanted = on;
  if (on) acquire();
  else lock?.release().catch(() => {});
}

document.addEventListener("visibilitychange", acquire);
