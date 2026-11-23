// Test end-to-end dell'app per l'orologio Wear OS (1.19, D-044) dal lato del telefono: plugin `WatchLink`
// simulato (messaggi dell'orologio in arrivo, stato mandato all'orologio). L'app sull'orologio non si può provare
// qui: questo controlla che il telefono capisca i suoi messaggi e le risponda giusto. Pagine servite da un'altra
// origine, come nell'APK. Esecuzione: E2E_ONLY=wear scripts/e2e.sh
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:18090';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const FAKE_NATIVE = () => {
  window.__keystore = { token: sessionStorage.getItem('__e2e_ks_token') };
  window.__inbox = [];
  window.__sent = [];
  let wake = null;
  window.__watch = (path, data = '') => {
    window.__inbox.push({ path, data, at: Date.now() });
    wake?.();
  };
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
        clear: async () => { window.__keystore.token = null; sessionStorage.removeItem('__e2e_ks_token'); },
      },
      HealthConnect: {
        availability: async () => ({ status: 'available' }),
        grantedPermissions: async () => ({ granted: ['heart_rate'] }),
        requestAccess: async () => ({ granted: ['heart_rate'] }),
        openSettings: async () => {},
        readSleep: async () => ({ sessions: [] }),
        readSteps: async () => ({ days: [] }),
        readRestingHeartRate: async () => ({ records: [] }),
        readHeartRate: async () => ({ samples: [] }), // l'orologio di OHealth tace: conta solo l'app al polso
      },
      WatchLink: {
        addListener: (event, cb) => { if (event === 'message') wake = cb; },
        drain: async () => ({ messages: window.__inbox.splice(0) }),
        send: async ({ path, data }) => { window.__sent.push({ path, data: JSON.parse(data) }); return { nodes: 1 }; },
      },
    },
  };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Rome', locale: 'it-IT', colorScheme: 'dark' });
  await ctx.addInitScript(FAKE_NATIVE);
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
  for (const r of (await server('/api/v1/reminders')).items) await server(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');
  const lastState = () => page.evaluate(() => window.__sent.filter((m) => m.path === '/fitweek/state').pop()?.data || null);
  // Ultimo stato mandato all'orologio che soddisfa `ok` (controllo in Node: la CSP della pagina vieta l'eval).
  const waitState = async (ok) => {
    for (const t0 = Date.now(); Date.now() - t0 < 8000; await page.waitForTimeout(100)) {
      const s = await lastState();
      if (s && ok(s)) return s;
    }
    throw new Error('stato non arrivato: ' + JSON.stringify(await lastState()));
  };

  // 1. L'orologio si apre e chiede lo stato: nessuna seduta, la giornata proposta
  await page.evaluate(() => window.__watch('/fitweek/hello'));
  const idle = await waitState((s) => s.active === false);
  check('orologio aperto: riceve "nessuna seduta" e la giornata proposta', /^[A-C]$/.test(idle.routine), JSON.stringify(idle));

  // 2. "Inizia seduta" dal polso
  await page.evaluate(() => window.__watch('/fitweek/start'));
  const first = await waitState((s) => s.active === true && s.exId);
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 10000 });
  const today = await server('/api/v1/today');
  check('avvio dal polso: seduta aperta sul server con la giornata proposta', today.active_session?.routine === idle.routine, JSON.stringify(today.active_session?.routine));
  check('stato al polso: primo esercizio, serie 1, ripetizioni proposte', first.idx === 1 && first.planned >= 1 && first.reps > 0 && first.exercise.length > 0, JSON.stringify(first));

  // 3. Battito dal polso, un campione al secondo: compare nella testata senza aspettare Health Connect
  await page.click('.bottom-nav [data-view=training]');
  await page.waitForTimeout(1500); // l'inizio della seduta salvato dal server deve precedere tutti i campioni
  await page.evaluate(() => {
    const now = Date.now();
    // tutti dopo l'inizio della seduta (appena aperta): i campioni di prima non contano
    const samples = Array.from({ length: 15 }, (_, i) => `${120 + i},${now - (14 - i) * 40}`).join(';');
    window.__watch('/fitweek/hr', samples);
  });
  await page.locator('#wk-heart', { hasText: '134 bpm' }).waitFor({ timeout: 8000 });
  check('battito dal polso: ultimo valore, media e massimo in testata', /134 bpm.*media 127.*max 134/.test(await page.textContent('#wk-heart')), await page.textContent('#wk-heart'));

  // 4. "Serie fatta" dal polso con le ripetizioni corrette con la corona
  await page.evaluate((s) => window.__watch('/fitweek/set', JSON.stringify({ exId: s.exId, idx: 1, kg: 30, reps: 7 })), first);
  const second = await waitState((s) => s.exId === first.exId && s.idx === 2);
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 10000 });
  const set = (await server('/api/v1/today')).active_session.sets.find((x) => x.exercise_id === first.exId && x.set_index === 1);
  check('serie dal polso: salvata con carico e ripetizioni dell\'orologio', set?.completed && set.kg === 30 && set.reps === 7, JSON.stringify(set));
  check('dopo la serie: il polso passa alla serie 2 e riceve la fine del recupero', second.restEnd > Date.now(), JSON.stringify(second));
  check('la riga della serie è segnata anche sul telefono', (await page.locator(`.set-row.done[data-ex="${first.exId}"][data-idx="1"]`).count()) === 1);
  await page.evaluate((s) => window.__watch('/fitweek/set', JSON.stringify({ exId: s.exId, idx: 1, kg: 99, reps: 1 })), first);
  await page.waitForTimeout(800);
  const again = (await server('/api/v1/today')).active_session.sets.find((x) => x.exercise_id === first.exId && x.set_index === 1);
  check('una serie già segnata non si riscrive da un tocco ripetuto al polso', again.kg === 30 && again.reps === 7, JSON.stringify(again));
  await page.click('#rest-stop');
  const skipped = await waitState((s) => s.restEnd === 0);
  check('recupero saltato sul telefono: il polso lo sa', skipped.restEnd === 0);
  await page.screenshot({ path: `${SHOTS}/v119-wear-phone-390.png` });

  // 5. Fine seduta: il battito della seduta viene dai campioni del polso
  page.once('dialog', (d) => d.accept());
  await page.click('[data-finish]');
  await page.locator('.finish', { hasText: 'Battito: media 127' }).waitFor({ timeout: 10000 });
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 10000 });
  const heart = (await server(`/api/v1/workout-sessions/${today.active_session.id}`)).heart;
  check('fine seduta: battito dai campioni del polso, salvato sul server', heart?.samples === 15 && heart.max_bpm === 134, JSON.stringify({ ...heart, curve: heart?.curve?.length }));
  const ended = await waitState((s) => s.active === false);
  check('fine seduta: il polso torna a "nessuna seduta"', ended.active === false);

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n').slice(0, 3).join(' / '), '| errori della pagina:', (global.__errors || []).join(' | ') || 'nessuno');
  await global.__page?.screenshot({ path: (process.env.E2E_SHOTS || __dirname) + '/v119-wear-error.png' }).catch(() => {});
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
