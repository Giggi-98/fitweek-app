// Giro fotografico di tutte le viste (tappa 5, deslop-ui): ogni vista e ogni scheda principale a 390 px e a
// 1280 px, tema scuro e chiaro, con dati realistici. Controlla che nessuna pagina scorra in orizzontale e che
// non compaiano errori. Le schermate vanno in E2E_SHOTS (screens-*.png).
// Esecuzione: E2E_ONLY=screens scripts/e2e.sh
const { chromium } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const PAGES = [
  ['dashboard', ['day', 'week']],
  ['training', [null]],
  ['meals', ['diary', 'plan', 'templates']],
  ['shopping', ['list', 'pantry', 'spend']],
  ['progress', ['weight', 'training', 'sleep', 'heart']],
  ['settings', ['general', 'reminders', 'data']],
];

async function seed(request) {
  const headers = { 'Content-Type': 'application/json', Origin: B };
  const call = async (path, method = 'GET', data) => (await request.fetch(B + path, { method, headers, data })).json();
  const { date: today, program_week: week } = await call('/api/v1/today');
  const day = (n) => new Date(new Date(`${today}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
  for (const r of (await call('/api/v1/reminders')).items) {
    await call(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  }
  const s = await call('/api/state');
  s.data.weights = [90.1, 89.8, 89.9, 89.5, 89.4, 89.2].map((w, i) => ({ id: `w${i}`, date: day(-12 + i * 2), weight: w }));
  s.data.groceries = [['Petto di pollo', 'Carne e pesce'], ['Yogurt greco', 'Latticini'], ['Banane', 'Frutta e verdura'], ['Gallette di riso', 'Dispensa']]
    .map(([name, category], i) => ({ id: `g${i}`, name, qty: '1', category, checked: i === 2 }));
  s.data.inventory = [{ id: 'i1', name: 'Riso basmati', qty: '500 g', amount: 500, unit: 'g' }, { id: 'i2', name: 'Tonno', qty: '3', amount: 3, unit: 'pz' }];
  await call('/api/state', 'PUT', s);
  for (let i = 1; i <= 5; i++) {
    await call(`/api/v1/sleep/${day(-i)}`, 'PUT', { bed_time: i % 2 ? '00:10' : '01:40', wake_time: '07:30' });
    await call(`/api/v1/health-days/${day(-i)}`, 'PUT', { steps: 6000 + i * 700, resting_hr: 62 - (i % 3), hrv_ms: 40 + i, spo2: 97 });
  }
  const sid = 'screens-1';
  await call('/api/v1/workout-sessions', 'POST', { id: sid, routine: 'A', week, date: day(-2) });
  for (const [ex, idx, kg, reps] of [['a1', 1, 40, 10], ['a1', 2, 40, 9], ['a2', 1, 22.5, 12]]) {
    await call(`/api/v1/workout-sessions/${sid}/sets/${ex}/${idx}`, 'PUT', { kg, reps, rir: 2, completed: true, kind: 'normal' });
  }
  await call(`/api/v1/workout-sessions/${sid}`, 'PATCH', { status: 'done', ended_at: new Date().toISOString(), duration_min: 68 });
  await call(`/api/v1/meal-logs/screens-lunch`, 'PUT', { date: today, slot: 'lunch', status: 'eaten', description: '', note: '',
    items: [{ name: 'Pasta al pomodoro', category: 'primo', qty: 1, kcal: 420, protein_g: 14, nutrition_source: 'estimate' }, { name: 'Insalata', category: 'contorno', qty: 1 }] });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  global.__errors = errors;
  for (const [width, height, scheme] of [[390, 844, 'dark'], [390, 844, 'light'], [1280, 900, 'dark'], [1280, 900, 'light']]) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 600 ? 2 : 1, timezoneId: 'Europe/Rome', locale: 'it-IT', colorScheme: scheme });
    const page = await ctx.newPage();
    global.__page = page;
    page.on('pageerror', (e) => errors.push(`${width}/${scheme} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`${width}/${scheme} ${m.text()}`); });
    await page.goto(B);
    await page.fill('#pw', PW);
    await page.click('#login-form button');
    await page.waitForSelector('#shell:not(.hidden)');
    if (!out.length) {
      await seed(ctx.request);
      await page.evaluate(() => document.querySelector('dialog[open]')?.close()); // un promemoria già aperto
      await page.reload();
      await page.waitForSelector('#shell:not(.hidden)');
    }
    const wide = [];
    for (const [view, tabs] of PAGES) {
      await page.evaluate((v) => (location.hash = `#${v}`), view);
      await page.waitForTimeout(400); // transizione tra le viste
      for (const tab of tabs) {
        const tabEl = page.locator(`#content [role=tab][data-tab=${tab}]`);
        if (tab && !(await tabEl.isVisible())) continue; // su schermo largo alcune schede sono affiancate, non scelte
        if (tab) await tabEl.click();
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 0) wide.push(`${view}/${tab} +${over}px`);
        await page.screenshot({ path: `${SHOTS}/screens-${width}-${scheme}-${view}${tab ? '-' + tab : ''}.png`, fullPage: true });
      }
    }
    check(`${width} px ${scheme}: nessuna vista scorre in orizzontale`, !wide.length, wide.join(', '));
    await ctx.close();
  }
  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n').slice(0, 3).join(' / '), '| errori della pagina:', (global.__errors || []).join(' | ') || 'nessuno');
  await global.__page?.screenshot({ path: SHOTS + '/screens-error.png' }).catch(() => {});
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
