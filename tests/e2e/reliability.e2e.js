// Affidabilità delle scritture: nessuna modifica va persa per errori del server, rifiuti o memoria piena.
// Esecuzione: scripts/e2e.sh (oppure E2E_ONLY=reliability scripts/e2e.sh)
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const SETS = '**/api/v1/workout-sessions/*/sets/**';
const STATE = '**/api/state';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'Europe/Rome', locale: 'it-IT' });
  const page = await ctx.newPage();
  global.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const server = (path) => page.evaluate((p) => fetch(p).then((r) => r.json()), path);
  const local = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  const online = () => page.evaluate(() => window.dispatchEvent(new Event('online')));
  const json = (status, body) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const onlyPut = (handler) => (route) => (route.request().method() === 'PUT' ? handler(route) : route.continue());
  const addProduct = async (name) => {
    await page.click('.bottom-nav [data-view=shopping]');
    await page.click('[data-tab=list]');
    if (!(await page.locator('#sh-name').isVisible())) await page.click('#shopping-list details summary');
    await page.fill('#sh-name', name);
    await page.fill('#sh-qty', '1');
    await page.click('#shopping-form button[type=submit]');
  };

  await page.goto(B);
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  // Isola il test dall'ora reale: niente popup dei promemoria.
  await page.evaluate(async () => {
    const { items } = await fetch('/api/v1/reminders').then((r) => r.json());
    for (const r of items) await fetch(`/api/v1/reminders/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false }) });
  });
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');

  await page.click('.bottom-nav [data-view=training]');
  await page.click('[data-pick-routine=A]');
  await page.click('[data-start]');
  await page.waitForSelector('#sync[data-state=ok]');
  const rows = page.locator('#ex-a1 .set-row');

  // 1. Il server risponde 500 a lungo: la serie resta in coda, non viene mai scartata, e arriva quando si riprende
  await page.route(SETS, json(500, { detail: 'errore interno' }));
  await rows.nth(0).locator('[data-field=kg]').fill('40');
  await rows.nth(0).locator('[data-field=reps]').fill('9');
  await rows.nth(0).locator('[data-check]').click();
  for (let i = 0; i < 10; i++) { // ben oltre i 6 tentativi dopo i quali prima veniva buttata
    await online();
    await page.waitForTimeout(150);
  }
  check('errori 500 ripetuti: la serie resta in coda', (await local('fitweek.workoutQueue.v1')).length === 1 && !(await local('fitweek.rejected.v1'))?.length);
  check('errori 500 ripetuti: indicatore "Non salvato"', (await page.getAttribute('#sync', 'data-state')) === 'error');
  await page.unroute(SETS);
  await online();
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 10000 });
  check('il server si riprende: la serie arriva', (await server('/api/v1/today')).active_session.sets.length === 1);

  // 2. Rifiuto definitivo (4xx): la modifica finisce in "Modifiche non inviate", da cui si può riprovare
  await page.route(SETS, json(422, { detail: 'Serie non valida' }));
  await rows.nth(1).locator('[data-check]').click();
  await page.locator('#toast', { hasText: 'Impostazioni' }).waitFor();
  const rejected = await local('fitweek.rejected.v1');
  check('rifiuto 422: operazione messa da parte, coda libera', rejected.length === 1 && rejected[0].method === 'PUT' && (await local('fitweek.workoutQueue.v1')).length === 0);
  await page.unroute(SETS);
  await page.click('.topbar [data-view=settings]');
  await page.click('[data-tab=data]');
  await page.waitForSelector('#not-sent');
  await page.screenshot({ path: `${SHOTS}/rel-1-not-sent.png`, fullPage: true });
  await page.click('#not-sent [data-rejected-op=retry]');
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 10000 });
  check('riprova dalla lista: la serie arriva', (await server('/api/v1/today')).active_session.sets.length === 2);
  check('lista "non inviate" svuotata', (await page.locator('#not-sent').count()) === 0);

  // 3. Stato (lista della spesa): errore 503 → la modifica sopravvive alla ricarica e parte da sola
  await page.route(STATE, onlyPut(json(503, { detail: 'non disponibile' })));
  await addProduct('Prodotto 503');
  await page.locator('#toast', { hasText: 'restano su questo dispositivo' }).waitFor();
  check('503 sullo stato: modifica in attesa sul dispositivo', Boolean(await local('fitweek.statePending.v1')));
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');
  await page.click('.bottom-nav [data-view=shopping]');
  check('503 sullo stato: dopo la ricarica il prodotto c\'è ancora', (await page.locator('#shopping-list', { hasText: 'Prodotto 503' }).count()) === 1);
  check('sul server non c\'è ancora', !(await server('/api/state')).data.groceries.some((g) => g.name === 'Prodotto 503'));
  await page.unroute(STATE);
  await online();
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 10000 });
  check('il server si riprende: il prodotto arriva', (await server('/api/state')).data.groceries.some((g) => g.name === 'Prodotto 503') && !(await local('fitweek.statePending.v1')));

  // 4. Stato rifiutato (422): le modifiche vengono messe da parte, non cancellate, e si possono riapplicare
  await page.route(STATE, onlyPut(json(422, { detail: 'Dati non validi', errors: [{ field: 'data.groceries.0.name', error: 'x' }] })));
  await addProduct('Prodotto 422');
  await page.locator('#toast', { hasText: 'tenuta una copia' }).waitFor();
  const aside = await local('fitweek.stateRejected.v1');
  check('422 sullo stato: copia messa da parte', aside?.local.groceries.some((g) => g.name === 'Prodotto 422') && aside.field === 'data.groceries.0.name');
  await page.unroute(STATE);
  await page.click('.topbar [data-view=settings]');
  await page.click('[data-tab=data]');
  await page.click('#not-sent [data-rejected-state=retry]');
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 10000 });
  const groceries = (await server('/api/state')).data.groceries.map((g) => g.name);
  check('riprova: la modifica messa da parte arriva senza perdere le altre', groceries.includes('Prodotto 422') && groceries.includes('Prodotto 503'), groceries.join(', '));

  // 4b. Una modifica fatta da un altro dispositivo compare al rientro sull'app, senza ricaricare la pagina
  await page.evaluate(async () => {
    const st = await fetch('/api/state').then((r) => r.json());
    st.data.inventory.push({ id: 'e2e-remote', name: 'Ceci remoti', qty: '1', expiry: '' });
    await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st) });
  });
  await page.click('.bottom-nav [data-view=shopping]');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.click('[data-tab=pantry]');
  await page.locator('#content', { hasText: 'Ceci remoti' }).waitFor({ timeout: 5000 });
  check('modifica di un altro dispositivo visibile al rientro, senza ricaricare', true);

  // 4c. Due pesate nello stesso giorno: la seconda corregge la prima, non la affianca
  await page.click('.bottom-nav [data-view=dashboard]');
  for (const kg of ['88,0', '87,5']) {
    await page.click('[data-weigh]');
    await page.fill('#m-weight', kg);
    await page.click('#modal [data-m=save]');
    await page.waitForSelector('#modal', { state: 'hidden' });
    await page.waitForSelector('#sync[data-state=ok]');
  }
  const day = (await server('/api/v1/today')).date;
  const todays = (await server('/api/state')).data.weights.filter((w) => w.date === day);
  check('una sola pesata per giorno, con l\'ultimo valore', todays.length === 1 && todays[0].weight === 87.5, JSON.stringify(todays));

  // 5. Memoria del dispositivo piena: l'utente viene avvisato invece di perdere la serie in silenzio
  await page.click('.bottom-nav [data-view=training]');
  await page.waitForSelector('#ex-a1 .set-row');
  await ctx.setOffline(true);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'fitweek.workoutQueue.v1') throw new DOMException('piena', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await rows.nth(2).locator('[data-check]').click();
  await page.locator('#toast', { hasText: 'Memoria del dispositivo piena' }).waitFor();
  check('memoria piena: avviso visibile', (await page.getAttribute('#sync', 'data-state')) === 'error');
  await ctx.setOffline(false);
  await online();
  await page.waitForFunction(() => fetch('/api/v1/today').then((r) => r.json()).then((t) => t.active_session.sets.length === 3), null, { timeout: 10000 });
  check('memoria piena: con l\'app aperta la serie arriva comunque', true);

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0]);
  await global.__page?.screenshot({ path: SHOTS + '/rel-error.png' }).catch(() => {});
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
