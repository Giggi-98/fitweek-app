// Test e2e dell'integrazione Android: simula il bridge Capacitor nel browser e verifica le notifiche
// programmate dai promemoria reali del server, il tocco su una notifica e il download dell'APK.
// Esecuzione: scripts/e2e.sh
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// Finto bridge Capacitor: registra le chiamate al plugin in window.__ln
const FAKE_CAPACITOR = () => {
  const listeners = {};
  window.__ln = { scheduled: [], cancelled: [], channels: [], listeners };
  let pending = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LocalNotifications: {
        checkPermissions: async () => ({ display: 'granted' }),
        requestPermissions: async () => ({ display: 'granted' }),
        checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
        changeExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
        createChannel: async (c) => window.__ln.channels.push(c),
        getPending: async () => ({ notifications: pending.map((n) => ({ id: n.id })) }),
        cancel: async ({ notifications }) => { window.__ln.cancelled.push(...notifications.map((n) => n.id)); pending = pending.filter((p) => !notifications.some((n) => n.id === p.id)); },
        schedule: async ({ notifications }) => { pending.push(...notifications); window.__ln.scheduled = [...pending]; return { notifications }; },
        addListener: (evt, cb) => { listeners[evt] = cb; return { remove() {} }; },
      },
      App: { addListener: (evt, cb) => { listeners['app:' + evt] = cb; return { remove() {} }; }, minimizeApp: async () => { window.__ln.minimized = true; } },
    },
  };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Galaxy S9+'], timezoneId: 'Europe/Rome', locale: 'it-IT' });
  await ctx.addInitScript(FAKE_CAPACITOR);
  const page = await ctx.newPage();
  global.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const api = (path, method = 'GET', body) => page.evaluate(([p, m, b]) => fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [path, method, body]);

  await page.goto(B);
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  await page.waitForFunction(() => window.__ln.scheduled.length > 0, null, { timeout: 8000 });
  const ln = await page.evaluate(() => ({ ...window.__ln, scheduled: window.__ln.scheduled.map((n) => ({ ...n, at: new Date(n.schedule.at).getTime() })) }));
  const reminders = (await api('/api/v1/reminders')).items.filter((r) => r.enabled);
  const now = Date.now();
  check('canale notifiche creato', ln.channels.some((c) => c.id === 'promemoria' && c.importance === 5));
  check('notifiche programmate per 14 giorni', ln.scheduled.length >= reminders.length * 2 - 10 && ln.scheduled.length <= reminders.length * 2, `${ln.scheduled.length} per ${reminders.length} promemoria`);
  check('tutte nel futuro, id univoci, allowWhileIdle', ln.scheduled.every((n) => n.at > now && n.schedule.allowWhileIdle) && new Set(ln.scheduled.map((n) => n.id)).size === ln.scheduled.length);
  check('canale e testo corretti', ln.scheduled.every((n) => n.channelId === 'promemoria' && n.title && n.body));
  check('classe native sul documento', await page.evaluate(() => document.documentElement.classList.contains('native')));

  // Registrare un pasto di oggi toglie la sua notifica di oggi
  const today = (await api('/api/v1/today')).date;
  const agenda = (await api('/api/v1/agenda')).items;
  const futureMeal = agenda.find((i) => i.action === 'log_meal' && i.state === 'pending' && !i.due);
  if (futureMeal) {
    await api(`/api/v1/meal-logs/e2e-native`, 'PUT', { date: today, slot: futureMeal.slot, description: 'test' });
    await page.evaluate(() => window.dispatchEvent(new Event('fitweek:changed')));
    await page.waitForTimeout(800);
    const still = await page.evaluate(([id, d]) => window.__ln.scheduled.some((n) => n.extra.reminderId === id && n.extra.date === d), [futureMeal.id, today]);
    check('pasto registrato → notifica di oggi rimossa', !still);
  } else {
    check('pasto registrato → notifica di oggi rimossa (saltato: nessun pasto futuro oggi)', true);
  }

  // Tocco su una notifica di oggi → popup giusto
  const target = (await api('/api/v1/agenda')).items.find((i) => i.action === 'log_meal' || i.action === 'log_weight');
  if (target) {
    await page.evaluate(([id, d]) => window.__ln.listeners.localNotificationActionPerformed({ notification: { extra: { reminderId: id, date: d } } }), [target.id, today]);
    await page.waitForSelector('#modal[open]', { timeout: 5000 });
    check('tocco sulla notifica apre il popup', (await page.textContent('#modal-title')).length > 0);
    // Tasto indietro Android chiude la modale
    await page.evaluate(() => window.__ln.listeners['app:backButton']({ canGoBack: false }));
    await page.waitForSelector('#modal', { state: 'hidden' });
    check('tasto indietro chiude il popup', true);
  }
  await page.evaluate(() => window.__ln.listeners['app:backButton']({ canGoBack: false }));
  check('tasto indietro dalla home riduce a icona', await page.evaluate(() => window.__ln.minimized === true));

  // Pannello nativo in Impostazioni
  await page.click('.topbar [data-view=settings]');
  await page.click('[data-tab=app]');
  await page.waitForSelector('[data-native=test]');
  const panelText = await page.textContent('#content');
  check('pannello app: stato notifiche', /consentite ✓/.test(panelText) && /notifiche programmate/.test(panelText));
  await page.screenshot({ path: `${SHOTS}/m6-native-settings.png` });

  // Browser normale: pulsante di download dell'APK reale
  const web = await browser.newContext({ ...devices['Galaxy S9+'], locale: 'it-IT' });
  const wp = await web.newPage();
  await wp.goto(B);
  await wp.fill('#pw', PW);
  await wp.click('#login-form button');
  await wp.waitForSelector('#shell:not(.hidden)');
  await wp.click('.topbar [data-view=settings]');
  await wp.click('[data-tab=app]');
  const info = await wp.evaluate(() => fetch('/api/v1/app/android').then((r) => r.json()));
  if (info.available) {
    await wp.waitForSelector('a[href="/api/v1/app/android/download"]');
    const [download] = await Promise.all([wp.waitForEvent('download'), wp.click('a[href="/api/v1/app/android/download"]')]);
    check('download APK dal browser', /^fitweek-.*\.apk$/.test(download.suggestedFilename()), download.suggestedFilename());
    await wp.screenshot({ path: `${SHOTS}/m6-download.png` });
  } else {
    check('download APK (nessun APK montato nel container di test)', true);
  }

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
  if (out.some((l) => l.startsWith('FAIL'))) process.exit(1);
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0]);
  await global.__page?.screenshot({ path: SHOTS + '/m6-error.png' }).catch(() => {});
  process.exit(1);
});
