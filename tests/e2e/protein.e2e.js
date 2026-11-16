// Test end-to-end della 1.12: proteine in polvere (impostazione dal codice a barre, consiglio, shaker,
// alternative), voci della giornata che si riaprono nel loro editor, nuovo editor del pasto a due zone.
// Open Food Facts e lo scanner nativo sono simulati. Esecuzione: E2E_ONLY=protein scripts/e2e.sh
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const WHEY = '8001234567890';
const PRODUCTS = {
  [WHEY]: { code: WHEY, name: 'Whey vaniglia', brand: 'Marca', kcal_100g: 390, protein_100g: 80, serving_g: 30 },
  '80012345': { code: '80012345', name: 'Skyr bianco', brand: 'Latteria', kcal_100g: 60, protein_100g: 11, serving_g: 150 },
};

async function open(browser, device) {
  const ctx = await browser.newContext({ ...device, timezoneId: 'Europe/Rome', locale: 'it-IT', colorScheme: 'dark' });
  // Scanner nativo simulato: restituisce il codice messo in window.__scan (null = l'utente chiude la fotocamera).
  await ctx.addInitScript(() => {
    window.Capacitor = { Plugins: { BarcodeScan: { scan: async () => (window.__scan ? { code: window.__scan } : {}) } } };
  });
  const page = await ctx.newPage();
  global.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/api/v1/food-barcode/*', (r) => {
    const code = r.request().url().split('/').pop();
    r.fulfill({ json: { enabled: true, source: 'Open Food Facts (ODbL)', item: PRODUCTS[code] || null } });
  });
  await page.route('**/api/v1/food-search*', (r) => r.fulfill({ json: { enabled: true, source: 'Open Food Facts (ODbL)', items: [] } }));
  await page.goto(B);
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  const api = (path, method = 'GET', body) => page.evaluate(([p, m, b]) => fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [path, method, body]);
  return { ctx, page, api, errors };
}
const toastText = (page) => page.textContent('#toast');
const closed = (page) => page.waitForSelector('#modal', { state: 'hidden' });

(async () => {
  const browser = await chromium.launch();
  const { ctx, page, api, errors } = await open(browser, devices['iPhone 13']);
  const today = (await api('/api/v1/today')).date;
  const weekday = (await api('/api/v1/today')).weekday;
  // Giornata controllata: un solo promemoria (pranzo alle 00:01, già passato), niente popup dagli altri.
  for (const r of (await api('/api/v1/reminders')).items.filter((x) => x.weekday === weekday)) {
    await api(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  }
  await api('/api/v1/reminders/e2e-lunch', 'PUT', { weekday, time: '00:01', kind: 'meal', slot: 'lunch', title: 'Pranzo di prova', action: 'log_meal', enabled: true });
  const foods = (await api('/api/v1/foods')).items;
  const pasta = foods.find((f) => f.id === 'f-pasta');
  const item = (f, extra = {}) => ({ name: f.name, category: f.category, qty: 1, kcal: f.kcal, protein_g: f.protein_g, nutrition_source: f.nutrition_source, food_id: f.id, takeaway: false, ...extra });
  await api('/api/v1/meal-logs/e2e-lunch-log', 'PUT', { date: today, slot: 'lunch', items: [item(pasta), { name: 'Sugo della casa', category: 'salsa', qty: 1, kcal: 90, protein_g: null, nutrition_source: 'manual', takeaway: false }] });

  // 1. Senza riferimento di proteine: nessuna riga dello shaker, il riquadro spiega cosa manca
  await page.reload();
  await page.waitForSelector('.tl-item.done');
  check('senza riferimento: nessuna riga dello shaker nella giornata', (await page.locator('[data-agenda="protein-advice"]').count()) === 0);
  await page.click('[data-protein]');
  await page.waitForSelector('#modal[open]');
  const noTarget = await page.textContent('#modal-body');
  check('senza riferimento: il popup non dà numeri e rimanda alle impostazioni', /scegli il tuo riferimento/.test(noTarget) && /Imposta la polvere/.test(noTarget) && !/Mancano/.test(noTarget), noTarget.replace(/\s+/g, ' ').slice(0, 120));
  await page.click('#modal [data-m=setup]');
  await page.waitForSelector('#powder-form');

  // 2. Polvere dal codice a barre: scanner annullato, codice sbagliato, prodotto assente, prodotto trovato
  await page.evaluate(() => { window.__scan = null; });
  await page.click('[data-powder=scan]');
  await page.waitForTimeout(300);
  check('scanner chiuso senza leggere: il modulo resta vuoto', (await page.inputValue('#pw-name')) === '');
  await page.fill('#pw-code', '123');
  await page.click('[data-powder=find]');
  await page.locator('#toast', { hasText: 'da 8 a 14 cifre' }).waitFor();
  await page.fill('#pw-code', '11111111');
  await page.click('[data-powder=find]');
  await page.locator('#toast', { hasText: 'non trovato' }).waitFor();
  check('codice non valido o prodotto assente: avviso, nessun valore inventato', (await page.inputValue('#pw-protein')) === '');
  await page.evaluate((code) => { window.__scan = code; }, WHEY);
  await page.click('[data-powder=scan]');
  await page.locator('#toast', { hasText: 'Open Food Facts' }).waitFor();
  const filled = await page.evaluate(() => ['pw-name', 'pw-scoop', 'pw-protein', 'pw-kcal', 'pw-source'].map((id) => document.getElementById(id).value));
  check('codice letto: nome, misurino e valori per misurino calcolati dai 100 g', JSON.stringify(filled) === JSON.stringify(['Whey vaniglia Marca', '30', '24', '117', 'off']), JSON.stringify(filled));
  await page.fill('#pw-scoop', '25');
  check('cambiando i grammi del misurino i valori si ricalcolano', (await page.inputValue('#pw-protein')) === '20' && (await page.inputValue('#pw-kcal')) === '98', await page.inputValue('#pw-protein'));
  await page.fill('#pw-scoop', '30');
  await page.fill('#pw-kcal', '118'); // corretto guardando la confezione
  await page.click('#powder-form button[type=submit]');
  await page.locator('#toast', { hasText: 'Polvere salvata' }).waitFor();
  await page.waitForSelector('#sync[data-state=ok]');
  const powder = (await api('/api/state')).data.profile.proteinPowder;
  check('polvere salvata; un valore corretto a mano torna "etichetta"', JSON.stringify(powder) === JSON.stringify({ name: 'Whey vaniglia Marca', scoopG: 30, proteinG: 24, kcal: 118, source: 'label' }), JSON.stringify(powder));
  await page.screenshot({ path: `${SHOTS}/v112-1-polvere.png`, fullPage: true });

  // 3. Con il riferimento: riga dello shaker nella giornata, popup con quanto manca e le alternative
  await page.fill('#profile-form [name=proteinTarget]', '130');
  await page.click('#profile-form button[type=submit]');
  await page.locator('#toast', { hasText: 'Profilo aggiornato' }).waitFor();
  await page.click('.bottom-nav [data-view=dashboard]');
  const row = page.locator('.tl-item', { has: page.locator('[data-agenda="protein-advice"]') });
  await row.waitFor();
  check('con il riferimento: riga "Shaker di proteine" nella giornata', /Shaker di proteine/.test(await row.textContent()) && !(await row.getAttribute('class')).includes('overdue'), await row.textContent());
  check('la riga dello shaker non conta tra i promemoria da fare', (await page.locator('.dash-agenda .pill.accent').count()) === 0);
  await page.click('[data-agenda="protein-advice"]');
  await page.waitForSelector('#modal[open] .shaker');
  const popup = (await page.textContent('#modal-body')).replace(/\s+/g, ' ');
  check('popup: proteine di oggi contro il riferimento e grammi mancanti', /~11 \/ 130 g/.test(popup) && /Mancano circa 119 g/.test(popup), popup.slice(0, 160));
  const alts = await page.locator('#modal [data-alt]').allTextContents();
  check('alternative dal catalogo, con proteine e fonte, senza la polvere', alts.length >= 2 && alts.every((t) => /g prot\./.test(t) && !/Whey/.test(t)), alts.join(' | ').slice(0, 160));
  check('una sola azione principale nel popup', (await page.locator('#modal .btn.primary').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/v112-2-proteine.png` });

  // 4. Shaker: un misurino e mezzo, con latte (non nel catalogo → senza valori)
  await page.click('#modal [data-scoops="1"]');
  await page.click('#modal [data-liquid=milk]');
  check('latte non in catalogo: dichiarato senza valori', /resta senza valori/.test(await page.textContent('#modal .shaker')));
  await page.click('#modal [data-m=shake]');
  await closed(page);
  await page.locator('.tl-item.done [data-agenda="protein-advice"]').waitFor({ timeout: 8000 });
  const logs = (await api(`/api/v1/meal-logs?from=${today}&to=${today}`)).items;
  const shake = logs.find((m) => m.items.some((i) => i.food_id === 'shaker'));
  check('shaker registrato fuori pasto: 1,5 misurini dall\'etichetta + latte senza valori', shake && shake.slot === 'other' && shake.protein_g === 36 && shake.kcal === 177 && shake.items[0].nutrition_source === 'label' && shake.items[1].kcal === null, JSON.stringify(shake && [shake.slot, shake.protein_g, shake.kcal]));
  check('giornata: lo shaker risulta fatto e le proteine salgono', /Registrato/.test(await row.textContent()) && /~47/.test(await page.textContent('[data-protein]')), await page.textContent('[data-protein]'));
  await page.click('[data-protein]');
  await page.waitForSelector('#modal[open] .shaker');
  check('riaprendo: shaker già registrato, scelta ricordata (1,5 con latte)', /già registrato oggi/.test(await page.textContent('#modal-body')) && /1,5×/.test(await page.textContent('#modal .shaker')) && (await page.getAttribute('#modal [data-liquid=milk]', 'aria-checked')) === 'true');

  // 5. Alternativa al posto dello shaker: un tocco la registra
  const altName = (await page.locator('#modal [data-alt] span').first().textContent()).replace('in dispensa', '');
  await page.click('#modal [data-alt]');
  await closed(page);
  await page.waitForSelector('#sync[data-state=ok]');
  check('alternativa registrata come pasto', (await api(`/api/v1/meal-logs?from=${today}&to=${today}`)).items.some((m) => m.slot === 'other' && m.items.length === 1 && m.items[0].name === altName), altName);

  // 6. Giornata: il pranzo già fatto si riapre nel suo editor, con le sue voci
  const lunch = page.locator('.tl-item.done', { hasText: 'Pranzo di prova' });
  check('voce fatta: indicata come modificabile', (await lunch.locator('.tl-edit').count()) === 1);
  await lunch.locator('.tl-card').click();
  await page.waitForSelector('#modal[open] .composer');
  check('si apre "Modifica pasto" sulla scheda "Nel piatto" con le voci del pasto', (await page.textContent('#modal-title')) === 'Modifica pasto' && (await page.locator('#modal .tray-row:visible').count()) === 2);
  check('telefono: una zona alla volta, totale e salvataggio sempre visibili', (await page.locator('#c-zone-add').isHidden()) && (await page.locator('#modal [data-save]').isVisible()) && (await page.locator('#modal .composer-sum').isVisible()));
  check('proteine per voce e nel totale; voce senza proteine dichiarata', /11 g prot\./.test(await page.locator('#modal .tray-row').first().textContent()) && /almeno 11 g proteine/.test(await page.textContent('#modal .composer-sum')) && /proteine non indicate per 1/.test(await page.textContent('#modal .composer-sum')), await page.textContent('#modal .composer-sum'));
  await page.waitForTimeout(600); // il foglio sale con un'animazione: si misura da fermo
  const fit = await page.evaluate(() => {
    const d = document.querySelector('#modal').getBoundingClientRect(), f = document.querySelector('.composer-foot').getBoundingClientRect(), b = document.querySelector('#modal-body');
    return { footInside: f.bottom <= d.bottom + 1, onScreen: d.bottom <= innerHeight + 1 && d.top >= 0, bodyFixed: b.scrollHeight <= b.clientHeight + 1 };
  });
  check('la finestra non scorre nel suo insieme: scorre solo la zona', fit.footInside && fit.onScreen && fit.bodyFixed, JSON.stringify(fit));

  // 7. Correggere i valori di una voce: calorie e proteine a porzione, fonte "inserito"
  await page.locator('#modal .tray-row').nth(1).locator('[data-edit]').click();
  await page.fill('#c-edit-kcal', '120');
  await page.fill('#c-edit-prot', '4,5');
  await page.click('#modal [data-edit-ok]');
  check('totale ricalcolato dopo la correzione', /~450 kcal/.test(await page.textContent('#modal .composer-sum')) && /15,5|16 g proteine/.test(await page.textContent('#modal .composer-sum')), await page.textContent('#modal .composer-sum'));

  // 8. Aggiungere dal codice a barre (scritto a mano) e un piatto nuovo con proteine
  await page.click('#modal [data-zone=add]');
  check('scheda "Aggiungi": ricerca visibile, piatto nascosto', (await page.locator('#c-new-name').isVisible()) && (await page.locator('#c-zone-tray').isHidden()));
  await page.fill('#c-new-name', '80012345');
  await page.waitForSelector('#c-off-g', { timeout: 5000 });
  check('codice a barre nel campo di ricerca: prodotto e porzione proposti', (await page.inputValue('#c-off-g')) === '150' && /90 kcal · 16,5 g prot\./.test(await page.textContent('#c-off-kcal')), await page.textContent('#c-off-kcal'));
  check('con un codice a barre non compare la riga "a mano"', await page.locator('#c-manual').isHidden());
  await page.click('#modal [data-off-add]');
  await page.fill('#c-new-name', '99999999');
  await page.locator('#c-browse', { hasText: 'Codice non trovato' }).waitFor({ timeout: 5000 });
  check('codice sconosciuto: lo dice e invita a usare l\'etichetta', true);
  await page.fill('#c-new-name', 'Bresaola');
  await page.fill('#c-new-kcal', '75');
  await page.fill('#c-new-prot', '16');
  await page.click('#modal [data-new]');
  check('contatore della scheda "Nel piatto" aggiornato', /4/.test(await page.textContent('#modal [data-zone=tray]')), await page.textContent('#modal [data-zone=tray]'));
  await page.evaluate((code) => { window.__scan = code; }, WHEY);
  await page.click('#modal [data-scan]');
  await page.waitForSelector('#c-off-g');
  check('scanner nell\'editor: il codice letto porta al prodotto', /Whey vaniglia/.test(await page.textContent('#c-browse')) && (await page.inputValue('#c-new-name')) === WHEY);
  await page.click('#modal [data-off-back]');
  await page.screenshot({ path: `${SHOTS}/v112-3-editor-telefono.png` });
  await page.click('#modal [data-save]');
  await closed(page);
  await page.waitForSelector('#sync[data-state=ok]');
  const saved = (await api(`/api/v1/meal-logs?from=${today}&to=${today}`)).items.find((m) => m.id === 'e2e-lunch-log');
  const by = Object.fromEntries(saved.items.map((i) => [i.name.split(' ')[0], i]));
  check('pasto salvato: voce corretta (inserito), prodotto dal codice (Open Food Facts), piatto nuovo con proteine',
    saved.items.length === 4 && by.Sugo.kcal === 120 && by.Sugo.protein_g === 4.5 && by.Sugo.nutrition_source === 'manual' && by.Skyr.nutrition_source === 'off' && by.Skyr.protein_g === 16.5 && by.Bresaola.protein_g === 16 && saved.protein_g === 48,
    JSON.stringify(saved.items.map((i) => [i.name, i.kcal, i.protein_g, i.nutrition_source])));
  check('la giornata mostra il pasto aggiornato', /Bresaola/.test(await lunch.textContent()), await lunch.textContent());

  // 9. Pasto saltato: dalla giornata si riapre e si può registrare; pesata di oggi: si corregge
  await api('/api/v1/meal-logs/e2e-lunch-log', 'PUT', { date: today, slot: 'lunch', status: 'skipped' });
  const st = await api('/api/state');
  st.data.weights.push({ id: 'e2e-w', date: today, weight: 89.4, waist: null, note: '' });
  await api('/api/state', 'PUT', { version: st.version, data: st.data });
  await api('/api/v1/reminders/e2e-weigh', 'PUT', { weekday, time: '00:02', kind: 'weigh_in', slot: null, title: 'Pesata di prova', action: 'log_weight', enabled: true });
  await page.reload();
  await page.locator('.tl-item.skipped', { hasText: 'Pranzo di prova' }).locator('.tl-card').click();
  await page.waitForSelector('#modal[open] .composer');
  check('pasto saltato: si riapre nell\'editor per registrarlo', (await page.textContent('#modal-title')) === 'Modifica pasto');
  await page.click('#modal [data-close]');
  await closed(page);
  await page.locator('.tl-item.done', { hasText: 'Pesata di prova' }).locator('.tl-card').click();
  await page.waitForSelector('#m-weight');
  check('pesata già fatta: si riapre con il valore di oggi da correggere', (await page.inputValue('#m-weight')) === '89,4' && /salvando la correggi/.test(await page.textContent('#modal-body')));
  await page.fill('#m-weight', '89,1');
  await page.click('#modal [data-m=save]');
  await closed(page);
  await page.waitForSelector('#sync[data-state=ok]');
  const weights = (await api('/api/state')).data.weights.filter((w) => w.date === today);
  check('pesata corretta, non duplicata', weights.length === 1 && weights[0].weight === 89.1, JSON.stringify(weights));
  check('nessun errore JS (telefono)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // 10. Schermo largo: le due zone affiancate, senza schede, e niente attributi style
  const wide = await open(browser, { viewport: { width: 1440, height: 900 } });
  await wide.page.click('[data-quick-meal]');
  await wide.page.waitForSelector('#modal[open] .composer');
  const layout = await wide.page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const [tray, add, foot, dlg] = [box('#c-zone-tray'), box('#c-zone-add'), box('.composer-foot'), box('#modal')];
    return { sideBySide: tray.right <= add.left + 1 && Math.abs(tray.top - add.top) < 2, tabsHidden: getComputedStyle(document.querySelector('.composer-tabs')).display === 'none',
      footAtBottom: Math.abs(foot.bottom - dlg.bottom) < 3, wide: dlg.width > 900, styled: document.querySelectorAll('#modal [style]:not([data-pct-w]):not([data-vars])').length };
  });
  check('desktop: "Nel piatto" e "Aggiungi" affiancati, schede nascoste, barra in fondo alla finestra', layout.sideBySide && layout.tabsHidden && layout.footAtBottom && layout.wide, JSON.stringify(layout));
  check('nessun attributo style scritto nell\'HTML della finestra', layout.styled === 0, String(layout.styled));
  await wide.page.click('#modal [data-food]');
  check('desktop: la voce scelta compare subito a sinistra', (await wide.page.locator('#c-zone-tray .tray-row:visible').count()) === 1);
  await wide.page.screenshot({ path: `${SHOTS}/v112-4-editor-desktop.png` });
  check('nessun errore JS (desktop)', wide.errors.length === 0, wide.errors.join(' | '));

  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0]);
  await global.__page?.screenshot({ path: SHOTS + '/v112-error.png' }).catch(() => {});
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
