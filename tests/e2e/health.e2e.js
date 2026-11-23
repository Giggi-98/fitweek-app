// Test end-to-end dei dati dall'orologio (1.14, D-040): l'app autonoma legge Health Connect (plugin simulato),
// manda al server solo ciò che è cambiato, non tocca le notti decise dall'utente e lavora anche senza rete.
// Pagine servite da un'altra origine, come nell'APK. Esecuzione: E2E_ONLY=health scripts/e2e.sh
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:18090';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// Keystore e Health Connect simulati. I dati dell'orologio stanno in sessionStorage, così sopravvivono ai reload.
const FAKE_NATIVE = () => {
  window.__keystore = { token: sessionStorage.getItem('__e2e_ks_token') || null };
  const hc = () => JSON.parse(sessionStorage.getItem('__hc') || '{"status":"available","granted":[],"grantOnRequest":[],"sleep":[],"steps":[],"resting":[],"heart":[],"hrv":[],"spo2":[],"weight":[]}');
  const saveHc = (v) => sessionStorage.setItem('__hc', JSON.stringify(v));
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
      HealthConnect: {
        availability: async () => ({ status: hc().status }),
        grantedPermissions: async () => ({ granted: hc().granted }),
        requestAccess: async () => {
          const v = hc();
          v.granted = v.grantOnRequest;
          saveHc(v);
          return { granted: v.granted };
        },
        openSettings: async () => {},
        readSleep: async () => ({ sessions: hc().sleep }),
        readSteps: async () => ({ days: hc().steps }),
        readRestingHeartRate: async () => ({ records: hc().resting }),
        readHrv: async () => ({ records: hc().hrv || [] }),
        readSpo2: async () => ({ records: hc().spo2 || [] }),
        readWeight: async () => ({ records: hc().weight || [] }),
        readHeartRate: async ({ from, to }) => ({ samples: hc().heart.filter((s) => new Date(s.time) >= new Date(from) && new Date(s.time) <= new Date(to)) }),
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

  // Sul server: una notte scritta a mano ieri, una notte importata e poi eliminata l'altro ieri, una seduta di oggi.
  const { date: today, program_week: week } = await server('/api/v1/today');
  for (const r of (await server('/api/v1/reminders')).items) await server(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  const addDays = (iso, n) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
  const [yesterday, before] = [addDays(today, -1), addDays(today, -2)];
  await server(`/api/v1/sleep/${yesterday}`, 'PUT', { bed_time: '01:00', wake_time: '08:00', note: 'scritta a mano' });
  await server(`/api/v1/sleep/${before}`, 'PUT', { bed_time: '00:00', wake_time: '07:00', source: 'health_connect' });
  await server(`/api/v1/sleep/${before}`, 'DELETE');
  const session = await server('/api/v1/workout-sessions', 'POST', { id: 'e2e-gym', routine: 'A', week, date: today });
  const start = new Date(session.started_at);
  const end = new Date(start.getTime() + 70 * 60000);
  await server('/api/v1/workout-sessions/e2e-gym', 'PATCH', { status: 'done', ended_at: end.toISOString(), duration_min: 70 });

  // Sull'orologio: tre notti (una per ciascuno di quei giorni, più un pisolino oggi), passi, battito.
  await page.evaluate(({ today, yesterday, before, beforeThat, start }) => {
    const at = (day, hh, mm) => new Date(`${day}T${hh}:${mm}:00`).toISOString(); // ora locale del telefono
    const night = (day, prev) => ({ start: at(prev, '23', '50'), end: at(day, '07', '10'), stages: [
      { start: at(prev, '23', '50'), end: at(day, '01', '10'), stage: 'light' }, { start: at(day, '01', '10'), end: at(day, '02', '30'), stage: 'deep' },
      { start: at(day, '02', '30'), end: at(day, '02', '40'), stage: 'awake' }, { start: at(day, '02', '40'), end: at(day, '07', '10'), stage: 'rem' }] });
    const t0 = new Date(start).getTime();
    sessionStorage.setItem('__hc', JSON.stringify({
      status: 'available', granted: [], grantOnRequest: ['sleep', 'steps', 'heart_rate', 'hrv', 'spo2', 'weight'],
      sleep: [night(today, yesterday), night(yesterday, before), night(before, beforeThat), { start: at(today, '06', '00'), end: at(today, '06', '20'), stages: [] }],
      steps: [{ date: yesterday, steps: 9876 }, { date: today, steps: 4321 }],
      resting: [{ time: at(yesterday, '08', '00'), bpm: 61 }],
      heart: Array.from({ length: 20 }, (_, i) => ({ time: new Date(t0 + (i + 1) * 3 * 60000).toISOString(), bpm: 110 + i })),
      hrv: [{ time: at(today, '03', '00'), value: 42 }, { time: at(today, '04', '00'), value: 50 }],
      spo2: [{ time: at(today, '03', '00'), value: 96.4 }],
      weight: [{ time: at(yesterday, '19', '00'), kg: 89.9 }, { time: at(yesterday, '06', '40'), kg: 89.44 }],
    }));
  }, { today, yesterday, before, beforeThat: addDays(today, -3), start: session.started_at });
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');

  // 1. Collegamento dalle impostazioni
  await page.click('.topbar [data-view=settings]');
  await page.click('[data-tab=app]');
  await page.waitForSelector('#watch-panel [data-watch=connect]');
  check('pannello: prima del collegamento c\'è una sola azione principale', (await page.locator('#watch-panel .btn.primary').count()) === 1 && /Nessun dato consentito/.test(await page.textContent('#watch-panel')));
  await page.click('#watch-panel [data-watch=connect]');
  await page.locator('#watch-panel', { hasText: 'valori nuovi inviati' }).waitFor({ timeout: 10000 });
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 15000 });
  check('pannello: dice cosa legge e cosa no', /Legge: sonno, passi, battito in palestra/.test(await page.textContent('#watch-panel')) && /Non consentiti: battito a riposo/.test(await page.textContent('#watch-panel')));
  await page.screenshot({ path: `${SHOTS}/v114-watch-panel-390.png`, fullPage: true });

  const nights = Object.fromEntries((await server(`/api/v1/sleep?from=${before}&to=${today}`)).items.map((n) => [n.date, n]));
  const n = nights[today];
  check('notte di oggi importata con le fasi, il pisolino non conta', n && n.source === 'health_connect' && n.bed_time === '23:50' && n.wake_time === '07:10' && n.deep_min === 80 && n.rem_min === 270 && n.awake_min === 10, JSON.stringify(n));
  check('la notte scritta a mano resta com\'è', nights[yesterday]?.source === 'manual' && nights[yesterday]?.note === 'scritta a mano', JSON.stringify(nights[yesterday]));
  check('la notte eliminata non torna', !nights[before], JSON.stringify(nights[before]));
  const days = Object.fromEntries((await server(`/api/v1/health-days?from=${yesterday}&to=${today}`)).items.map((d) => [d.date, d]));
  check('passi per giorno; battito a riposo non consentito → nessun valore', days[today]?.steps === 4321 && days[yesterday]?.steps === 9876 && days[yesterday]?.resting_hr === null, JSON.stringify(days));
  check('HRV e SpO2: media del giorno', days[today]?.hrv_ms === 46 && days[today]?.spo2 === 96, JSON.stringify(days[today]));
  const weights = (await server('/api/state')).data.weights;
  check('bilancia: la prima pesata del giorno entra come nuova, marcata dalla bilancia', weights.length === 1 && weights[0].date === yesterday && weights[0].weight === 89.4 && weights[0].source === 'health_connect', JSON.stringify(weights));
  const heart = (await server('/api/v1/workout-sessions/e2e-gym')).heart;
  check('battito della seduta: media e massimo dei campioni dentro la seduta', heart && heart.avg_bpm === 120 && heart.max_bpm === 129 && heart.samples === 20, JSON.stringify(heart));

  // 2. Seconda importazione: niente di nuovo, nessuna scrittura
  await page.click('#watch-panel [data-watch=import]');
  await page.locator('#toast', { hasText: 'Nessun dato nuovo' }).waitFor({ timeout: 8000 });
  check('seconda importazione: nessun doppione in coda', (await page.evaluate(() => JSON.parse(localStorage.getItem('fitweek.workoutQueue.v1') || '[]').length)) === 0);

  // 2b. OHealth sincronizza altri campioni in ritardo: la seduta appena finita si aggiorna
  await page.evaluate(({ start }) => {
    const v = JSON.parse(sessionStorage.getItem('__hc'));
    const t0 = new Date(start).getTime();
    v.heart.push(...Array.from({ length: 10 }, (_, i) => ({ time: new Date(t0 + (61 + i) * 60000).toISOString(), bpm: 150 })));
    sessionStorage.setItem('__hc', JSON.stringify(v));
  }, { start: session.started_at });
  await page.click('#watch-panel [data-watch=import]');
  await page.locator('#toast', { hasText: '1 valori importati' }).waitFor({ timeout: 8000 });
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 15000 });
  const later = (await server('/api/v1/workout-sessions/e2e-gym')).heart;
  check('campioni arrivati in ritardo: battito della seduta ricalcolato', later?.samples === 30 && later?.max_bpm === 150, JSON.stringify(later));

  // 3. Progressi: passi, fasi della notte, battito della seduta
  await page.click('.bottom-nav [data-view=progress]');
  await page.click('[data-tab=heart]');
  await page.locator('#content', { hasText: 'Passi oggi' }).waitFor();
  check('Cuore e passi: passi di oggi e media dei giorni passati', /4\.?321/.test(await page.textContent('#content')) && /9\.?876/.test(await page.textContent('#content')), (await page.textContent('#content')).slice(0, 200));
  // fine della transizione tra le schede (un'animazione interrotta non conta)
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.screenshot({ path: `${SHOTS}/v114-heart-390.png`, fullPage: true });
  await page.click('[data-tab=sleep]');
  await page.locator('#content', { hasText: 'Fasi della notte' }).waitFor();
  check('Sonno: fasi dell\'ultima notte importata', /profondo 1 h 20 · leggero 1 h 20 · REM 4 h 30 · sveglio 10 min/.test(await page.textContent('#content')), (await page.locator('#content p.subtle').allTextContents()).join(' | '));
  await page.screenshot({ path: `${SHOTS}/v114-sleep-390.png`, fullPage: true });
  await page.click('[data-tab=training]');
  check('Storico: battito medio e massimo della seduta', /battito medio \d+, max 150 bpm/.test(await page.textContent('#content')));

  // 4. Senza rete: i passi aumentano, l'importazione va in coda e si vede subito; al ritorno arriva al server
  await page.route(`${B}/**`, (r) => r.abort());
  await page.evaluate((today) => {
    const v = JSON.parse(sessionStorage.getItem('__hc'));
    v.steps = v.steps.map((d) => (d.date === today ? { ...d, steps: 5000 } : d));
    sessionStorage.setItem('__hc', JSON.stringify(v));
  }, today);
  await page.click('.topbar [data-view=settings]');
  await page.click('[data-tab=app]');
  await page.click('#watch-panel [data-watch=import]');
  await page.locator('#toast', { hasText: '1 valori importati' }).waitFor({ timeout: 8000 });
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('fitweek.workoutQueue.v1')).map((o) => `${o.method} ${o.path}`));
  check('senza rete: un solo giorno cambiato, in coda', queued.length === 1 && queued[0] === `PUT /api/v1/health-days/${today}`, queued.join(', '));
  await page.click('.bottom-nav [data-view=progress]');
  await page.click('[data-tab=heart]');
  await page.locator('#content', { hasText: /5\.?000/ }).waitFor({ timeout: 5000 });
  check('senza rete: i passi nuovi si vedono dalla copia sul telefono', true);
  await page.unroute(`${B}/**`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 20000 });
  const back = (await server(`/api/v1/health-days?from=${today}&to=${today}`)).items[0];
  check('ritorno online: i passi arrivano al server', back?.steps === 5000, JSON.stringify(back));

  // 5. Schermate su desktop e tema chiaro, con qualche giorno di battito a riposo per vedere il grafico
  for (const [i, bpm] of [[-4, 64], [-3, 62], [-2, 63]]) await server(`/api/v1/health-days/${addDays(today, i)}`, 'PUT', { steps: 8000, resting_hr: bpm });
  const wide = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Rome', locale: 'it-IT', colorScheme: 'light' });
  await wide.addInitScript(FAKE_NATIVE);
  const desk = await wide.newPage();
  await desk.goto(APP);
  await desk.evaluate(({ token, hc }) => { sessionStorage.setItem('__e2e_ks_token', token); sessionStorage.setItem('__hc', hc); }, { token, hc: await page.evaluate(() => sessionStorage.getItem('__hc')) });
  await desk.goto(APP);
  await desk.waitForSelector('#shell:not(.hidden)');
  await desk.evaluate(() => (location.hash = '#progress'));
  await desk.click('[data-tab=heart]');
  await desk.locator('#content', { hasText: 'Passi oggi' }).waitFor();
  await desk.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  check('grafico del battito a riposo con la media', (await desk.locator('#content svg').count()) > 0 && /63/.test(await desk.textContent('#content')));
  await desk.screenshot({ path: `${SHOTS}/v114-heart-1280-light.png`, fullPage: true });
  await desk.evaluate(() => (location.hash = '#settings'));
  await desk.click('[data-tab=app]');
  await desk.waitForSelector('#watch-panel [data-watch=import]');
  await desk.screenshot({ path: `${SHOTS}/v114-watch-panel-1280-light.png`, fullPage: true });
  await wide.close();

  // 5b. Seduta in corso: il battito dal vivo compare nella testata dell'allenamento
  const liveSession = await server('/api/v1/workout-sessions', 'POST', { id: 'e2e-live', routine: 'B', week, date: today });
  await page.evaluate(({ start }) => {
    const v = JSON.parse(sessionStorage.getItem('__hc'));
    const t0 = new Date(start).getTime();
    v.heart.push({ time: new Date(t0 + 500).toISOString(), bpm: 101 }, { time: new Date(t0 + 1000).toISOString(), bpm: 133 });
    sessionStorage.setItem('__hc', JSON.stringify(v));
  }, { start: liveSession.started_at });
  await new Promise((r) => setTimeout(r, 1500)); // i campioni devono essere nel passato
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');
  await page.click('.bottom-nav [data-view=training]');
  await page.locator('#wk-heart', { hasText: '133 bpm' }).waitFor({ timeout: 8000 });
  check('seduta in corso: ultimo battito, media e massimo', /133 bpm.*media 117.*max 133/.test(await page.textContent('#wk-heart')), await page.textContent('#wk-heart'));
  await page.screenshot({ path: `${SHOTS}/v115-live-heart-390.png` });

  // 6. Nel browser (webapp) il pannello non c'è; i dati invece si vedono in Progressi
  const web = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Rome', locale: 'it-IT' });
  const wp = await web.newPage();
  await wp.goto(B);
  await wp.fill('#pw', PW);
  await wp.click('#login-form button');
  await wp.waitForSelector('#shell:not(.hidden)');
  await wp.click('.topbar [data-view=settings]');
  await wp.click('[data-tab=app]');
  await wp.waitForSelector('#android-panel');
  check('webapp: nessun pannello dell\'orologio', (await wp.locator('#watch-panel').count()) === 0);
  await wp.click('.bottom-nav [data-view=progress]');
  await wp.click('[data-tab=heart]');
  await wp.locator('#content', { hasText: /5\.?000/ }).waitFor({ timeout: 5000 });
  check('webapp: i dati dell\'orologio si vedono in Progressi', true);
  await web.close();

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0], '| errori della pagina:', (global.__errors || []).join(' | ') || 'nessuno');
  await global.__page?.screenshot({ path: SHOTS + '/v114-health-error.png' }).catch(() => {});
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
