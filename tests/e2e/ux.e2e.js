// Test end-to-end dei finding UX: rimozione annullabile in lista e dispensa (FW-UX-001), schede da tastiera
// (FW-UX-002), riga della lista senza pulsanti dentro la label (FW-UX-003), conferma del ripristino (FW-ARCH-001).
// Esecuzione: scripts/e2e.sh (oppure E2E_ONLY=ux scripts/e2e.sh)
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', locale: 'it-IT' });
  const page = await ctx.newPage();
  global.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const api = (path, method = 'GET', body) => page.evaluate(([p, m, b]) => fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [path, method, body]);
  const ids = async (section = 'groceries') => (await api('/api/state')).data[section].map((x) => x.id);
  const saved = () => page.waitForSelector('#sync[data-state=ok]', { timeout: 10000 });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  await page.goto(B);
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  // Nessun promemoria attivo: i popup non devono dipendere dall'ora reale.
  for (const r of (await api('/api/v1/reminders')).items) await api(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');
  await page.click('.bottom-nav [data-view=shopping]');
  await page.waitForSelector('#shopping-list .shopitem');
  const before = await ids();

  // ---- FW-UX-003: la label contiene solo casella e testo; i pulsanti sono fratelli e non la attivano
  const markup = await page.evaluate(() => ({
    nested: document.querySelectorAll('#shopping-list label button').length,
    rows: document.querySelectorAll('#shopping-list .shoprow').length,
    labels: document.querySelectorAll('#shopping-list .shoprow > label.shopitem').length,
    buttons: document.querySelectorAll('#shopping-list .shoprow > button[aria-label]').length,
  }));
  check('riga spesa: nessun pulsante dentro la label', markup.nested === 0 && markup.rows === before.length && markup.labels === markup.rows && markup.buttons === markup.rows * 2, JSON.stringify(markup));
  const row = page.locator('#shopping-list .shoprow').nth(0);
  await page.screenshot({ path: `${SHOTS}/ux-1-shopping.png` });
  const box = row.locator('input[type=checkbox]');
  await row.locator('[data-recurring]').click();
  await saved();
  check('riga spesa: "ogni settimana" cambia solo il proprio stato, non la spunta', (await row.locator('[data-recurring]').getAttribute('aria-pressed')) === 'true' && !(await box.isChecked()));
  await row.locator('[data-recurring]').click();
  await saved();
  await row.locator('.shopname').click();
  await saved();
  check('riga spesa: il tocco sul nome spunta l\'articolo', await box.isChecked());
  await box.focus();
  await page.keyboard.press('Space');
  await saved();
  check('riga spesa: Spazio sulla casella toglie la spunta', !(await box.isChecked()) && same(await ids(), before));

  // ---- FW-UX-001: rimozione annullabile
  const firstName = await row.locator('.shopname').textContent();
  await row.locator('[data-remove-shop]').click();
  await page.waitForSelector('#toast:not(.hidden) .toast-action');
  await saved();
  check('rimozione: la voce sparisce subito e compare "Annulla"', /rimosso dalla lista/.test(await page.textContent('#toast')) && (await page.textContent('#toast .toast-action')) === 'Annulla' && same(await ids(), before.slice(1)), await page.textContent('#toast'));
  check('rimozione: la spunta non è stata toccata e nessuna conferma bloccante', (await page.locator('#shopping-list .shoprow').count()) === before.length - 1);
  await page.click('#toast .toast-action');
  await saved();
  check('annulla: la voce torna al suo posto, senza doppioni, anche sul server', same(await ids(), before) && (await page.locator('#shopping-list .shoprow').nth(0).locator('.shopname').textContent()) === firstName, JSON.stringify(await ids()));

  // offline: rimozione e annulla con il server irraggiungibile, poi ritorno della rete
  await page.route('**/api/state', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
  await page.locator('#shopping-list .shoprow').nth(1).locator('[data-remove-shop]').click();
  await page.waitForSelector('#toast:not(.hidden) .toast-action');
  check('offline: la voce è rimossa a schermo', (await page.locator('#shopping-list .shoprow').count()) === before.length - 1);
  await page.click('#toast .toast-action');
  await page.waitForTimeout(300);
  check('offline: annulla la riporta a schermo', (await page.locator('#shopping-list .shoprow').count()) === before.length);
  await page.unroute('**/api/state');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await saved();
  check('offline: tornata la rete, sul server l\'elenco è quello di partenza', same(await ids(), before), JSON.stringify(await ids()));

  // senza annullare: la rimozione resta dopo la ricarica
  await page.locator('#shopping-list .shoprow').nth(0).locator('[data-remove-shop]').click();
  await saved();
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');
  await page.click('.bottom-nav [data-view=shopping]');
  await page.waitForSelector('#shopping-list .shopitem');
  check('rimozione non annullata: resta dopo la ricarica', same(await ids(), before.slice(1)) && (await page.locator('#shopping-list .shoprow').count()) === before.length - 1);

  // dispensa
  await page.click('[data-tab=pantry]');
  await page.click('details.free summary');
  await page.fill('#in-name', 'Riso di prova');
  await page.fill('#in-qty', '300 g');
  await page.click('#inventory-form button[type=submit]');
  await saved();
  const pantry = await ids('inventory');
  await page.click('[data-remove-inv]');
  await page.waitForSelector('#toast:not(.hidden) .toast-action');
  await saved();
  const removed = await ids('inventory');
  await page.click('#toast .toast-action');
  await saved();
  check('dispensa: rimozione annullabile', pantry.length >= 1 && removed.length === pantry.length - 1 && same(await ids('inventory'), pantry), `${pantry.length} → ${removed.length} → ${(await ids('inventory')).length}`);

  // ---- FW-UX-002: schede da tastiera
  const tabState = () => page.evaluate(() => {
    const list = document.querySelector('[role=tablist][aria-label="Spesa e dispensa"]');
    const tabs = [...list.querySelectorAll('[role=tab]')];
    return {
      selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.tab).join(','),
      stops: tabs.filter((t) => t.tabIndex === 0).map((t) => t.dataset.tab).join(','),
      focus: document.activeElement?.dataset?.tab || document.activeElement?.tagName,
    };
  });
  const press = async (key) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
    return tabState();
  };
  await page.click('[data-tab=list]');
  await page.waitForSelector('#shopping-list');
  await page.focus('[role=tablist][aria-label="Spesa e dispensa"] [role=tab][aria-selected=true]');
  let s = await tabState();
  check('schede: Tab si ferma solo sulla scheda attiva', s.selected === 'list' && s.stops === 'list', JSON.stringify(s));
  s = await press('ArrowRight');
  check('schede: freccia destra apre la scheda successiva e ci porta il fuoco', s.selected === 'pantry' && s.stops === 'pantry' && s.focus === 'pantry' && (await page.locator('#inventory-form').count()) === 1, JSON.stringify(s));
  s = await press('End');
  check('schede: Fine va all\'ultima', s.selected === 'spend' && s.focus === 'spend', JSON.stringify(s));
  s = await press('ArrowRight');
  check('schede: dall\'ultima la freccia destra torna alla prima', s.selected === 'list' && s.focus === 'list', JSON.stringify(s));
  s = await press('ArrowLeft');
  check('schede: dalla prima la freccia sinistra va all\'ultima', s.selected === 'spend' && s.focus === 'spend', JSON.stringify(s));
  s = await press('Home');
  check('schede: Inizio torna alla prima', s.selected === 'list' && s.focus === 'list' && (await page.locator('#shopping-list').count()) === 1, JSON.stringify(s));
  await page.click('[data-tab=pantry]');
  s = await tabState();
  check('schede: il tocco funziona come prima', s.selected === 'pantry' && s.stops === 'pantry', JSON.stringify(s));
  const everyList = await page.evaluate(async () => {
    const bad = [];
    for (const view of ['dashboard', 'training', 'meals', 'shopping', 'progress', 'settings']) {
      location.hash = view;
      await new Promise((r) => setTimeout(r, 400));
      for (const list of document.querySelectorAll('#content [role=tablist]')) {
        const tabs = [...list.querySelectorAll('[role=tab]')];
        const stops = tabs.filter((t) => t.tabIndex === 0 && !t.disabled).length;
        if (!tabs.length || stops !== 1) bad.push(`${view}/${list.getAttribute('aria-label')}: ${tabs.length} schede, ${stops} soste`);
      }
    }
    return bad;
  });
  check('schede: in ogni vista ogni elenco di schede ha una sola sosta per Tab', everyList.length === 0, everyList.join(' | '));
  // ---- FW-ARCH-001: la conferma del ripristino dice cosa viene sostituito e cosa resta
  const full = await api('/api/backup');
  const legacy = { format: 'fitweek-backup-v2', version: full.version, data: full.data, workout_sessions: full.workout_sessions };
  await api('/api/v1/meal-logs/e2e-keep', 'PUT', { date: full.data.profile.programStart || '2026-11-10', slot: 'lunch', description: 'Resta dopo il ripristino' });
  const mealsBefore = (await api('/api/backup')).meal_logs.length;
  const restoreWith = async (obj, accept) => {
    await page.click('.topbar [data-view=settings]');
    await page.click('[data-tab=data]');
    await page.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });
    let asked = '';
    page.once('dialog', (d) => { asked = d.message(); accept ? d.accept() : d.dismiss(); });
    await page.click('[data-import-backup]');
    for (let i = 0; i < 100 && !asked; i++) await page.waitForTimeout(50);
    return asked;
  };
  let asked = await restoreWith(legacy, false);
  check('ripristino di un backup vecchio: la conferma elenca cosa viene sostituito e cosa resta', /SOSTITUISCE/.test(asked) && /sedute e serie/.test(asked) && /RESTANO come sono ora/.test(asked) && /diario dei pasti/.test(asked) && /sonno/.test(asked), asked.replace(/\n/g, ' ').slice(0, 160));
  check('ripristino annullato: nulla è cambiato', (await api('/api/backup')).meal_logs.length === mealsBefore);
  asked = await restoreWith(legacy, true);
  await page.waitForSelector('#toast:not(.hidden)');
  for (let i = 0; i < 100 && !/Backup ripristinato/.test(await page.textContent('#toast')); i++) await page.waitForTimeout(50);
  const done = await page.textContent('#toast');
  check('ripristino di un backup vecchio: il diario dei pasti resta e il messaggio lo dice', /Non toccati: .*diario dei pasti/.test(done) && (await api('/api/backup')).meal_logs.length === mealsBefore, done);
  asked = await restoreWith(full, false);
  check('ripristino di un backup completo: la conferma non parla di dati che restano', /SOSTITUISCE/.test(asked) && !/RESTANO/.test(asked) && /copia di tutti i dati attuali/.test(asked), asked.replace(/\n/g, ' ').slice(0, 120));

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0]);
  await global.__page?.screenshot({ path: SHOTS + '/ux-error.png' }).catch(() => {});
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
