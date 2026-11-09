// Lista spesa e dispensa (blob v1; storico, quantità numeriche e generazione automatica in M5).
import { app, persistState } from "../store.js";
import { empty, panel, sectionTitle, stat, toast } from "../ui.js";
import { esc, money, num, uid } from "../util.js";

const CATEGORIES = ["Spuntini", "Proteine", "Verdure e frutta", "Dispensa", "Altro"];

export function render() {
  const g = app.state.groceries;
  const budget = num(app.state.profile.budget);
  const total = g.reduce((s, x) => s + num(x.price), 0);
  const remaining = g.filter((x) => !x.checked).reduce((s, x) => s + num(x.price), 0);
  const ratio = budget ? Math.min(100, (total / budget) * 100) : 0;
  const categories = [...new Set([...CATEGORIES, ...g.map((x) => x.category || "Altro")])].filter((c) =>
    g.some((x) => (x.category || "Altro") === c),
  );
  return (
    sectionTitle("Una spesa, zero sprechi.", "Lista settimanale e quello che hai già in casa.", '<span class="pill">Consegna: lunedì</span>') +
    `<div class="metrics">${stat("Totale stimato", money(total), "prezzi da verificare su Esselunga")}${stat("Da prendere", money(remaining), "articoli non spuntati")}${stat("Budget", money(budget), "settimanale")}${stat("Dispensa", app.state.inventory.length, "alimenti censiti")}</div>
    <div class="twocol"><div class="stack">${panel(
      "Lista della spesa",
      `<div class="bar ${total > budget ? "over" : ""}"><div style="width:${ratio}%"></div></div>
      <p class="subtle">${total > budget ? "<strong>Oltre il budget stimato.</strong>" : "Nel budget stimato (consegna esclusa)."} I prezzi sono stime inserite a mano, non quotazioni.</p>
      ${categories
        .map(
          (cat) =>
            `<div class="tiny-label group-label">${esc(cat)}</div>${g
              .filter((x) => (x.category || "Altro") === cat)
              .map(
                (x) =>
                  `<label class="shopitem ${x.checked ? "done" : ""}"><input type="checkbox" data-check-item="${esc(x.id)}" ${x.checked ? "checked" : ""}><span class="shop-main"><span class="shopname">${esc(x.name)}</span><span class="shopqty">${esc(x.qty)}</span></span><span class="shopprice">${money(x.price)}</span><button type="button" class="icon-btn" data-remove-shop="${esc(x.id)}" aria-label="Rimuovi ${esc(x.name)}">×</button></label>`,
              )
              .join("")}`,
        )
        .join("") || empty("Lista vuota", "Aggiungi i prodotti qui sotto.")}
      <div class="button-row"><button class="btn small" data-copy-shopping>Copia lista</button><button class="btn small" data-clear-shopping>Deseleziona tutto</button></div>`,
    )}${panel(
      "Aggiungi alla spesa",
      `<form id="shopping-form" class="stack"><div class="form-grid"><div class="field"><label for="sh-name">Prodotto</label><input id="sh-name" name="name" required maxlength="120" placeholder="es. Banane"></div><div class="field"><label for="sh-qty">Quantità</label><input id="sh-qty" name="qty" required maxlength="60" placeholder="es. 1 kg"></div><div class="field"><label for="sh-price">Prezzo stimato (€)</label><input id="sh-price" name="price" type="number" min="0" step="0.01" value="0" inputmode="decimal"></div><div class="field"><label for="sh-cat">Categoria</label><select id="sh-cat" name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></div></div><button class="btn primary" type="submit">+ Aggiungi prodotto</button></form>`,
    )}</div><div class="stack">${panel(
      "Dispensa",
      `${app.state.inventory.length ? app.state.inventory.map((x) => `<div class="entry"><div><div class="entry-title">${esc(x.name)}</div><div class="entry-sub">${esc(x.qty)}${x.expiry ? " · scade " + esc(x.expiry) : ""}</div></div><button type="button" class="icon-btn" data-remove-inv="${esc(x.id)}" aria-label="Rimuovi ${esc(x.name)}">×</button></div>`).join("") : empty("Dispensa non ancora censita", "Comincia da 3–4 alimenti già in casa.")}
      <hr class="separator"><form id="inventory-form" class="stack"><div class="field"><label for="in-name">Alimento</label><input id="in-name" name="name" required maxlength="120" placeholder="es. Riso"></div><div class="form-grid"><div class="field"><label for="in-qty">Quantità</label><input id="in-qty" name="qty" required maxlength="60" placeholder="es. 300 g"></div><div class="field"><label for="in-exp">Scadenza (facoltativa)</label><input id="in-exp" name="expiry" type="date"></div></div><button class="btn primary" type="submit">+ Aggiungi in dispensa</button></form>`,
    )}${panel("Da ricordare", '<div class="inline-note">Nessuna integrazione con Esselunga: copia la lista e verifica prezzi, disponibilità e ordine minimo sul sito.</div><div class="inline-note warn"><strong>Conservazione:</strong> sottovuoto non significa conservabile senza limiti. Segui etichetta e temperatura.</div>')}</div></div>`
  );
}

export async function onClick(t) {
  if (t.dataset.removeShop) {
    app.state.groceries = app.state.groceries.filter((x) => x.id !== t.dataset.removeShop);
    persistState();
    return true;
  }
  if (t.dataset.removeInv) {
    app.state.inventory = app.state.inventory.filter((x) => x.id !== t.dataset.removeInv);
    persistState();
    return true;
  }
  if (t.matches("[data-clear-shopping]")) {
    app.state.groceries.forEach((x) => (x.checked = false));
    persistState();
    return true;
  }
  if (t.matches("[data-copy-shopping]")) {
    const text = app.state.groceries.filter((x) => !x.checked).map((x) => `${x.name} — ${x.qty}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Lista copiata");
    } catch {
      prompt("Copia la lista:", text); // fallback su HTTP, dove la Clipboard API non è disponibile
    }
    return false;
  }
  return false;
}

export function onChange(t) {
  if (!t.dataset.checkItem) return false;
  const item = app.state.groceries.find((x) => x.id === t.dataset.checkItem);
  if (item) {
    item.checked = t.checked;
    persistState();
  }
  return true;
}

export async function onSubmit(form, data) {
  if (form.id === "shopping-form") {
    app.state.groceries.push({ id: uid(), name: data.name.trim(), qty: data.qty.trim(), price: Math.max(0, num(data.price)), category: data.category, checked: false });
    if (await persistState()) toast("Prodotto aggiunto");
    return true;
  }
  if (form.id === "inventory-form") {
    app.state.inventory.push({ id: uid(), name: data.name.trim(), qty: data.qty.trim(), expiry: data.expiry || "" });
    if (await persistState()) toast("Alimento aggiunto");
    return true;
  }
  return false;
}
