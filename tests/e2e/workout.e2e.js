// Test end-to-end del flusso principale (telefono + desktop). Esecuzione: scripts/e2e.sh
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/m2-${n}.png`, fullPage: true });

(async () => {
  const browser = await chromium.launch();
  // Lunedì 9/11 alle 19:45: giorno A
  const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'Europe/Rome', locale: 'it-IT' });
  const page = await ctx.newPage();
  global.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  // Bozza della versione precedente da importare
  await page.goto(B);
  await page.evaluate(() => localStorage.setItem('fitweek.workoutDrafts.v1', JSON.stringify({ 'B-W1': { kg_b1_0: '30', reps_b1_0: '9', date: '2026-11-04', notes: 'vecchia bozza', _updated: 1 } })));
  await page.reload();
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  // Isola il test dall'ora reale: niente popup dei promemoria durante l'allenamento simulato.
  await page.evaluate(async () => {
    const { items } = await fetch('/api/v1/reminders').then((r) => r.json());
    for (const r of items) await fetch(`/api/v1/reminders/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false }) });
  });
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');
  check('login + dashboard', Boolean(await page.waitForSelector('.today-hero')));
  const ringW = await page.evaluate(() => getComputedStyle(document.querySelector('.today-hero .ring')).width);
  check('anello dimensionato senza stili inline', ringW === '104px', ringW);
  await shot(page, '1-dashboard-dark');

  // Palestra
  await page.click('.bottom-nav [data-view=training]');
  check('banner bozza precedente', Boolean(await page.waitForSelector('[data-import-draft]')));
  await shot(page, '2-training-start');
  await page.click('[data-start]');
  await page.waitForSelector('.set-row');
  const rows = page.locator('#ex-a1 .set-row');
  check('A1 W1 ha 3 serie', (await rows.count()) === 3, String(await rows.count()));
  // Prima serie: niente storico → scrivo kg, uso stepper per reps
  await rows.nth(0).locator('[data-field=kg]').fill('40');
  await rows.nth(0).locator('[data-field=reps]').fill('9');
  await rows.nth(0).locator('[data-step=reps][data-dir="1"]').click();
  check('stepper ripetizioni', (await rows.nth(0).locator('[data-field=reps]').inputValue()) === '10');
  await rows.nth(0).locator('[data-check]').click();
  await page.waitForSelector('#rest-bar:not(.hidden)');
  check('timer recupero parte al ✓', await page.locator('#rest-bar').isVisible());
  const r2kg = await page.locator('#ex-a1 .set-row').nth(1).locator('[data-field=kg]').inputValue();
  check('serie 2 precompilata dalla 1', r2kg === '40', r2kg);
  await page.locator('#ex-a1 .set-row').nth(1).locator('[data-check]').click(); // 1 tocco
  await shot(page, '3-logging');

  // Ricarica a metà seduta
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');
  await page.waitForSelector('.set-row');
  const doneAfterReload = await page.locator('#ex-a1 .set-row.done').count();
  check('dopo ricarica seduta e serie presenti', doneAfterReload === 2, String(doneAfterReload));
  check('timer sopravvive alla ricarica', await page.locator('#rest-bar').isVisible());

  // Offline: serie 3 senza rete
  await ctx.setOffline(true);
  await page.locator('#ex-a1 .set-row').nth(2).locator('[data-check]').click();
  await page.waitForTimeout(300);
  const syncOffline = await page.textContent('#sync .sync-text');
  check('offline: serie in coda', /Salvataggio \(1\)/.test(syncOffline), syncOffline);
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 10000 });
  const t1 = await page.evaluate(() => fetch('/api/v1/today').then((r) => r.json()));
  check('offline → online: 3 serie sul server', t1.active_session.sets.length === 3, String(t1.active_session.sets.length));

  // Esercizio completato → si chiude da solo; si riapre con un tocco
  check('esercizio completato si chiude', (await page.locator('#ex-a1 .set-row').count()) === 0);
  await page.click('[data-toggle-ex="a1"]');
  // Annulla una serie (toggle) e rifalla
  await page.locator('#ex-a1 .set-row').nth(2).locator('[data-check]').click();
  await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => fetch('/api/v1/today').then((r) => r.json()));
  check('toggle annulla serie', t2.active_session.sets.length === 2);
  await page.locator('#ex-a1 .set-row').nth(2).locator('[data-check]').click();

  // Serie extra, cardio, note, fine
  await page.click('[data-toggle-ex="a1"]');
  await page.click('[data-add-set="a1"]');
  check('serie extra aggiunta', (await page.locator('#ex-a1 .set-row').count()) === 4);
  await page.click('[data-cardio]');
  await page.fill('#wk-notes', 'Buona seduta');
  await page.locator('#wk-notes').blur();
  page.once('dialog', (d) => d.accept());
  await page.click('[data-finish]');
  await page.waitForSelector('[data-close-summary]');
  const summary = await page.textContent('.hero');
  check('riepilogo con volume calcolato', /calc/.test(summary) && /3\s*\/\d+/.test(summary.replace(/\s+/g, ' ')), summary.replace(/\s+/g, ' ').slice(0, 120));
  await shot(page, '4-summary');
  await page.click('[data-close-summary]');
  await page.waitForSelector('.today-hero.done');
  check('dashboard: allenamento completato', true);
  const list = await page.evaluate(() => fetch('/api/v1/workout-sessions').then((r) => r.json()));
  const s = list.items[0];
  check('seduta salvata: done, cardio, note, durata', s.status === 'done' && s.cardio_min === 10 && s.notes === 'Buona seduta' && s.duration_min !== null);

  // Seduta passata modificabile: kg della prima serie e note → volume ricalcolato
  await page.click('.bottom-nav [data-view=progress]');
  await page.waitForSelector('[data-edit-session]');
  await page.click('[data-edit-session]');
  await page.waitForSelector('#modal[open] .es-row');
  await page.locator('#modal .es-row').first().locator('[name=kg]').fill('50');
  const vol = await page.textContent('#es-vol');
  check('modifica seduta: volume ricalcolato dal vivo', /1\.300/.test(vol), vol);
  await page.fill('#es-notes', 'Corretto dopo');
  await page.click('#modal [data-m=save]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.waitForTimeout(600);
  const fixed = (await page.evaluate(() => fetch('/api/v1/workout-sessions').then((r) => r.json()))).items[0];
  check('seduta passata aggiornata', fixed.notes === 'Corretto dopo' && fixed.sets.some((x) => x.kg === 50));

  // Nuova seduta A: precompilazione dall'ultima volta
  await page.click('.bottom-nav [data-view=training]');
  await page.click('[data-pick-week="2"]');
  await page.click('[data-start]');
  await page.waitForSelector('#ex-a1 .set-row');
  const pre = await page.locator('#ex-a1 .set-row').nth(0).locator('[data-field=kg]').inputValue();
  const last = await page.textContent('#ex-a1 .ex-last');
  check('nuova seduta precompilata dall\'ultima (anche dopo la modifica)', pre === '50' && /50×10/.test(last), `${pre} | ${last}`);
  // Record di carico: 52,5 kg supera i 50 della seduta precedente → trofeo sulla serie
  await page.locator('#ex-a1 .set-row').nth(0).locator('[data-step=kg][data-dir="1"]').click();
  await page.locator('#ex-a1 .set-row').nth(0).locator('[data-check]').click();
  check('record di carico segnalato sulla serie', (await page.locator('#ex-a1 .set-row .set-num.pr').count()) === 1);
  await page.locator('#ex-a2 .set-row').nth(0).locator('[data-field=kg]').fill('20');
  await page.locator('#ex-a2 .set-row').nth(0).locator('[data-field=reps]').fill('10');
  await page.locator('#ex-a2 .set-row').nth(0).locator('[data-check]').click();
  check('prima volta su un esercizio: nessun record', (await page.locator('#ex-a2 .set-row .set-num.pr').count()) === 0);
  page.once('dialog', (d) => d.accept());
  await page.click('[data-cancel-session]');
  await page.waitForSelector('[data-start]');
  check('annulla seduta', true);

  // Import bozza versione precedente
  await page.click('[data-import-draft]');
  await page.waitForSelector('#ex-b1 .set-row.done');
  await page.waitForSelector('#sync[data-state=ok]');
  const t3 = await page.evaluate(() => fetch('/api/v1/today').then((r) => r.json()));
  check('bozza importata come seduta', t3.active_session?.routine === 'B' && t3.active_session.sets[0]?.kg === 30 && t3.active_session.notes === 'vecchia bozza');
  page.once('dialog', (d) => d.accept());
  await page.click('[data-finish]');
  await page.click('[data-close-summary]');

  // Progressi
  await page.click('.bottom-nav [data-view=progress]');
  await page.fill('#w-kg', '89.4');
  await page.click('#weight-form button');
  await page.waitForSelector('.chart');
  check('pesata + grafico', await page.locator('.chart').first().isVisible());
  check('tabella carichi', (await page.locator('text=Lat machine').count()) > 0);
  check('costanza: 2 sedute fatte nella griglia', (await page.locator('table.cons td.done').count()) === 2, String(await page.locator('table.cons td.done').count()));
  check('carichi per esercizio: scelta e valori', (await page.locator('[data-ex-pick] option').count()) >= 2 && /50/.test(await page.textContent('#content .stack:nth-child(2) .metrics.three')));
  await page.selectOption('[data-ex-pick]', 'b1');
  check('cambio esercizio: carico della seduta B', /30/.test(await page.textContent('#content .stack:nth-child(2) .metrics.three')));
  // Media mobile: con 3 pesate compare la linea calcolata con legenda
  await page.evaluate(async () => {
    const s = await fetch('/api/state').then((r) => r.json());
    const day = (k) => { const d = new Date(); d.setDate(d.getDate() - k); return d.toISOString().slice(0, 10); };
    s.data.weights.push({ id: 'e2e-w1', date: day(6), weight: 90.2, waist: null, note: '' }, { id: 'e2e-w2', date: day(3), weight: 89.8, waist: null, note: '' });
    await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: s.version, data: s.data }) });
  });
  await page.reload();
  await page.waitForSelector('.chart-legend');
  check('peso: media mobile 7 giorni con legenda', /Media mobile 7 giorni/.test(await page.textContent('.chart-legend')) && (await page.locator('.chart .dot.raw').count()) === 3);
  await page.locator('.chart-wrap').first().hover();
  check('grafico: tooltip al passaggio', /kg/.test(await page.textContent('.chart-wrap.hover .chart-tip')));
  await shot(page, '5b-progress-avg');
  const csp = await page.evaluate(() => fetch('/').then((r) => r.headers.get('content-security-policy')));
  check('CSP senza unsafe-inline', !/unsafe-inline/.test(csp) && /style-src 'self'/.test(csp), csp);
  await shot(page, '5-progress');

  // Impostazioni: settimana programma, tema chiaro
  await page.click('.topbar [data-view=settings]');
  await page.selectOption('#prog-week', '3');
  await page.click('#program-form button');
  await page.waitForTimeout(500);
  const t4 = await page.evaluate(() => fetch('/api/v1/today').then((r) => r.json()));
  check('settimana programma impostata', t4.program_week === 3);
  await page.click('[data-theme-set=light]');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('tema chiaro', bg === 'rgb(242, 244, 240)', bg);
  await page.click('.bottom-nav [data-view=training]');
  await page.click('[data-start]');
  await page.waitForSelector('.set-row');
  await shot(page, '6-training-light');
  page.once('dialog', (d) => d.accept());
  await page.click('[data-cancel-session]');

  // Desktop
  const d = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const dp = await d.newPage();
  dp.on('pageerror', (e) => errors.push('desktop pageerror: ' + e.message));
  await dp.goto(B);
  await dp.fill('#pw', PW);
  await dp.click('#login-form button');
  await dp.waitForSelector('.sidebar');
  await dp.screenshot({ path: `${SHOTS}/m2-7-desktop.png` });
  check('desktop sidebar', await dp.locator('.sidebar').isVisible());

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0]);
  await global.__page?.screenshot({ path: SHOTS + '/m2-error.png' }).catch(() => {});
  console.log('HASH', await global.__page?.evaluate(() => location.hash + ' | ' + document.querySelector('#content')?.innerText.slice(0, 300)).catch((x) => x.message));
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
