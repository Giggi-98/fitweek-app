// Avvio, routing (hash) e delega degli eventi verso la vista attiva.
import { net, probeServer, request, workOffline } from "./api.js";
import * as cache from "./cache.js";
import { initToken, isHttpUrl, serverUrl, setServerUrl, setToken, standalone, token, validServerUrl } from "./platform.js";
import { app, loadAll, refreshDaily, refreshState, refreshWorkouts, syncState } from "./store.js";
import { applyDynamicStyles, initModal, toast } from "./ui.js";
import { mountCharts } from "./chart.js";
import { openReminder, startReminders } from "./reminders.js";
import { initNative } from "./native.js";
import { $, $$, fmtDate, normalizeTime } from "./util.js";
import { icon } from "./icons.js";
import { enter, transition } from "./motion.js";
import * as dashboard from "./views/dashboard.js";
import * as meals from "./views/meals.js";
import * as progress from "./views/progress.js";
import * as settings from "./views/settings.js";
import * as shopping from "./views/shopping.js";
import * as training from "./views/training.js";
import { flush, pendingCount, startQueue } from "./workout/queue.js";
import { signOut } from "./logout.js";
import { addRest, initRestTimer, stopRest } from "./workout/timer.js";

settings.applyTheme();

const VIEWS = {
  dashboard: { title: "Oggi", mod: dashboard, eyebrow: () => fmtDate(app.today?.date || "") },
  training: { title: "Palestra", mod: training, eyebrow: () => `Settimana ${app.today?.program_week ?? ""} di 8` },
  meals: { title: "Pasti", mod: meals, eyebrow: () => "Diario e pasti abituali" },
  shopping: { title: "Spesa e dispensa", mod: shopping, eyebrow: () => "Consegna il lunedì" },
  progress: { title: "Progressi", mod: progress, eyebrow: () => "Registrati e calcolati, sempre distinti" },
  settings: { title: "Impostazioni", mod: settings, eyebrow: () => "App, promemoria e dati" },
};
const current = () => VIEWS[app.view].mod;

function render() {
  if (!app.state) return;
  const y = window.scrollY;
  $("#content").innerHTML = current().render();
  hydrateIcons($("#content"));
  applyDynamicStyles($("#content"));
  mountCharts($("#content"));
  window.scrollTo({ top: y });
  current().afterRender?.();
}

/** Sostituisce i segnaposto [data-icon] con le icone SVG (HTML statico e viste). */
function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, el.dataset.iconClass || "");
  });
}
hydrateIcons();
app.render = render;

function updateHttpWarning() {
  const url = standalone ? ($("#srv")?.value || serverUrl()) : location.origin;
  $("#http-warning")?.classList.toggle("hidden", !isHttpUrl(url));
}

function showLogin(message = "") {
  $("#boot")?.classList.add("hidden");
  $("#login").classList.remove("hidden");
  $("#shell").classList.add("hidden");
  if (standalone) {
    $("#server-field").classList.remove("hidden");
    if (!$("#srv").value) $("#srv").value = serverUrl();
  }
  updateHttpWarning();
  $("#login-error").textContent = message;
  $("#login input[name=password]")?.focus();
}
app.onUnauthorized = () => {
  setToken(null); // nell'app autonoma il token non è più valido: si rifà l'accesso
  showLogin();
};

function route() {
  const name = location.hash.replace("#", "") || "dashboard";
  const next = VIEWS[name] ? name : "dashboard";
  const changed = next !== app.view || !$("#content").innerHTML;
  const apply = () => {
    app.view = next;
    $("#page-title").textContent = VIEWS[next].title;
    $("#page-eyebrow").textContent = VIEWS[next].eyebrow?.() || "";
    document.title = `${VIEWS[next].title} · FitWeek`;
    $$("[data-view]").forEach((n) => {
      const on = n.dataset.view === next;
      n.classList.toggle("active", on);
      if (on) n.setAttribute("aria-current", "page");
      else n.removeAttribute("aria-current");
    });
    if (changed) training.resetUi();
    render();
    if (changed) {
      window.scrollTo({ top: 0, behavior: "instant" });
      enter($("#content"));
    }
  };
  if (changed && app.state) transition(apply);
  else apply();
}

const OFFLINE_OFFER_MS = 2500;
let started = false;
async function boot() {
  await initToken();
  if (standalone && !token()) return showLogin();
  // App autonoma con una copia locale: se il server tarda, si propone di lavorare offline invece di aspettare.
  const offer = standalone && cache.get("/api/state")
    ? setTimeout(() => $("#boot-offline")?.classList.remove("hidden"), OFFLINE_OFFER_MS)
    : null;
  try {
    await loadAll();
  } catch (e) {
    clearTimeout(offer);
    if (e.status === 401) return app.onUnauthorized();
    // App autonoma senza rete e senza una copia locale (primo avvio): si torna all'accesso, dove si può
    // anche correggere l'indirizzo del server.
    if (standalone) return showLogin(`Server non raggiungibile (${e.message}). Controlla la rete o l'indirizzo.`);
    $("#boot").textContent = `Impossibile caricare i dati (${e.message}). Riprova tra poco.`;
    return;
  }
  clearTimeout(offer);
  $("#boot-offline")?.classList.add("hidden");
  $("#login").classList.add("hidden");
  $("#boot")?.classList.add("hidden");
  $("#shell").classList.remove("hidden");
  if (!started) {
    started = true;
    startQueue();
    initRestTimer();
    initModal();
    startReminders();
    initNative({
      openReminderById: (id) => {
        const item = app.agenda.find((i) => i.id === id);
        if (!item) return;
        if (item.action === "start_workout") location.hash = "#training";
        else openReminder(item);
      },
    });
  } else {
    flush();
  }
  route();
}

// ---- eventi --------------------------------------------------------------------------------
window.addEventListener("hashchange", route);

document.addEventListener("click", async (e) => {
  if (e.target.closest("#modal")) return; // gestiti dalla modale stessa
  if (e.target.closest("#work-offline")) return workOffline();
  const nav = e.target.closest("[data-view]");
  if (nav) {
    e.preventDefault();
    location.hash = nav.dataset.view;
    return;
  }
  if (e.target.closest("#rest-plus")) return addRest(15);
  if (e.target.closest("#rest-stop")) return stopRest();
  if (e.target.closest("#logout")) return signOut();
  const target = e.target.closest("button, [data-action], [role=button]");
  if (!target || !app.state || !current().onClick) return;
  try {
    if (await current().onClick(target)) render();
  } catch (err) {
    toast("Errore: " + err.message);
  }
});

// Elementi cliccabili non-button (es. voci del diario): Invio/Spazio come un click.
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[role=button]:not(button)")) {
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.closest("#modal") || !app.state) return;
  if (await current().onChange?.(e.target)) render();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "srv") updateHttpWarning();
  if (e.target.classList?.contains("time24")) {
    const v = normalizeTime(e.target.value);
    if (v !== e.target.value) e.target.value = v;
  }
  if (app.state) current().onInput?.(e.target);
});

document.addEventListener("submit", async (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.closest("#modal")) return;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === "login-form") {
    try {
      if (standalone) {
        if (!validServerUrl(data.server)) throw new Error("Indirizzo del server non valido (es. http://192.168.222.200:8088)");
        setServerUrl(data.server);
      }
      const out = await request("/api/login", { method: "POST", body: { password: data.password, ...(standalone ? { client: "app" } : {}) } });
      if (standalone) await setToken(out.token);
      $("#login-error").textContent = "";
      $("#pw").value = "";
      await boot();
    } catch (err) {
      $("#login-error").textContent = err.message;
    }
    return;
  }
  try {
    if (await current().onSubmit?.(form, data)) render();
  } catch (err) {
    toast("Errore: " + err.message);
  }
});

// Tornando sull'app (es. dopo ore) o quando il server torna raggiungibile, invia ciò che è in attesa e
// aggiorna "oggi" e le sedute.
async function resync() {
  if (!app.state) return;
  await flush();
  await syncState();
  if (pendingCount()) return; // dati locali più recenti del server: non sovrascrivere
  try {
    await Promise.all([refreshWorkouts(), refreshDaily(), refreshState()]);
    $("#page-eyebrow").textContent = VIEWS[app.view].eyebrow?.() || ""; // il giorno può essere cambiato
    if (app.view !== "training") render();
  } catch {
    /* offline: resta con i dati locali */
  }
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && resync());
net.onBack = resync;

// Al ritorno della rete partono anche le modifiche allo stato rimaste sul telefono.
window.addEventListener("online", () => syncState());
setInterval(() => {
  if (!app.state) return;
  syncState();
  probeServer();
}, 20_000);

boot();
