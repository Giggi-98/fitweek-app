// Codice a barre → prodotto. La lettura con la fotocamera esiste solo nell'app Android (plugin nativo
// `BarcodeScan`, in mobile/build/build-inside.sh); il codice si può sempre anche scrivere a mano.
// I valori arrivano da Open Food Facts tramite il server (`/api/v1/food-barcode/{codice}`, fonte "off"):
// serve la rete, e se il prodotto non c'è si copiano i valori dall'etichetta.
import { request } from "./api.js";

const scanner = () => globalThis.Capacitor?.Plugins?.BarcodeScan || null;

export const canScan = () => Boolean(scanner());
/** EAN-8, UPC, EAN-13, ITF-14: solo cifre. */
export const isBarcode = (text) => /^\d{8,14}$/.test(String(text).trim());

/** Apre la fotocamera sul codice. @returns il codice letto, o null se l'utente ha chiuso senza leggere */
export async function scan() {
  const out = await scanner().scan();
  return out.code && isBarcode(out.code) ? out.code : null;
}

/** @returns {{enabled: boolean, item: {name, brand, kcal_100g, protein_100g, serving_g} | null}} */
export const lookup = (code) => request(`/api/v1/food-barcode/${code}`, { timeout: 12000 });

/** Valori di una porzione in grammi dai valori per 100 g (proteine a un decimale, null se sconosciute). */
export const portion = (product, grams) => ({
  kcal: Math.round((product.kcal_100g * grams) / 100),
  protein: product.protein_100g == null ? null : Math.round((product.protein_100g * grams) / 10) / 10,
});
