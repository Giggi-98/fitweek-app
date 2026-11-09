// Avvio, routing (hash) e delega degli eventi verso la vista attiva.
import { request } from "./api.js";
import { app, loadAll, refreshWorkouts } from "./store.js";
import { toast } from "./ui.js";
import { $, $$ } from "./util.js";
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
  dashboard: { title: "Oggi", mod: dashboard },
  training: { title: "Palestra", mod: training },
  meals: { title: "Pasti", mod: meals },
  shopping: { title: "Spesa & dispensa", mod: shopping },
  progress: { title: "Progressi", mod: progress },
  settings: { title: "Impostazioni", mod: settings },
};
const current = () => VIEWS[app.view].mod;

function render() {
  if (!app.state) return;
  const y = window.scrollY;
  $("#content").innerHTML = current().render();
  window.scrollTo({ top: y });
}
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
  const changed = next !== app.view;
  app.view = next;
  $("#page-title").textContent = VIEWS[next].title;
  document.title = `${VIEWS[next].title} · FitWeek`;
  $$("[data-view]").forEach((n) => {
    const on = n.dataset.view === next;
    n.classList.toggle("active", on);
    if (on) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  });
  if (changed) training.resetUi();
  render();
  if (changed) window.scrollTo({ top: 0 });
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
  } else {
    flush();
  }
  route();
}

// ---- eventi --------------------------------------------------------------------------------
window.addEventListener("hashchange", route);

document.addEventListener("click", async (e) => {
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
  const target = e.target.closest("button, [data-action]");
  if (!target || !app.state || !current().onClick) return;
  try {
    if (await current().onClick(target)) render();
  } catch (err) {
    toast("Errore: " + err.message);
  }
});

document.addEventListener("change", (e) => {
  if (app.state && current().onChange?.(e.target)) render();
});
document.addEventListener("input", (e) => {
  if (app.state) current().onInput?.(e.target);
});

document.addEventListener("submit", async (e) => {
  const form = e.target;
  e.preventDefault();
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
