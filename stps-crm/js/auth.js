// Anmeldung (Benutzername + Passwort), Pflicht-Passwortwechsel, Fehlerbildschirm.
// Im Lokalen Modus (keine API) gibt es keine Konten: dort bleibt die Auswahl «Ich bin».
// Jeder Bildschirm zeichnet sich bei einem Sprachwechsel neu und behält dabei Eingaben und Fehlermeldung.
import * as store from "./store.js";
import { LS, DEFAULT_BRAND } from "./config.js";
import { html, th } from "./util.js";
import { t, onLangChange } from "./i18n.js";
import * as brand from "./branding.js";

const host = () => document.getElementById("auth");

const msgOf = (m) => (typeof m === "function" ? m() : m || "");

function who(names, current) {
  return html`<fieldset class="who"><legend>${t("auth.iAm")}</legend>
    ${names.map((n) => html`<label class="chip"><input type="radio" name="who" value="${n}" ${n === current ? "checked" : ""}><span>${n}</span></label>`)}
  </fieldset>`;
}

/** Logo, Name und Farbe (Hintergrund): Darstellung des zuletzt angemeldeten Teams auf diesem Gerät, sonst das SwissTech-Logo (dessen Wortmarke nennt den Namen schon) */
function shell(inner) {
  const el = host();
  el.hidden = false;
  const b = brand.loginView();
  brand.applyLoginChrome(b);
  el.innerHTML = html`<div class="auth-card">
    <img src="${b.full}" alt="" class="auth-logo">
    <h1 class="${b.isDefault ? "sr" : ""}">${b.name}</h1>
    ${inner}
  </div>`.toString();
  brand.withFallback(el.querySelector(".auth-logo"), DEFAULT_BRAND.full);
  return el;
}

let redrawCurrent = null;
onLangChange(() => redrawCurrent?.());

const close = () => { const el = host(); el.hidden = true; el.innerHTML = ""; redrawCurrent = null; brand.applyDom(); };
const lastUser = () => { try { return localStorage.getItem(LS.lastUser) || ""; } catch { return ""; } };

/** Eingaben (name → Wert) und Fokus einer Form lesen / wieder setzen, damit ein Sprachwechsel nichts verliert */
function snapshot(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name || el.type === "submit" || el.type === "button") continue;
    if (el.type === "radio") { if (el.checked) values[el.name] = el.value; } else values[el.name] = el.value;
  }
  const a = document.activeElement;
  return { values, focus: a && form.contains(a) ? { name: a.name, start: a.selectionStart, end: a.selectionEnd } : null };
}
function restore(form, snap) {
  if (!snap) return;
  for (const el of form.elements) {
    if (!el.name || !(el.name in snap.values)) continue;
    if (el.type === "radio") el.checked = el.value === snap.values[el.name];
    else el.value = snap.values[el.name] ?? "";
  }
  const f = snap.focus?.name ? form.elements[snap.focus.name] : null;
  if (f?.focus) {
    f.focus();
    try { if (snap.focus.start != null) f.setSelectionRange(snap.focus.start, snap.focus.end); } catch { /* Radio/Passwort */ }
  }
}

/**
 * Anmeldung. Löst auf, sobald angemeldet: {state:'ready'} oder {state:'change-password'} (Einmalpasswort).
 * message: Text oder Funktion, die den Text liefert (so folgt er der Sprache).
 * @returns {Promise<{state:string, message?:string}>}
 */
export function showLogin(message = "") {
  return new Promise((resolve) => {
    let errFn = () => msgOf(message);
    let snap = { values: { user: lastUser() }, focus: null };
    let first = true;

    function draw() {
      const prefill = snap.values.user || "";
      const el = shell(html`<form novalidate>
        <label class="field"><span class="label">${t("auth.username")}</span><input type="text" name="user" autocomplete="username" autocapitalize="none" spellcheck="false" value="${prefill}" required ${first && !prefill ? "autofocus" : ""}></label>
        <label class="field"><span class="label">${t("auth.password")}</span><input type="password" name="pw" autocomplete="current-password" required ${first && prefill ? "autofocus" : ""}></label>
        <div class="err" role="alert"></div>
        <button type="submit" class="btn btn-primary btn-block">${t("auth.signIn")}</button>
      </form>`);
      const form = el.querySelector("form");
      const err = form.querySelector(".err");
      err.textContent = errFn();
      restore(form, snap);
      first = false;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errFn = () => "";
        err.textContent = "";
        const user = form.user.value.trim();
        const pw = form.pw.value;
        if (!user || !pw) { errFn = () => t("auth.enterBoth"); err.textContent = errFn(); return; }
        const btn = form.querySelector("button");
        btn.disabled = true;
        try {
          const res = await store.loginWith(user, pw);
          if (res.state === "ready" || res.state === "change-password") { close(); resolve(res); return; }
          errFn = () => res.message || t("auth.loginFailed");
        } catch (ex) {
          errFn = () => ex.message || t("auth.loginFailed");
        }
        err.textContent = errFn();
        btn.disabled = false;
        form.pw.value = "";
        form.pw.focus();
      });
    }

    redrawCurrent = () => {
      const form = host().querySelector("form");
      if (form) snap = snapshot(form);
      draw();
    };
    draw();
  });
}

/**
 * Pflicht-Passwortwechsel nach Erst-Anmeldung bzw. Zurücksetzen durch einen Admin.
 * @returns {Promise<{state:string, message?:string}>} Ergebnis des anschliessenden Ladens der Daten
 */
export function showChangePassword() {
  return new Promise((resolve) => {
    let errFn = () => "";
    let snap = null;
    let first = true;

    function draw() {
      const me = store.getMe();
      const el = shell(html`<form novalidate>
        <p>${t("auth.pwHello", { name: me?.displayName || "" })}</p>
        <label class="field"><span class="label">${t("auth.pwCurrent")}</span><input type="password" name="cur" autocomplete="current-password" required ${first ? "autofocus" : ""}></label>
        <label class="field"><span class="label">${t("auth.pwNew")}</span><input type="password" name="new" autocomplete="new-password" minlength="10" required></label>
        <label class="field"><span class="label">${t("auth.pwRepeat")}</span><input type="password" name="rep" autocomplete="new-password" required></label>
        <div class="err" role="alert"></div>
        <button type="submit" class="btn btn-primary btn-block">${t("auth.pwSave")}</button>
        <button type="button" class="btn btn-ghost btn-block" data-logout>${t("auth.logout")}</button>
      </form>`);
      const form = el.querySelector("form");
      const err = form.querySelector(".err");
      err.textContent = errFn();
      restore(form, snap);
      first = false;
      form.querySelector("[data-logout]").addEventListener("click", () => { store.logout(); location.reload(); });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errFn = () => "";
        err.textContent = "";
        const cur = form.cur.value, next = form.new.value, rep = form.rep.value;
        const show = (fn) => { errFn = fn; err.textContent = fn(); };
        if (!cur || !next) return show(() => t("auth.fillAll"));
        if (next.length < 10) return show(() => t("auth.pwTooShort"));
        if (next !== rep) return show(() => t("auth.pwMismatch"));
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await store.changePassword(cur, next);
          const res = await store.continueAfterPasswordChange();
          if (res.state === "ready" || res.state === "login") { close(); resolve(res); return; }
          show(() => res.message || t("auth.loadFailed"));
        } catch (ex) {
          show(() => ex.message || t("auth.pwChangeFailed"));
        }
        btn.disabled = false;
      });
    }

    redrawCurrent = () => {
      const form = host().querySelector("form");
      if (form) snap = snapshot(form);
      draw();
    };
    draw();
  });
}

/** «Ich bin»-Auswahl (nur Lokaler Modus, wenn der gespeicherte Name nicht mehr in der Liste ist) */
export function chooseUser() {
  return new Promise((resolve) => {
    let errFn = () => "";
    let snap = null;

    function draw() {
      const names = store.ownerNames();
      const el = shell(html`<form novalidate>
        <p>${t("auth.whoWorks")}</p>
        ${who(names, "")}
        <div class="err" role="alert"></div>
        <button type="submit" class="btn btn-primary btn-block">${t("auth.next")}</button>
      </form>`);
      const form = el.querySelector("form");
      form.querySelector(".err").textContent = errFn();
      restore(form, snap);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const me = form.querySelector('input[name="who"]:checked')?.value;
        if (!me) { errFn = () => t("auth.pickPerson"); form.querySelector(".err").textContent = errFn(); return; }
        store.setUser(me);
        close();
        resolve(me);
      });
    }

    redrawCurrent = () => {
      const form = host().querySelector("form");
      if (form) snap = snapshot(form);
      draw();
    };
    draw();
  });
}

/**
 * Fehlerbildschirm. message: Text oder Funktion, die den Text liefert.
 * onLogout (optional): zeigt neben «Erneut versuchen» ein «Abmelden» (Token verwerfen → Anmeldeseite), damit eine hängende Sitzung nie in der Sackgasse endet.
 */
export function showFatal(message, onRetry, onLogout) {
  function draw() {
    const text = msgOf(message);
    const hint = /CRM_SECRET|CRM_PASSWORD/.test(text)
      ? html`<p class="muted">${th("auth.fatalHint")}</p>`
      : "";
    const logout = onLogout ? html`<button type="button" class="btn btn-ghost btn-block" data-logout>${t("auth.logout")}</button>` : "";
    const el = shell(html`<p class="err big" role="alert">${text}</p>${hint}<button type="button" class="btn btn-primary btn-block" data-retry>${t("auth.retry")}</button>${logout}`);
    el.querySelector("[data-retry]").addEventListener("click", onRetry);
    el.querySelector("[data-logout]")?.addEventListener("click", onLogout);
  }
  redrawCurrent = draw;
  draw();
}
