# Sicurezza, Token e Accesso HTTP/HTTPS

Questo documento descrive il modello di sicurezza di FitWeek per l'uso quotidiano su rete locale (LAN), VPN e app Android autonoma.

---

## 1. Cosa viaggia sulla rete con `http://`

Nella configurazione predefinita il server ascolta su `http://192.168.222.200:8088` (solo rete locale, mai esposto su Internet — regola 8 di `CLAUDE.md`).

Quando accedi tramite un indirizzo `http://`:
- **Cosa è visibile sulla stessa rete Wi‑Fi/LAN**: chiunque sia già connesso alla stessa rete locale e intercetti i pacchetti può vedere in chiaro la password al momento del login, il cookie di sessione (webapp) o l'intestazione `Authorization: Bearer` (app Android), oltre ai dati di allenamento, pasti, spesa e peso in transito.
- **Sulla tua rete domestica**: il rischio è limitato ai dispositivi presenti sulla tua Wi‑Fi di casa.
- **Su reti Wi‑Fi esterne (bar, palestra, ufficio)**: non usare mai `http://` diretto; per questo motivo la schermata di accesso mostra un avviso esplicito quando l'indirizzo inizia con `http://`.

---

## 2. Perché serve la VPN fuori casa

- Il server di casa non deve mai essere esposto direttamente su Internet in HTTP (nessun port-forwarding della porta `8088` sul router).
- **In palestra o in 4G/5G**:
  1. L'app Android autonoma (`fitweek-next.apk`) funziona **offline**: dopo 2,5 secondi se il server non risponde compare il pulsante **"Lavora offline"**, che apre subito la copia locale e accoda serie, pasti, sonno e pesate sul telefono, inviandoli automaticamente al rientro sul Wi‑Fi di casa.
  2. Se vuoi sincronizzare in tempo reale anche fuori casa, attiva una **VPN verso casa** (Tailscale o WireGuard): il tunnel VPN cifra tutto il traffico tra il telefono e il server anche se l'URL interno è `http://`.

---

## 3. Opzioni per attivare HTTPS

### Opzione A — Tailscale (consigliata)
1. Installa Tailscale sul mini PC e sul telefono Android (stesso account).
2. Tutto il traffico passa sul tunnel WireGuard cifrato punto‑a‑punto, sia in casa sia fuori casa in 4G, senza aprire porte sul router.
3. Volendo anche un certificato HTTPS valido nel browser (`https://<nome>.<tailnet>.ts.net`), abilita MagicDNS + HTTPS Certificates nella console Tailscale ed esegui sul server:
   ```bash
   tailscale serve --bg 8088
   ```
   Poi imposta `COOKIE_SECURE=true` in `.env` e ricompila l'APK con il nuovo indirizzo `https://...`.

### Opzione B — Reverse proxy locale (Caddy) con CA locale
1. Avvia Caddy davanti a `127.0.0.1:8088` con `tls internal` per l'indirizzo `https://fitweek.lan` (o `https://192.168.222.200`).
2. Esporta il certificato radice (`root.crt`) generato da Caddy e installalo su Android (*Impostazioni → Sicurezza e privacy → Altre impostazioni di sicurezza → Installa da memoria dispositivo → Certificato CA*).
3. Imposta `COOKIE_SECURE=true` in `.env`.

---

## 4. Protezione dei token e delle sessioni

- **Webapp (browser)**: usa un cookie `HttpOnly`, `SameSite=Lax`. Il token non viene mai restituito nel corpo JSON del login web né letto da JavaScript.
- **App Android autonoma**:
  - Usa il plugin nativo Capacitor **`SecureToken`** (`SecureTokenPlugin.java`), che cifra il token con una chiave AES‑256‑GCM custodita nell'**Android Keystore** hardware del telefono (`fitweek_token_key`), salvando solo il testo cifrato e l'IV nelle `SharedPreferences` private dell'app.
  - All'avvio, un eventuale token salvato in passato in `localStorage` (`fitweek.token.v1`) viene migrato automaticamente nel Keystore e rimosso da `localStorage` **solo dopo che la scrittura nel Keystore è confermata**: se il Keystore fallisce il vecchio valore resta (altrimenti al riavvio si perderebbe la sessione) e la migrazione si ritenta all'avvio successivo. Un token nuovo (accesso o rinnovo) non viene mai scritto in chiaro: con il Keystore guasto vale solo finché l'app resta aperta.
- **Rinnovo scorrevole**:
  - Ogni sessione registra `last_seen_at` sul server: finché l'app viene usata almeno una volta entro `SESSION_MAX_AGE_S` (30 giorni), la sessione resta attiva senza interrompere l'utente.
  - Dopo 24 ore dall'emissione della firma, il server emette un token rinnovato (`X-Renewed-Token` per l'app, cookie aggiornato per il browser).
  - Le sessioni inattive da oltre 30 giorni vengono eliminate automaticamente.
- **Controllo dei dispositivi e uscita pulita**:
  - In *Impostazioni → Dati e accesso → Sessione* è visibile l'elenco dei dispositivi attivi con la data di ultima attività e il pulsante **Revoca** per invalidare un singolo dispositivo senza disconnettere gli altri.
  - Il pulsante **Esci** revoca la sessione sul server e cancella sul dispositivo il token nel Keystore, la copia locale delle risposte (`cache`), la coda e gli stati temporanei. Se sul dispositivo ci sono modifiche non ancora arrivate al server (coda, modifiche rifiutate, stato in attesa), prima si tenta un ultimo invio e poi l'uscita chiede conferma dicendo quante sono: senza conferma non si esce e nulla viene toccato; con la conferma vengono eliminate davvero e non ripartono al prossimo accesso (`static/js/logout.js`).
  - L'uscita non si dà per riuscita se non lo è (1.10.4, FW-REV-010). Server che non risponde: nella webapp l'uscita non avviene e viene detto (il cookie lo toglie solo il server); nell'app Android si può uscire dal solo dispositivo dopo un avviso esplicito che la sessione resta valida sul server finché non viene revocata da *Dati e accesso* o scade. Keystore che non conferma l'eliminazione (riletto dopo `clear`): l'utente viene avvisato, il token rimasto non viene più usato agli avvii successivi e l'eliminazione si ritenta a ogni avvio. Limite noto: in quel caso il token resta fisicamente nel Keystore finché questo non torna a funzionare, e il dispositivo, una volta uscito, non può più revocare da solo la propria sessione.

