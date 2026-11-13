// Test end-to-end della 1.8: linea del tempo live, riferimenti, sonno, ricerca prodotti, pasti recenti,
// RIR e note in palestra, spesa reale. Esecuzione: scripts/e2e.sh (oppure E2E_ONLY=v18 scripts/e2e.sh)
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', locale: 'it-IT', colorScheme: 'dark' });
  const page = await ctx.newPage();
  global.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const api = (path, method = 'GET', body) => page.evaluate(([p, m, b]) => fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [path, method, body]);
  // La ricerca online è simulata: il test non dipende da Internet né da Open Food Facts.
  await page.route('**/api/v1/food-search*', (r) => r.fulfill({ json: { enabled: true, source: 'Open Food Facts (ODbL)', items: [{ code: '1', name: 'Yogurt greco bianco', brand: 'Marca', kcal_100g: 59, protein_100g: 10, serving_g: 150 }] } }));

  await page.goto(B);
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');

  // Giornata di prova: solo tre promemoria (uno già fatto, due futuri), così non compaiono popup.
  const today = (await api('/api/v1/today')).date;
  const weekday = (new Date(today + 'T12:00:00').getDay() + 6) % 7;
  for (const r of (await api('/api/v1/reminders')).items) await api(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  await api('/api/v1/reminders/e2e-past', 'PUT', { weekday, time: '00:05', kind: 'custom', action: 'none', title: 'Mattina', enabled: true });
  await api('/api/v1/reminders/e2e-past/ack', 'PUT', { date: today, status: 'done' });
  await api('/api/v1/reminders/e2e-dinner', 'PUT', { weekday, time: '23:57', kind: 'meal', slot: 'dinner', action: 'log_meal', title: 'Cena di prova', enabled: true });
  await api('/api/v1/reminders/e2e-late', 'PUT', { weekday, time: '23:59', kind: 'custom', action: 'none', title: 'Fine giornata', enabled: true });
  const yesterday = new Date(today + 'T12:00:00');
  yesterday.setDate(yesterday.getDate() - 1);
  const yIso = yesterday.toISOString().slice(0, 10);
  await api('/api/v1/meal-logs/e2e-y', 'PUT', { date: yIso, slot: 'dinner', description: 'Zuppa di ceci', kcal: 300, nutrition_source: 'manual' });
  // Seduta A precedente con tutte le serie di a1 a 10 ripetizioni: abilita la proposta di aumento del carico.
  await api('/api/v1/workout-sessions', 'POST', { id: 'e2e-prev', routine: 'A', week: 1, date: yIso });
  for (let n = 1; n <= 3; n++) await api(`/api/v1/workout-sessions/e2e-prev/sets/a1/${n}`, 'PUT', { kg: 40, reps: 10, completed: true });
  await api('/api/v1/workout-sessions/e2e-prev', 'PATCH', { status: 'done' });
  await page.reload();
  await page.waitForSelector('[data-timeline]');
  await page.waitForTimeout(1500);

  // 1. Linea del tempo con puntatore live
  const tl = await page.evaluate(() => {
    const y = (el) => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; };
    const nodes = [...document.querySelectorAll('.tl-item .tl-node')].map(y);
    return { items: nodes.length, first: nodes[0], second: nodes[1], now: y(document.querySelector('.tl-now-dot')), clock: document.querySelector('.tl-now-time').textContent, next: document.querySelector('[data-next-label]').textContent, fill: document.querySelector('.tl-fill').getBoundingClientRect().height };
  });
  const nowClock = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date());
  check('linea del tempo: tre eventi', tl.items === 3, String(tl.items));
  check('puntatore tra l\'evento passato e il prossimo', tl.now > tl.first && tl.now < tl.second, `${Math.round(tl.first)} < ${Math.round(tl.now)} < ${Math.round(tl.second)}`);
  check('puntatore con l\'ora corrente', tl.clock === nowClock || Math.abs(Number(tl.clock.slice(3)) - Number(nowClock.slice(3))) <= 1, `${tl.clock} / ${nowClock}`);
  check('prossimo evento con conto alla rovescia', /^Cena di prova tra /.test(tl.next), tl.next);
  check('binario riempito fino al puntatore', tl.fill > 0);
  await page.screenshot({ path: `${SHOTS}/v18-1-timeline.png` });

  // 2. Riferimenti scelti dall'utente
  await page.click('.topbar [data-view=settings]');
  await page.fill('#pf-prot', '130');
  await page.fill('#pf-kcal', '2100');
  await page.click('#profile-form button[type=submit]');
  await page.locator('#toast', { hasText: 'Profilo aggiornato' }).waitFor();
  await page.click('.bottom-nav [data-view=dashboard]');
  await page.waitForSelector('.tiles');
  check('riferimenti in Oggi', /\/ 2\.100 kcal/.test(await page.textContent('.tiles')) && /\/ 130 g/.test(await page.textContent('.tiles')), (await page.textContent('.tiles')).replace(/\s+/g, ' ').slice(0, 120));

  // 3. Sonno: orari a 24 ore con i due punti automatici, durata calcolata
  await page.click('[data-sleep]');
  await page.fill('#sl-bed', '0030');
  await page.fill('#sl-wake', '0745');
  check('sonno: orario formattato e durata dal vivo', (await page.inputValue('#sl-bed')) === '00:30' && (await page.textContent('#sl-dur')) === '7 h 15', `${await page.inputValue('#sl-bed')} · ${await page.textContent('#sl-dur')}`);
  await page.click('#modal [data-m=save]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.locator('[data-sleep]', { hasText: '7 h 15' }).waitFor();
  const night = (await api(`/api/v1/sleep?from=${today}&to=${today}`)).items[0];
  check('sonno salvato', night && night.bed_time === '00:30' && night.duration_min === 435);

  // 4. Cena: pasto recente riselezionabile, poi "scrivi tu" che entra nel catalogo
  await page.click('[data-agenda=e2e-dinner]');
  await page.waitForSelector('#modal[open] [data-recent]');
  check('pasto di ieri tra i recenti', /Zuppa di ceci/.test(await page.textContent('#modal [data-recent]')));
  await page.click('#modal details.free summary');
  await page.fill('#m-desc', 'Kebab');
  await page.fill('#m-kcal', '700');
  await page.click('#modal [data-m=free]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.waitForSelector('.tl-item.done[data-title="Cena di prova"]');
  const kebab = (await api('/api/v1/foods')).items.find((f) => f.name === 'Kebab');
  check('pasto scritto a mano ricordato nel catalogo', kebab && kebab.kcal === 700 && kebab.nutrition_source === 'manual');

  // 5. Ricerca prodotti (Open Food Facts simulato) con porzione in grammi
  await page.click('[data-quick-meal]');
  await page.waitForSelector('#c-new-name');
  await page.fill('#c-new-name', 'yogurt');
  await page.waitForSelector('#modal [data-off]', { timeout: 5000 });
  await page.click('#modal [data-off]');
  check('porzione proposta dal prodotto', (await page.inputValue('#c-off-g')) === '150' && /89 kcal/.test(await page.textContent('#c-off-kcal')), await page.textContent('#c-off-kcal'));
  await page.fill('#c-off-g', '200');
  check('calorie ricalcolate sulla porzione', /118 kcal/.test(await page.textContent('#c-off-kcal')), await page.textContent('#c-off-kcal'));
  await page.click('#modal [data-off-add]');
  await page.waitForSelector('#modal .tray-row');
  await page.click('#modal [data-save]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.waitForTimeout(500);
  const yogurt = (await api('/api/v1/foods')).items.find((f) => /^Yogurt greco bianco Marca \(200 g\)$/.test(f.name));
  check('prodotto online salvato con la sua fonte', yogurt && yogurt.kcal === 118 && yogurt.nutrition_source === 'off', JSON.stringify(yogurt || null));
  await page.click('[data-quick-meal]');
  await page.fill('#c-new-name', 'kebab');
  await page.waitForSelector('#c-browse [data-food]');
  check('ricerca nel catalogo personale', /Kebab/.test(await page.textContent('#c-browse')) && /Nel tuo catalogo/.test(await page.textContent('#c-browse')));
  await page.click('#modal [data-close]');

  // 6. Palestra: proposta di carico, RIR facoltativo, nota per esercizio
  await page.click('.bottom-nav [data-view=training]');
  await page.click('[data-pick-routine=A]');
  await page.click('[data-start]');
  await page.waitForSelector('#ex-a1 [data-bump-ex]');
  await page.click('#ex-a1 [data-bump-ex]');
  const bumped = await page.locator('#ex-a1 .set-row').nth(0).locator('[data-field=kg]').inputValue();
  check('proposta di aumento: serie precompilate a +2,5 kg', bumped === '42,5', bumped);
  await page.locator('#ex-a1 .set-row').nth(0).locator('[data-check]').click();
  await page.waitForSelector('#ex-a1 .rir-strip');
  await page.click('#ex-a1 .rir-strip [data-rir="2"]');
  await page.locator('#ex-a1 .set-row').nth(0).locator('[data-step=reps][data-dir="1"]').click();
  await page.waitForSelector('#sync[data-state=ok]');
  await page.waitForTimeout(400);
  const set = (await api('/api/v1/today')).active_session.sets.find((s) => s.exercise_id === 'a1');
  check('RIR salvato e conservato quando si corregge la serie', set.rir === 2 && set.reps === 9, JSON.stringify(set));
  await page.click('#ex-a1 [data-note-ex]');
  await page.fill('#ex-note-text', 'Sedile 4');
  await page.click('#modal [data-m=save]');
  await page.waitForSelector('#ex-a1 .ex-note.has');
  await page.waitForSelector('#sync[data-state=ok]');
  check('nota per esercizio salvata', (await api('/api/v1/exercise-notes')).items.some((n) => n.exercise_id === 'a1' && n.note === 'Sedile 4'));
  await page.screenshot({ path: `${SHOTS}/v18-2-training.png` });
  page.once('dialog', (d) => d.accept());
  await page.click('[data-cancel-session]');
  await page.waitForSelector('[data-start]');

  // 7. Spesa: articolo ricorrente, spesa arrivata con totale reale
  await page.click('.bottom-nav [data-view=shopping]');
  await page.waitForSelector('.shopitem');
  const before = (await api('/api/state')).data.groceries;
  await page.locator('.shoprow').nth(0).locator('[data-recurring]').click();
  await page.locator('.shopitem').nth(0).locator('.cbox').click();
  await page.locator('.shopitem').nth(1).locator('.cbox').click();
  await page.click('[data-arrived]');
  await page.fill('#sp-amount', '42,50');
  await page.click('#modal [data-m=save]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.click('[data-tab=spend]');
  await page.waitForSelector('.wk-chart.spend .wk-col');
  const after = (await api('/api/state')).data;
  const spend = (await api('/api/v1/grocery-spend')).items;
  check('spesa arrivata: totale reale registrato', spend.length === 1 && spend[0].amount === 42.5 && /42,50/.test(await page.textContent('.tiles')));
  check('spuntati in dispensa, il ricorrente resta in lista', after.groceries.length === before.length - 1 && after.groceries[0].id === before[0].id && after.groceries[0].recurring && !after.groceries[0].checked && after.inventory.some((x) => x.name === before[1].name));
  await page.screenshot({ path: `${SHOTS}/v18-3-shopping.png`, fullPage: true });

  // 8. Progressi: sonno
  await page.click('.bottom-nav [data-view=progress]');
  await page.click('[data-tab=sleep]');
  await page.waitForSelector('[data-edit-sleep]');
  check('progressi: notte nell\'elenco del sonno', /00:30/.test(await page.textContent('[data-edit-sleep]')));

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0]);
  await global.__page?.screenshot({ path: SHOTS + '/v18-error.png' }).catch(() => {});
  console.log('HASH', await global.__page?.evaluate(() => location.hash + ' | ' + document.querySelector('#modal[open]')?.innerText.slice(0, 200) + ' | ' + document.querySelector('#content')?.innerText.slice(0, 200)).catch((x) => x.message));
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
