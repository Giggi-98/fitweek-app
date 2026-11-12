// Test end-to-end dell'app autonoma (pagine fuori dal server, token, copia locale, coda e fusione).
// Le pagine sono servite da un'origine diversa da quella dell'API, come nell'APK. "Senza rete" = le sole
// chiamate verso il server falliscono. Esecuzione: scripts/e2e.sh (oppure E2E_ONLY=standalone scripts/e2e.sh)
const { chromium, devices } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:18088';
const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:18090';
const PW = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS || __dirname;
const out = [];
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

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
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });

  // 1. Accesso: indirizzo del server precompilato, avviso HTTP visibile, token nel Keystore (mai in localStorage)
  await page.goto(APP);
  await page.waitForSelector('#server-field:not(.hidden)');
  check('accesso: indirizzo del server precompilato', (await page.inputValue('#srv')) === B, await page.inputValue('#srv'));
  check('accesso: avviso HTTP quando l\'indirizzo è http://', await page.locator('#http-warning').isVisible());
  await page.fill('#srv', 'non un indirizzo');
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.locator('#login-error', { hasText: 'non valido' }).waitFor();
  check('accesso: indirizzo sbagliato rifiutato prima di chiamare la rete', true);
  await page.fill('#srv', B + '/');
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  const token = await page.evaluate(() => window.__keystore.token);
  const inLocalStorage = await page.evaluate(() => localStorage.getItem('fitweek.token.v1'));
  check('accesso: token nel Keystore Android, localStorage non contiene il token, nessun cookie', typeof token === 'string' && token.length > 20 && inLocalStorage === null && (await ctx.cookies()).length === 0);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: APP };
  const server = async (path, method = 'GET', data) => (await ctx.request.fetch(B + path, { method, headers, data })).json();

  // Niente popup dei promemoria durante il test
  for (const r of (await server('/api/v1/reminders')).items) await server(`/api/v1/reminders/${r.id}`, 'PUT', { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: false });
  await page.reload();
  await page.waitForSelector('.today-hero');
  check('dati caricati dal server da un\'altra origine', await page.locator('.tiles').isVisible());

  // 2. Prima serie con la rete
  await page.click('.bottom-nav [data-view=training]');
  await page.click('[data-pick-routine=A]');
  await page.click('[data-start]');
  const rows = page.locator('#ex-a1 .set-row');
  await rows.nth(0).locator('[data-field=kg]').fill('40');
  await rows.nth(0).locator('[data-field=reps]').fill('10');
  await rows.nth(0).locator('[data-check]').click();
  await page.waitForSelector('#sync[data-state=ok]');

  // 3. Senza rete: seconda serie e pesata restano sul telefono
  await page.route(`${B}/**`, (r) => r.abort());
  await page.locator('#ex-a1 .set-row').nth(1).locator('[data-check]').click();
  await page.locator('#sync', { hasText: 'Offline' }).waitFor();
  await page.click('.bottom-nav [data-view=dashboard]');
  await page.click('[data-weigh]');
  await page.fill('#m-weight', '88,7');
  await page.click('#modal [data-m=save]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  const offlineText = await page.textContent('#sync .sync-text');
  check('senza rete: indicatore con le modifiche in attesa', /Offline · dati delle \d\d:\d\d · \d da inviare/.test(offlineText), offlineText);

  // 4. Riavvio senza rete: l'app si apre con la copia locale e le modifiche fatte
  await page.reload();
  await page.waitForSelector('.today-hero');
  check('riavvio senza rete: l\'app si apre', /Offline/.test(await page.textContent('#sync .sync-text')));
  await page.locator('[data-weigh]', { hasText: '88,7' }).waitFor({ timeout: 5000 });
  check('riavvio senza rete: pesata presente', true);
  await page.click('.bottom-nav [data-view=training]');
  await page.waitForSelector('#ex-a1 .set-row.done');
  check('riavvio senza rete: seduta in corso con le due serie', (await page.locator('#ex-a1 .set-row.done').count()) === 2, String(await page.locator('#ex-a1 .set-row.done').count()));
  await page.screenshot({ path: `${SHOTS}/v19-1-offline.png` });

  // 5. Nel frattempo un altro dispositivo aggiunge un alimento in dispensa
  const remote = await server('/api/state');
  remote.data.inventory.push({ id: 'e2e-remote', name: 'Ceci', qty: '2 scatole', expiry: '' });
  await server('/api/state', 'PUT', { version: remote.version, data: remote.data });
  check('sul server la serie e la pesata offline non ci sono ancora', (await server('/api/v1/today')).active_session.sets.length === 1 && !(await server('/api/state')).data.weights.some((w) => w.weight === 88.7));

  // 6. Torna la rete: la coda parte e lo stato viene fuso senza perdere nulla
  await page.unroute(`${B}/**`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 15000 });
  const after = await server('/api/state');
  check('ritorno online: serie inviata', (await server('/api/v1/today')).active_session.sets.length === 2);
  check('ritorno online: pesata fusa con la modifica dell\'altro dispositivo', after.data.weights.some((w) => w.weight === 88.7) && after.data.inventory.some((x) => x.id === 'e2e-remote'), JSON.stringify(after.data.weights.slice(-1)));
  await page.click('.bottom-nav [data-view=shopping]');
  await page.click('[data-tab=pantry]');
  await page.locator('#content', { hasText: 'Ceci' }).waitFor({ timeout: 5000 });
  check('la modifica remota compare nell\'app', true);

  // 6b. Server muto (es. fuori casa in 4G: nessun errore, solo attesa): dopo pochi secondi si può scegliere
  //     di lavorare offline; quando il server torna, l'app se ne accorge da sola.
  await page.route(`${B}/**`, () => {}); // richieste lasciate senza risposta
  await page.reload();
  await page.waitForSelector('#work-offline', { state: 'visible', timeout: 5000 });
  check('server muto: compare "Lavora offline" entro pochi secondi', await page.locator('#shell').isHidden());
  await page.click('#work-offline');
  await page.waitForSelector('#shell:not(.hidden)', { timeout: 3000 });
  check('lavora offline: l\'app si apre subito con la copia locale', /Offline/.test(await page.textContent('#sync .sync-text')));
  await page.unroute(`${B}/**`);
  await page.waitForSelector('#sync[data-state=ok]', { timeout: 30000 });
  check('server di nuovo raggiungibile: l\'app torna online da sola', true);

  // 7. Uscita: il token viene revocato e rimosso, e la copia locale (cache) viene cancellata
  page.once('dialog', (d) => d.accept());
  await page.click('.bottom-nav [data-view=training]');
  await page.click('[data-cancel-session]');
  await page.waitForSelector('#sync[data-state=ok]');
  await page.click('.topbar [data-view=settings]');
  await page.click('[data-tab=data]');
  await page.click('[data-action=logout]');
  await page.waitForSelector('#server-field:not(.hidden)');
  const afterLogout = await page.evaluate(() => ({
    ks: window.__keystore.token,
    lsToken: localStorage.getItem('fitweek.token.v1'),
    cacheKeys: Object.keys(localStorage).filter((k) => k.startsWith('fitweek.cache.')),
  }));
  check('uscita: token rimosso dal Keystore, copia locale cancellata e sessione revocata', afterLogout.ks === null && afterLogout.lsToken === null && afterLogout.cacheKeys.length === 0 && (await ctx.request.fetch(B + '/api/state', { headers })).status() === 401);

  check('nessun errore JS', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(out.join('\n'));
})().catch(async (e) => {
  console.log(out.join('\n'));
  console.log('ERROR', e.message.split('\n')[0]);
  await global.__page?.screenshot({ path: SHOTS + '/v19-error.png' }).catch(() => {});
  console.log('HASH', await global.__page?.evaluate(() => location.hash + ' | ' + document.querySelector('#sync')?.innerText + ' | coda ' + localStorage.getItem('fitweek.workoutQueue.v1') + ' | stato in attesa ' + Boolean(localStorage.getItem('fitweek.statePending.v1')) + ' | ' + document.querySelector('#toast')?.innerText + ' | ' + document.querySelector('#login-error')?.innerText + ' | ' + document.querySelector('#content')?.innerText.slice(0, 200)).catch((x) => x.message));
  process.exit(1);
}).then(() => { if (out.some((l) => l.startsWith('FAIL'))) process.exit(1); });
