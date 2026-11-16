// Test end-to-end della 1.13: scheda modificabile con ripristino dal PDF, scelte valide solo per la seduta,
// tipi di serie, recupero per esercizio, obiettivo della serie, record e scheda dell'esercizio.
// Esecuzione: E2E_ONLY=program scripts/e2e.sh
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'Europe/Rome', locale: 'it-IT', colorScheme: 'dark' });
  const page = await ctx.newPage();
  global.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(B);
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  const api = (path, method = 'GET', body) => page.evaluate(([p, m, b]) => fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [path, method, body]);
  for (const r of (await api('/api/v1/reminders')).items) await api(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  // Due sedute già fatte del Giorno A: lat machine 40×10 ×3 (in cima alle ripetizioni), face pull 15×8.
  const set = (id, ex, i, kg, reps, kind) => api(`/api/v1/workout-sessions/${id}/sets/${ex}/${i}`, 'PUT', { kg, reps, ...(kind ? { kind } : {}) });
  for (const [id, date, kg] of [['e2e-old1', '2026-10-05', 37.5], ['e2e-old2', '2026-10-12', 40]]) {
    await api('/api/v1/workout-sessions', 'POST', { id, routine: 'A', week: 1, date });
    await set(id, 'a1', 1, 20, 12, 'warmup');
    for (const i of [2, 3, 4]) await set(id, 'a1', i, kg, 10);
    await set(id, 'a2', 1, 15, 8);
    await api(`/api/v1/workout-sessions/${id}`, 'PATCH', { status: 'done', duration_min: 60 });
  }
  const state = async () => (await api('/api/state')).data;
  const saved = () => page.waitForSelector('#sync[data-state=ok]');
  const closed = () => page.waitForSelector('#modal', { state: 'hidden' });
  await page.reload();
  await page.waitForSelector('#shell:not(.hidden)');
  await page.click('.bottom-nav [data-view=training]');
  await page.click('[data-pick-routine=A]');

  // 1. Scheda dell'esercizio dalla riga del programma
  await page.click('#program-panel [data-ex-page=a1]');
  await page.waitForSelector('#modal[open] .chart-wrap svg');
  const pageText = (await page.textContent('#modal-body')).replace(/\s+/g, ' ');
  check('scheda esercizio: carico massimo, massimale stimato e volume senza il riscaldamento', /Carico massimo\s*40 kg/.test(pageText) && /~53,3 kg/.test(pageText) && /1\.200 kg/.test(pageText) && /stima/.test(pageText), pageText.slice(0, 200));
  check('scheda esercizio: ultime sedute con le serie di lavoro', /40×10 · 40×10 · 40×10/.test(pageText) && !/20×12/.test(pageText));
  await page.click('#modal [data-metric=e1rm]');
  await page.waitForSelector('#modal [data-metric=e1rm][aria-checked=true]');
  await page.screenshot({ path: `${SHOTS}/v113-1-esercizio.png` });

  // 2. Editor: serie per settimana, recupero, gruppo; il programma lo segna "modificato"
  await page.click('#modal [data-m=edit]');
  await page.waitForSelector('#xe-name');
  await page.fill('[data-week="0"]', '5');
  await page.selectOption('#xe-rest', '120');
  await page.fill('#xe-video', 'http://non-sicuro.example');
  await page.click('#modal [data-m=save]');
  await page.locator('#toast', { hasText: 'https' }).waitFor();
  await page.fill('#xe-video', '');
  await page.screenshot({ path: `${SHOTS}/v113-2-editor.png` });
  await page.click('#modal [data-m=save]');
  await closed(); await saved();
  let a1 = (await state()).routines.A[0];
  check('editor: serie della settimana 1 e recupero salvati; link non https rifiutato', a1.sets[0] === 5 && a1.sets[1] === 3 && a1.rest === 120 && a1.video === '', JSON.stringify(a1));
  await page.locator('#program-panel .ex-line', { hasText: 'modificato' }).waitFor();
  check('programma: esercizio segnato come modificato rispetto al PDF', /diversa da quella del PDF/.test(await page.textContent('#program-panel')));

  // 3. Modifica della giornata: riordino, sostituzione con un esercizio nuovo, rimozione con Annulla
  await page.click('[data-edit-program]');
  await page.click('[data-move-ex=a2][data-dir="-1"]');
  await saved();
  check('riordino: face pull al primo posto', (await state()).routines.A[0].id === 'a2');
  await page.click('[data-edit-ex=a3]');
  await page.click('#modal [data-m=replace]');
  await page.fill('#xp-name', 'Alzate laterali');
  await page.click('#modal [data-m=new]');
  await page.waitForSelector('#xe-name');
  await page.click('#modal [data-m=save]');
  await closed(); await saved();
  let st = await state();
  check('sostituzione: il nuovo esercizio prende il posto, il vecchio resta in archivio', st.routines.A[2].name === 'Alzate laterali' && st.exerciseArchive.some((e) => e.id === 'a3') && st.routines.A.length === 7, st.routines.A.map((e) => e.id).join());
  await page.click('[data-edit-ex=a7]');
  await page.click('#modal [data-m=remove]');
  await closed();
  await page.locator('#toast', { hasText: 'tolto dal Giorno A' }).waitFor();
  check('rimozione: la riga sparisce subito', (await page.locator('#program-panel [data-ex-page=a7]').count()) === 0);
  await page.click('#toast .toast-action');
  await saved();
  st = await state();
  check('Annulla: l\'esercizio torna al suo posto', st.routines.A[6].id === 'a7' && !st.exerciseArchive.some((e) => e.id === 'a7'), st.routines.A.map((e) => e.id).join());
  await page.screenshot({ path: `${SHOTS}/v113-3-modifica.png`, fullPage: true });

  // 4. Ripristino dal PDF: la giornata torna quella verificata, l'esercizio creato resta tra i tuoi
  await page.click('[data-restore-routine]');
  await saved();
  st = await state();
  const pdf = (await api('/api/v1/program/original')).routines.A;
  check('ripristino: Giorno A identico alla scheda del PDF', JSON.stringify(st.routines.A.map(({ rest, muscle, ...e }) => e)) === JSON.stringify(pdf) && st.exerciseArchive.some((e) => e.name === 'Alzate laterali'));
  check('ripristino: sparisce l\'avviso di scheda modificata', !/diversa da quella del PDF/.test(await page.textContent('#program-panel')));
  await page.click('[data-edit-program]');

  // 5. Seduta: obiettivo della serie, tipo di serie, recupero dell'esercizio, record
  await api('/api/state').then(async (s) => { s.data.routines.A[0].rest = 120; await api('/api/state', 'PUT', s); });
  await page.reload();
  await page.click('.bottom-nav [data-view=training]');
  await page.click('[data-pick-routine=A]');
  await page.click('[data-start]');
  await page.waitForSelector('#ex-a1 .ex-goal');
  const goal = (await page.textContent('#ex-a1 .ex-goal')).replace(/\s+/g, ' ');
  check('obiettivo: eri in cima alle ripetizioni → +2,5 kg dal minimo', /42,5 kg × 8/.test(goal) && /cima/.test(goal), goal);
  check('ultima volta: solo le serie di lavoro', /40×10 · 40×10 · 40×10/.test(await page.textContent('#ex-a1 .ex-last')) && !/20×12/.test(await page.textContent('#ex-a1 .ex-last')));
  const row = (ex, i) => page.locator(`#ex-${ex} .set-row`).nth(i);
  await row('a1', 0).locator('[data-kind]').click();
  check('tipo di serie: un tocco sul numero la segna riscaldamento', (await row('a1', 0).locator('[data-kind]').textContent()).trim() === 'R' && (await page.locator('#ex-a1 .ex-goal').count()) === 0);
  await row('a1', 0).locator('[data-field=kg]').fill('20');
  await row('a1', 0).locator('[data-field=reps]').fill('12');
  await row('a1', 0).locator('[data-check]').click();
  check('recupero: parte quello dell\'esercizio (2:00)', /^(2:00|1:5\d)$/.test((await page.textContent('#rest-time')).trim()), await page.textContent('#rest-time'));
  check('riscaldamento: nessun record anche se è la prima serie', (await page.locator('#ex-a1 .set-num.pr').count()) === 0);
  await page.click('#ex-a1 [data-goal]');
  check('"Usa" riempie la serie con l\'obiettivo', (await row('a1', 1).locator('[data-field=kg]').inputValue()) === '42,5' && (await row('a1', 1).locator('[data-field=reps]').inputValue()) === '8');
  await row('a1', 1).locator('[data-check]').click();
  await page.waitForSelector('#ex-a1 .set-num.pr');
  check('record in tempo reale: carico e massimale stimato', /record di carico e massimale stimato/.test(await row('a1', 1).locator('[data-kind]').getAttribute('aria-label')), await row('a1', 1).locator('[data-kind]').getAttribute('aria-label'));
  await saved();
  const live = (await api('/api/v1/today')).active_session;
  check('server: tipo della serie salvato', live.sets.find((s) => s.set_index === 1).kind === 'warmup' && live.sets.find((s) => s.set_index === 2).kind === 'normal');

  // 6. Solo per oggi: sostituisci, salta, aggiungi, cambia il recupero dal menu
  await page.click('[data-ex-menu=a2]');
  await page.click('#modal [data-m=swap]');
  await page.fill('#xp-name', 'Rear delt machine');
  await page.click('#modal [data-m=new]');
  await closed();
  const swapped = page.locator('.ex-card', { hasText: 'Rear delt machine' });
  check('sostituisci solo oggi: nuovo esercizio al posto del face pull', /al posto di Face pull al cavo, solo oggi/.test(await swapped.textContent()) && (await page.locator('#ex-a2').count()) === 0);
  await page.click('[data-ex-menu=a4]');
  await page.click('#modal [data-m=skip]');
  await closed();
  check('salta oggi: l\'esercizio esce dalla seduta e si può riprendere', (await page.locator('#ex-a4').count()) === 0 && (await page.locator('[data-unskip=a4]').count()) === 1);
  check('le serie previste seguono la seduta di oggi', /\/1[0-9] serie/.test(await page.textContent('.wk-meta')), await page.textContent('.wk-meta'));
  await page.click('[data-add-today]');
  await page.click('#modal [data-pick=b1]');
  await closed();
  check('aggiungi a questa seduta: esercizio di un\'altra giornata', /aggiunto oggi/.test(await page.textContent('#ex-b1')));
  await page.click('[data-ex-menu=a5]');
  await page.click('#modal [data-rest="180"]');
  await closed(); await saved();
  st = await state();
  check('la scheda non cambia per le scelte di oggi; il recupero scelto resta', st.routines.A.map((e) => e.id).join() === 'a1,a2,a3,a4,a5,a6,a7' && st.routines.A[4].rest === 180 && st.exerciseArchive.some((e) => e.name === 'Rear delt machine'));
  await swapped.locator('[data-field=kg]').first().fill('25');
  await swapped.locator('[data-field=reps]').first().fill('10');
  await swapped.locator('[data-check]').first().click();
  await page.screenshot({ path: `${SHOTS}/v113-4-seduta.png`, fullPage: true });

  // 7. Fine seduta: confronto per esercizio e record; lo storico ha il nome dell'esercizio di oggi
  await page.click('[data-finish]');
  await page.waitForSelector('.hero.finish');
  const sum = (await page.textContent('.hero.finish')).replace(/\s+/g, ' ');
  check('riepilogo: record con il tipo e confronto con l\'ultima volta', /Record: Lat machine \(carico, massimale stimato\)/.test(sum) && /42,5×8/.test(sum) && /ultima 40×10/.test(sum) && /prima volta/.test(sum), sum.slice(0, 400));
  check('riepilogo: il volume non conta il riscaldamento (340 + 250 kg)', /590/.test(sum), sum.slice(0, 160));
  await page.screenshot({ path: `${SHOTS}/v113-5-riepilogo.png`, fullPage: true });
  await page.click('[data-close-summary]');
  await page.click('.bottom-nav [data-view=progress]');
  await page.click('[data-tab=training]');
  const prog = (await page.textContent('#content')).replace(/\s+/g, ' ');
  check('progressi: serie per gruppo della settimana e storico con l\'esercizio usato solo oggi', /Serie per gruppo/.test(prog) && /Dorsali/.test(prog) && /Rear delt machine/.test(prog), prog.slice(0, 200));

  check('nessun attributo style nell\'HTML generato', (await page.locator('#content [style]:not([data-pct-w]):not([data-pct-h]):not([data-vars]):not(.chart-wrap *)').count()) === 0);
  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0]);
  await global.__page?.screenshot({ path: SHOTS + '/v113-error.png' }).catch(() => {});
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
