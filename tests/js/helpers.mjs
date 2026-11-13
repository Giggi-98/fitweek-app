// Ambiente minimo del browser per provare in Node i moduli che usano localStorage, document e fetch.
export function fakeBrowser() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  return data;
}

/** fetch finto: ogni chiamata resta in sospeso finché il test non la chiude con `reply(i, status, body)`. */
export function deferredFetch() {
  const calls = [];
  globalThis.fetch = (url, options = {}) =>
    new Promise((resolve, reject) => {
      calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers, resolve, reject });
    });
  const reply = (i, status = 200, body = { ok: true }) =>
    calls[i].resolve({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
  const fail = (i) => calls[i].reject(new TypeError("rete assente"));
  return { calls, reply, fail };
}

/** Lascia girare le promesse in sospeso (più giri: la coda attraversa diversi await). */
export const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
