// Test end-to-end degli avvisi in tempo reale (1.15): una modifica fatta da un altro dispositivo compare da sola,
// senza ricaricare, sia nella webapp (cookie) sia nell'app autonoma (token Bearer, altra origine), e chi scrive
// non si ricarica da solo. Esecuzione: E2E_ONLY=live scripts/e2e.sh
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:18090';
const PW = process.env.E2E_PASSWORD;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const FAKE_KEYSTORE = () => {
  window.__keystore = { token: sessionStorage.getItem('__e2e_ks_token') }; // sopravvive al reload
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
        clear: async () => { window.__keystore.token = null; },
      },
    },
  };
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  global.__errors = errors;
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  };

  // Webapp sul computer
  const webCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Rome', locale: 'it-IT' });
  const web = await webCtx.newPage();
  watch(web);
  await web.goto(B);
  await web.fill('#pw', PW);
  await web.click('#login-form button');
  await web.waitForSelector('#shell:not(.hidden)');

  // App autonoma sul telefono
  const appCtx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Rome', locale: 'it-IT' });
  await appCtx.addInitScript(FAKE_KEYSTORE);
  const phone = await appCtx.newPage();
  global.__page = phone;
  watch(phone);
  await phone.goto(APP);
  await phone.waitForSelector('#server-field:not(.hidden)');
  await phone.fill('#pw', PW);
  await phone.click('#login-form button');
  await phone.waitForSelector('#shell:not(.hidden)');
  const token = await phone.evaluate(() => window.__keystore.token);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: APP };
  const server = async (path, method = 'GET', data) => (await appCtx.request.fetch(B + path, { method, headers, data })).json();
  for (const r of (await server('/api/v1/reminders')).items) await server(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  for (const p of [web, phone]) {
    await p.reload();
    await p.waitForSelector('#shell:not(.hidden)');
  }

  // Entrambi su Progressi → Sonno, senza notti
  for (const p of [web, phone]) {
    await p.evaluate(() => (location.hash = '#progress'));
    await p.click('[data-tab=sleep]');
  }
  await new Promise((r) => setTimeout(r, 1500)); // il flusso degli avvisi si apre dopo l'accesso

  // 1. Una notte scritta da un terzo dispositivo arriva da sola su entrambi
  const { date: today } = await server('/api/v1/today');
  const t0 = Date.now();
  await server(`/api/v1/sleep/${today}`, 'PUT', { bed_time: '23:40', wake_time: '07:20' });
  await Promise.all([web, phone].map((p) => p.locator('#content', { hasText: '23:40' }).waitFor({ timeout: 5000 })));
  check('notte scritta altrove: compare da sola su webapp e app', true, `${Date.now() - t0} ms`);

  // 2. Un pasto registrato dal telefono compare sulla webapp, nel diario
  await web.evaluate(() => (location.hash = '#meals'));
  await web.waitForSelector('[data-tab]');
  const before = await web.textContent('#content');
  await phone.evaluate(async ({ today }) => {
    const { enqueue, commit } = await import('/static/js/workout/queue.js');
    enqueue('PUT', '/api/v1/meal-logs/live-e2e', { date: today, slot: 'dinner', status: 'eaten', description: '', note: '', items: [{ name: 'Pasta al pomodoro live', category: 'primo', qty: 1 }] }, 'meal:live-e2e');
    await commit();
  }, { today });
  const meal = await web.locator('#content', { hasText: 'Pasta al pomodoro live' }).waitFor({ timeout: 6000 }).then(() => true, () => false);
  check('pasto registrato sul telefono: compare nel diario della webapp senza ricaricare', meal && !before.includes('Pasta al pomodoro live'));

  // 3. Un campo in compilazione non viene ridisegnato sotto le dita
  await web.evaluate(() => (location.hash = '#progress'));
  await web.click('[data-tab=weight]');
  await web.click('#content details.free summary');
  const field = web.locator('#w-note');
  await field.fill('a metà frase');
  await server(`/api/v1/sleep/${today}`, 'PUT', { bed_time: '23:10', wake_time: '07:20' });
  await new Promise((r) => setTimeout(r, 1200));
  check('campo in compilazione: non viene cancellato da un aggiornamento', (await field.inputValue()) === 'a metà frase');
  await field.blur();

  // 4. Il flusso è autenticato: senza sessione niente avvisi
  const anon = await (await browser.newContext()).request.get(B + '/api/v1/events');
  check('flusso degli avvisi solo con sessione', anon.status() === 401);

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  await global.__page?.screenshot({ path: (process.env.E2E_SHOTS || __dirname) + '/v115-live-error.png' }).catch(() => {});
  console.log('ERROR', e.message.split('\n').slice(0,3).join(' / '), '| errori della pagina:', (global.__errors || []).join(' | ') || 'nessuno');
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
