// Copia locale delle risposte del server (solo app autonoma): permette di aprire e usare l'app senza rete.
// È una cache di lettura: le modifiche fatte offline viaggiano nella coda (workout/queue.js) e nello stato
// in attesa (store.js), non qui.
const PREFIX = "fitweek.cache.v1:";

export function put(path, data) {
  const value = JSON.stringify({ at: Date.now(), data });
  try {
    localStorage.setItem(PREFIX + path, value);
  } catch {
    // Spazio esaurito: si liberano le voci meno importanti (intervalli del diario) e si riprova una volta.
    for (const key of keys()) if (/meal-logs|food-search/.test(key)) localStorage.removeItem(PREFIX + key);
    try {
      localStorage.setItem(PREFIX + path, value);
    } catch {
      /* senza copia locale l'app funziona comunque quando c'è rete */
    }
  }
}

/** @returns {{at: number, data: any} | null} */
export function get(path) {
  try {
    const raw = localStorage.getItem(PREFIX + path);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function keys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(PREFIX)) out.push(key.slice(PREFIX.length));
    }
  } catch {
    /* archivio non disponibile */
  }
  return out;
}

export function clear() {
  for (const key of keys()) localStorage.removeItem(PREFIX + key);
}
