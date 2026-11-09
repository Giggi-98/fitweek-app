// Test end-to-end di M4: promemoria con popup, registrazione pasti, pesata, diario, settimana.
// Esecuzione: scripts/e2e.sh
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// Orario e giorno della settimana a Roma, un minuto fa (il server calcola "scaduto" con questo fuso).
function romeMinuteAgo() {
  const d = new Date(Date.now() - 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((p) => [p.type, p.value]));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { weekday, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'Europe/Rome', locale: 'it-IT', colorScheme: 'dark' });
  const page = await ctx.newPage();
  global.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const api = (path, method = 'GET', body) => page.evaluate(([p, m, b]) => fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [path, method, body]);
  const { weekday, time } = romeMinuteAgo();
  const addReminder = (id, extra) => api(`/api/v1/reminders/${id}`, 'PUT', { weekday, time, title: 'Test', enabled: true, ...extra });

  await page.goto(B);
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  // Isola il test dai promemoria predefiniti di oggi: li disattiva tutti.
  const all = (await api('/api/v1/reminders')).items;
  const pick = ({ weekday: w, time: t, kind, slot, title, action }) => ({ weekday: w, time: t, kind, slot, title, action });
  for (const r of all.filter((x) => x.weekday === weekday)) await api(`/api/v1/reminders/${r.id}`, 'PUT', { ...pick(r), enabled: false });

  // 1. Popup pasto → un tocco su un pasto abituale
  await addReminder('e2e-meal', { kind: 'meal', slot: 'pre_workout', action: 'log_meal', title: 'Spuntino pre-palestra' });
  await page.reload();
  await page.waitForSelector('#modal[open]', { timeout: 8000 });
  check('popup del promemoria pasto', (await page.textContent('#modal-title')) === 'Spuntino pre-palestra');
  await page.screenshot({ path: `${SHOTS}/m4-1-popup.png` });
  await page.click('#modal [data-m=planned]'); // "Come previsto: Banana" eredita la stima del pasto abituale
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.waitForSelector('.agenda li.done', { timeout: 8000 });
  check('promemoria completato dal pasto registrato', (await page.locator('.agenda li.done').count()) === 1);
  const weekly = await page.textContent('.wk-chart');
  check('settimana: calorie teoriche del giorno', /105/.test(weekly), weekly.replace(/\s+/g, ' ').slice(0, 80));
  await page.screenshot({ path: `${SHOTS}/m4-2-dashboard.png`, fullPage: true });

  // 2. Popup pesata
  await addReminder('e2e-weigh', { kind: 'weigh_in', action: 'log_weight', title: 'Pesata' });
  await page.reload();
  await page.waitForSelector('#modal[open]', { timeout: 8000 });
  await page.fill('#m-weight', '89,4');
  await page.click('#modal [data-m=save]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.waitForTimeout(500);
  const st = await api('/api/state');
  check('pesata salvata dal popup', st.data.weights.some((w) => w.weight === 89.4));

  // 3. Posticipa
  await addReminder('e2e-sleep', { kind: 'sleep', action: 'none', title: 'Verso il letto' });
  await page.reload();
  await page.waitForSelector('#modal[open]', { timeout: 8000 });
  await page.click('#modal [data-m=later]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.waitForTimeout(800);
  const ag = (await api('/api/v1/agenda')).items.find((i) => i.id === 'e2e-sleep');
  check('posticipo di 15 minuti', ag.state === 'snoozed' && !ag.due);

  // 4. Inserimento libero dalla dashboard con calorie dichiarate
  await page.click('[data-quick-meal]');
  await page.waitForSelector('#modal[open]');
  await page.click('#modal .free summary');
  await page.fill('#m-desc', 'Piadina');
  await page.fill('#m-kcal', '520');
  await page.click('#modal [data-m=free]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.waitForTimeout(600);
  const today = (await api('/api/v1/today')).date;
  const logs = (await api(`/api/v1/meal-logs?from=${today}&to=${today}`)).items;
  const piadina = logs.find((m) => m.description === 'Piadina');
  check('pasto libero con kcal inserite (fonte: inserito)', piadina && piadina.kcal === 520 && piadina.nutrition_source === 'manual');

  // 5. Diario
  await page.click('.bottom-nav [data-view=meals]');
  await page.waitForSelector('.day-foot');
  const diary = await page.textContent('#content');
  check('diario: pasti di oggi con stima', /Banana/.test(diary) && /stima/.test(diary) && /Piadina/.test(diary) && /625/.test(diary), '');
  await page.screenshot({ path: `${SHOTS}/m4-3-diary.png`, fullPage: true });

  // 6. Pasti abituali: correggi Banana con valori da etichetta
  await page.click('[data-tab=templates]');
  const form = page.locator('[data-tpl-form="t-banana"]');
  await form.locator('input[name=kcal]').fill('110');
  await form.locator('select[name=nutrition_source]').selectOption('label');
  await form.locator('button[type=submit]').click();
  await page.waitForTimeout(600);
  const tpl = (await api('/api/v1/meal-templates')).items.find((t) => t.id === 't-banana');
  check('pasto abituale modificato', tpl.kcal === 110 && tpl.nutrition_source === 'label');

  // 7. Impostazioni: promemoria
  await page.click('.topbar [data-view=settings]');
  await page.waitForSelector('.rem-row');
  const row = page.locator('[data-rem-form="e2e-meal"]');
  await row.locator('input[name=time]').fill('07:30');
  await row.locator('input[name=time]').dispatchEvent('change');
  await page.waitForTimeout(600);
  const r1 = (await api('/api/v1/reminders')).items.find((x) => x.id === 'e2e-meal');
  check('orario promemoria modificato', r1.time === '07:30');
  const summary = page.locator('#content details.free summary').last();
  await summary.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await summary.click();
  await page.fill('#rn-title', 'Prepara la borsa');
  await page.fill('#rn-time', '07:45');
  await page.locator('#rem-new button[type=submit]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.click('#rem-new button[type=submit]');
  await page.waitForTimeout(600);
  const r2 = (await api('/api/v1/reminders')).items.find((x) => x.title === 'Prepara la borsa');
  check('promemoria personalizzato creato', r2 && r2.time === '07:45' && r2.weekday === weekday);
  await page.screenshot({ path: `${SHOTS}/m4-4-settings.png`, fullPage: true });

  // 8. Backup v3
  const backup = await api('/api/backup');
  check('backup v3 con pasti e promemoria', backup.format === 'fitweek-backup-v3' && backup.meal_logs.length >= 2 && backup.reminders.length > 30);

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
  if (out.some((l) => l.startsWith('FAIL'))) process.exit(1);
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0]);
  await global.__page?.screenshot({ path: SHOTS + '/m4-error.png' }).catch(() => {});
  process.exit(1);
});
