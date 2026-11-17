// Test end-to-end della copia locale (1.12): l'app autonoma risponde da sola alle letture quando il server
// non c'è, con le modifiche in coda già applicate, e dà gli stessi risultati del server sugli stessi dati.
// Pagine servite da un'altra origine, come nell'APK. Esecuzione: E2E_ONLY=localfirst scripts/e2e.sh
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:18090';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
/** JSON con le chiavi in ordine: due risposte uguali nei contenuti danno la stessa stringa. */
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Rome', locale: 'it-IT', colorScheme: 'dark' });
  // Simula il plugin nativo Android Keystore (SecureToken) nell'APK: il token vive nel Keystore e non in localStorage.
  await ctx.addInitScript(() => {
    window.__keystore = { token: sessionStorage.getItem('__e2e_ks_token') || null };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        SecureToken: {
          get: async () => ({ value: window.__keystore.token }),
          set: async ({ value }) => {
            window.__keystore.token = value || null;
            if (value) sessionStorage.setItem('__e2e_ks_token', value);
            else sessionStorage.removeItem('__e2e_ks_token');
          },
          clear: async () => {
            window.__keystore.token = null;
            sessionStorage.removeItem('__e2e_ks_token');
          },
        },
      },
    };
  });
  const page = await ctx.newPage();
  global.__page = page;
  const errors = [];
  global.__errors = errors;
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });

  await page.goto(APP);
  await page.waitForSelector('#server-field:not(.hidden)');
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  const token = await page.evaluate(() => window.__keystore.token);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: APP };
  const server = async (path, method = 'GET', data) => (await ctx.request.fetch(B + path, { method, headers, data })).json();

  // Dati di partenza sul server: un solo promemoria attivo oggi (pranzo, già passato), pasti, sonno, pesata,
  // una seduta conclusa, riferimento di proteine.
  const { date: today, weekday, program_week: week } = await server('/api/v1/today');
  for (const r of (await server('/api/v1/reminders')).items) await server(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  const lunch = { weekday, time: '00:01', kind: 'meal', slot: 'lunch', title: 'Pranzo di prova', action: 'log_meal', enabled: true };
  await server('/api/v1/reminders/e2e-lunch', 'PUT', lunch);
  await server('/api/v1/reminders/e2e-snack', 'PUT', { ...lunch, time: '00:02', slot: 'snack', title: 'Spuntino di prova' });
  await server('/api/v1/reminders/e2e-bed', 'PUT', { ...lunch, time: '00:03', kind: 'sleep', slot: null, title: 'A letto', action: 'none' });
  await server('/api/v1/reminders/e2e-bed/ack', 'PUT', { date: today, status: 'dismissed' });
  await server('/api/v1/meal-logs/e2e-snack-log', 'PUT', { date: today, slot: 'snack', items: [
    { name: 'Yogurt greco', category: 'altro', qty: 1.5, kcal: 97, protein_g: 10.3, nutrition_source: 'label', takeaway: false },
    { name: 'Miele', category: 'altro', qty: 1, kcal: 61, protein_g: null, nutrition_source: 'estimate', takeaway: false }] });
  await server('/api/v1/meal-logs/e2e-novalues', 'PUT', { date: today, slot: 'other', description: 'Caffè al bar' });
  await server(`/api/v1/sleep/${today}`, 'PUT', { bed_time: '00:40', wake_time: '07:25' });
  await server(`/api/v1/health-days/${today}`, 'PUT', { steps: 6500, resting_hr: 62 });
  await server('/api/v1/workout-sessions', 'POST', { id: 'e2e-done', routine: 'A', week, date: today });
  await server('/api/v1/workout-sessions/e2e-done/sets/a1/1', 'PUT', { kg: 40, reps: 10 });
  await server('/api/v1/workout-sessions/e2e-done', 'PATCH', { status: 'done', duration_min: 55 });
  const st = await server('/api/state');
  st.data.profile.proteinTarget = 130;
  st.data.weights.push({ id: 'e2e-w', date: today, weight: 89.6, waist: null, note: '' });
  await server('/api/state', 'PUT', { version: st.version, data: st.data });
  await page.reload();
  await page.waitForSelector('.tl-item');

  // 1. Stessi dati, stessa risposta: agenda e riepilogo ricostruiti sul telefono contro quelli del server
  const parity = await page.evaluate(async () => {
    const { request } = await import('/static/js/api.js');
    const { readLocal, normalizeDb } = await import('/static/js/local.js');
    const fresh = (path) => request(path, { fresh: true });
    const [snap, state, sessions, agenda, weekly, sleep, health, logsToday] = await Promise.all([
      fresh('/api/v1/sync/snapshot'), fresh('/api/state'), fresh('/api/v1/workout-sessions?limit=200'), fresh('/api/v1/agenda'), fresh('/api/v1/weekly-summary'), fresh('/api/v1/sleep'), fresh('/api/v1/health-days'),
      fresh(`/api/v1/meal-logs?from=${new Date().toLocaleDateString('sv')}&to=${new Date().toLocaleDateString('sv')}`)]);
    const local = (path) => readLocal(path, normalizeDb(snap), { state: state.data, sessions: sessions.items, now: new Date() });
    const noDue = (a) => ({ ...a, items: a.items.map(({ due_at, ...i }) => i) }); // il server lo scrive con il fuso, il telefono in ora locale
    const day = new Date().toLocaleDateString('sv');
    return { agenda: [noDue(agenda), noDue(local('/api/v1/agenda'))], weekly: [weekly, local('/api/v1/weekly-summary')], sleep: [sleep, local('/api/v1/sleep')],
      health: [health, local('/api/v1/health-days')], logs: [logsToday, local(`/api/v1/meal-logs?from=${day}&to=${day}`)] };
  });
  for (const [name, label] of [['agenda', 'agenda di oggi'], ['weekly', 'riepilogo settimanale'], ['sleep', 'sonno e medie'], ['health', 'passi e battito a riposo'], ['logs', 'diario del giorno']]) {
    const [fromServer, fromPhone] = parity[name].map(canon);
    check(`telefono = server: ${label}`, fromServer === fromPhone, fromServer === fromPhone ? '' : `server ${fromServer.slice(0, 400)} ≠ telefono ${fromPhone.slice(0, 400)}`);
  }
  check('i dati di prova coprono fatto, saltato, seduta e pesata', parity.agenda[0].items.some((i) => i.state === 'done' && i.meal_id) && parity.agenda[0].items.some((i) => i.state === 'skipped') && parity.weekly[0].totals.workouts_done === 1 && parity.weekly[0].totals.weigh_ins === 1);

  // 2. Senza rete: registrare il pranzo → la giornata lo segna fatto, le proteine salgono, il diario lo mostra
  await page.route(`${B}/**`, (r) => r.abort());
  const proteinBefore = await page.textContent('[data-protein] .metric-value');
  await page.locator('.tl-item', { hasText: 'Pranzo di prova' }).locator('.tl-card').click();
  await page.waitForSelector('#modal[open] [data-m=compose]');
  await page.click('#modal [data-m=compose]');
  await page.waitForSelector('#modal[open] .composer');
  await page.click('#modal [data-food=f-pasta]');
  await page.click('#modal [data-cat=secondo]');
  await page.click('#modal [data-food=f-pollo]');
  await page.click('#modal [data-save]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.locator('#sync', { hasText: 'Offline' }).waitFor();
  const lunchRow = page.locator('.tl-item', { hasText: 'Pranzo di prova' });
  await page.locator('.tl-item.done', { hasText: 'Pranzo di prova' }).waitFor({ timeout: 8000 });
  check('senza rete: il pranzo appena registrato chiude il promemoria', /Pasta/.test(await lunchRow.textContent()), await lunchRow.textContent());
  const proteinAfter = await page.textContent('[data-protein] .metric-value');
  check('senza rete: le proteine di oggi contano il pasto in coda', proteinBefore !== proteinAfter && /~26/.test(proteinAfter), `${proteinBefore} → ${proteinAfter}`);
  await lunchRow.locator('.tl-card').click();
  await page.waitForSelector('#modal[open] .composer');
  check('senza rete: il pasto in coda si riapre nel suo editor', (await page.textContent('#modal-title')) === 'Modifica pasto' && (await page.locator('#modal .tray-row').count()) === 2);
  await page.click('#modal [data-close]');
  await page.click('.bottom-nav [data-view=meals]');
  await page.locator('#content', { hasText: 'Petto di pollo' }).waitFor({ timeout: 5000 });
  check('senza rete: il diario mostra il pasto e lo spuntino', /Yogurt greco/.test(await page.textContent('#content')));

  // 3. Senza rete: rinominare un promemoria e aggiungerne uno (prima servivano il server)
  await page.click('.topbar [data-view=settings]');
  await page.click('[data-tab=reminders]');
  await page.waitForSelector('[data-rem-form="e2e-lunch"]');
  await page.fill('[data-rem-form="e2e-lunch"] input[name=title]', 'Pranzo rinominato');
  await page.locator('[data-rem-form="e2e-lunch"] input[name=title]').dispatchEvent('change');
  await page.locator('#toast', { hasText: 'Promemoria salvato' }).waitFor();
  check('senza rete: il promemoria modificato resta a schermo', (await page.inputValue('[data-rem-form="e2e-lunch"] input[name=title]')) === 'Pranzo rinominato');
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('fitweek.workoutQueue.v1')).map((o) => `${o.method} ${o.path.split('/').slice(3, 4)[0]}`));
  check('le scritture sono in coda, nessuna persa', queued.filter((q) => q === 'PUT meal-logs').length === 1 && queued.includes('PUT reminders'), queued.join(', '));
  check('sul server non è ancora arrivato nulla', !(await server(`/api/v1/meal-logs?from=${today}&to=${today}`)).items.some((m) => m.slot === 'lunch') && (await server('/api/v1/reminders')).items.find((r) => r.id === 'e2e-lunch').title === 'Pranzo di prova');

  // 4. Riavvio senza rete: tutto ciò che è stato fatto sul telefono c'è ancora
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');
  await page.click('.bottom-nav [data-view=dashboard]');
  await page.locator('.tl-item.done', { hasText: 'Pranzo rinominato' }).waitFor({ timeout: 8000 });
  await page.locator('[data-protein] .metric-value', { hasText: '~26' }).waitFor({ timeout: 5000 }); // il numero arriva contando
  check('riavvio senza rete: promemoria rinominato, pranzo fatto e proteine del pasto in coda', /Offline/.test(await page.textContent('#sync .sync-text')), await page.textContent('#sync .sync-text'));
  await page.screenshot({ path: `${SHOTS}/v112-5-offline.png`, fullPage: true });

  // 5. Torna la rete: il server riceve tutto e diventa uguale al telefono
  await page.unroute(`${B}/**`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 20000 });
  const lunchLog = (await server(`/api/v1/meal-logs?from=${today}&to=${today}`)).items.find((m) => m.slot === 'lunch');
  check('ritorno online: pasto e promemoria sul server', lunchLog && lunchLog.items.length === 2 && lunchLog.protein_g === 11 && (await server('/api/v1/reminders')).items.find((r) => r.id === 'e2e-lunch').title === 'Pranzo rinominato', JSON.stringify(lunchLog && [lunchLog.kcal, lunchLog.protein_g]));
  const agendaServer = (await server('/api/v1/agenda')).items.find((i) => i.id === 'e2e-lunch');
  check('ritorno online: il promemoria punta al pasto arrivato', agendaServer.state === 'done' && agendaServer.meal_id === lunchLog.id);
  await page.locator('.tl-item.done', { hasText: 'Pranzo rinominato' }).waitFor();
  check('dopo l\'allineamento la coda è vuota e la giornata non cambia', (await page.evaluate(() => JSON.parse(localStorage.getItem('fitweek.workoutQueue.v1')).length)) === 0 && (await page.locator('[data-protein] .metric-value', { hasText: '~26' }).count()) === 1);

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0], '| errori della pagina:', (global.__errors || []).join(' | ') || 'nessuno');
  await global.__page?.screenshot({ path: SHOTS + '/v112-local-error.png' }).catch(() => {});
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
