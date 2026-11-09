// Avvio, routing (hash) e delega degli eventi verso la vista attiva.
import { request } from "./api.js";
import { app, loadAll, refreshWorkouts } from "./store.js";
import { initModal, toast } from "./ui.js";
import { openReminder, startReminders } from "./reminders.js";
import { initNative } from "./native.js";
import { $, $$, fmtDate } from "./util.js";
import { icon } from "./icons.js";
import { enter, transition } from "./motion.js";
import * as dashboard from "./views/dashboard.js";
import * as meals from "./views/meals.js";
import * as progress from "./views/progress.js";
import * as settings from "./views/settings.js";
import * as shopping from "./views/shopping.js";
import * as training from "./views/training.js";
import { flush, pendingCount, startQueue } from "./workout/queue.js";
import { addRest, initRestTimer, stopRest } from "./workout/timer.js";

settings.applyTheme();

const VIEWS = {
  dashboard: { title: "Oggi", mod: dashboard, eyebrow: () => fmtDate(app.today?.date || "") },
  training: { title: "Palestra", mod: training, eyebrow: () => `Settimana ${app.today?.program_week ?? ""} di 8` },
  meals: { title: "Pasti", mod: meals },
  shopping: { title: "Spesa & dispensa", mod: shopping },
  progress: { title: "Progressi", mod: progress },
  settings: { title: "Impostazioni", mod: settings, eyebrow: () => "App, promemoria e dati" },
};
const current = () => VIEWS[app.view].mod;

function render() {
  if (!app.state) return;
  const y = window.scrollY;
  $("#content").innerHTML = current().render();
  hydrateIcons($("#content"));
  window.scrollTo({ top: y });
}

/** Sostituisce i segnaposto [data-icon] con le icone SVG (HTML statico e viste). */
function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, el.dataset.iconClass || "");
  });
}
hydrateIcons();
app.render = render;

function showLogin() {
  $("#boot")?.classList.add("hidden");
  $("#login").classList.remove("hidden");
  $("#shell").classList.add("hidden");
  $("#login input[name=password]")?.focus();
}
app.onUnauthorized = showLogin;

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

let started = false;
async function boot() {
  try {
    await loadAll();
  } catch (e) {
    if (e.status === 401) return showLogin();
    $("#boot").textContent = `Impossibile caricare i dati (${e.message}). Riprova tra poco.`;
    return;
  }
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
  const nav = e.target.closest("[data-view]");
  if (nav) {
    e.preventDefault();
    location.hash = nav.dataset.view;
    return;
  }
  if (e.target.closest("#rest-plus")) return addRest(15);
  if (e.target.closest("#rest-stop")) return stopRest();
  if (e.target.closest("#logout")) {
    await request("/api/logout", { method: "POST" }).catch(() => {});
    return location.reload();
  }
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
  if (app.state) current().onInput?.(e.target);
});

document.addEventListener("submit", async (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.closest("#modal")) return;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === "login-form") {
    try {
      await request("/api/login", { method: "POST", body: { password: data.password } });
      $("#login-error").textContent = "";
      form.reset();
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

// Tornando sull'app (es. dopo ore), aggiorna "oggi" e le sedute.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !app.state) return;
  await flush();
  if (pendingCount()) return; // dati locali più recenti del server: non sovrascrivere
  try {
    await refreshWorkouts();
    if (app.view !== "training") render();
  } catch {
    /* offline: resta con i dati locali */
  }
});

boot();
