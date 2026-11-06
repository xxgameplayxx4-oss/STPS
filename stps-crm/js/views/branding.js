// Karte «Darstellung»: Logo hochladen (PNG/JPG/SVG/WebP, höchstens 300 KB), Farbe der Seitenleiste, Anzeigename, Vorschau, Zurücksetzen.
// Team-Admins sehen sie in den Einstellungen (eigenes Team), der Superadmin dort (betretenes Team) und auf der Plattform bei jedem Team –
// Letzteres ändert nur, was die Mitglieder des Teams sehen (der Superadmin selbst sieht immer «KGC CRM»). Mitglieder sehen die Karte nur lesend.
// Das Prüfen (Typ, Grösse, SVG ohne aktive Inhalte, Farbe) macht der Server; hier nur eine schnelle Vorprüfung.
import * as store from "../store.js";
import * as api from "../api.js";
import * as brand from "../branding.js";
import { DEFAULT_BRAND, navLabel } from "../config.js";
import { html, fmtDateTime } from "../util.js";
import { t } from "../i18n.js";
import { icon, toast, confirmDialog } from "../ui.js";

const ACCEPT = ".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp";
const MAX_NAME = 40;

/** Zuletzt gesehener Stand je Team (so erscheint die Karte nach einem Neuzeichnen der Seite sofort, samt noch nicht gespeicherter Auswahl) */
const memo = new Map();

export const cardHtml = () => html`<section class="card" data-brand-card>
  <div class="card-head"><h2>${t("brand.title")}</h2></div>
  <div class="pad stack" data-brand-body><p class="muted">${t("common.loading")}</p></div>
</section>`;

function previewHtml(b) {
  return html`<div class="bp-grid" data-brand-preview>
    <figure class="bp bp-login" data-bp-theme><div class="bp-body"><div class="bp-card">
        <img class="auth-logo" src="${b.full}" alt="" data-fallback="full">${b.isDefault ? "" : html`<strong>${b.name}</strong>`}
      </div></div><figcaption>${t("brand.preview.login")}</figcaption></figure>
    <figure class="bp bp-dark" data-bp-theme><div class="bp-body"><div class="brand">
        <div class="brand-mark ${b.tile ? "tile" : ""}"><img src="${b.side}" alt="" width="36" height="36" data-fallback="side"></div>
        <div><strong>${b.name}</strong>${b.sub ? html`<span>${b.sub}</span>` : ""}</div>
      </div>
      <ul class="bp-nav"><li class="active">${navLabel("uebersicht")}</li><li>${navLabel("kunden")}</li></ul></div><figcaption>${t("brand.preview.sidebar")}</figcaption></figure>
  </div>`;
}

function readLogo(file, mime) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error(t("err.bad_logo.data")));
    r.onload = () => { const s = String(r.result); resolve(`data:${mime};base64,${s.slice(s.indexOf(",") + 1)}`); };
    r.readAsDataURL(file);
  });
}

/**
 * Karte befüllen und bedienen. root enthält cardHtml(). opts: { teamId, teamName, canEdit } – ohne teamId: eigenes bzw. betretenes Team
 * (store.getTeam()), mit teamId (Superadmin, Plattform): dieses Team. canEdit = false (Mitglieder): nur Anzeige.
 */
export function bind(root, { teamId = "", teamName = "", canEdit = true } = {}) {
  const card = root.querySelector("[data-brand-card]");
  const body = card?.querySelector("[data-brand-body]");
  if (!body) return;
  const key = teamId || `own:${store.getTeam()?.id || ""}`;
  const st = memo.get(key) || { team: teamId ? { id: teamId, name: teamName } : store.getTeam(), loaded: false, saved: null, pending: null, name: null, color: null, error: "" };
  memo.set(key, st);
  let busy = false;

  const savedName = () => st.saved?.displayName ?? "";
  const nameValue = () => (st.name ?? savedName());
  const savedColor = () => st.saved?.color ?? "";
  /** Farbe im Eingabefeld: "" = Standard, sonst Text des Benutzers (kann ungültig sein) */
  const colorValue = () => (st.color ?? savedColor());
  const colorParsed = () => (colorValue().trim() === "" ? "" : brand.parseColor(colorValue()));
  const colorInvalid = () => colorParsed() === null;
  const dirty = () => Boolean(st.pending) || nameValue().trim() !== savedName() || (!colorInvalid() && colorParsed() !== savedColor());
  const canSave = () => !busy && dirty() && !colorInvalid();
  const previewBrand = () => {
    const base = st.pending ? { ...st.saved, logo: st.pending.logo, symbol: null, side: null, icon: null, width: null, height: null } : st.saved || {};
    return brand.resolve(st.team, { ...base, displayName: nameValue(), color: colorInvalid() ? savedColor() : colorParsed() });
  };

  function colorInfo() {
    const c = colorInvalid() ? savedColor() : colorParsed();
    const th = brand.theme(c || DEFAULT_BRAND.color);
    return t("brand.color.contrast", { text: th.fg === "#ffffff" ? t("brand.color.light") : t("brand.color.dark"), ratio: th.ratio.toFixed(1) });
  }

  function repaintPreview() {
    const host = body.querySelector("[data-brand-preview]");
    if (!host) return;
    const b = previewBrand();
    host.outerHTML = previewHtml(b).toString();
    for (const fig of body.querySelectorAll("[data-bp-theme]")) brand.applyTheme(fig, b.theme || brand.DEFAULT_THEME); // Standard ausdrücklich setzen: sonst erbt die Vorschau die Farbe der Seite
    for (const img of body.querySelectorAll("[data-fallback]")) {
      const tile = img.closest(".brand-mark");
      brand.withFallback(img, img.dataset.fallback === "full" ? DEFAULT_BRAND.full : DEFAULT_BRAND.side, () => tile?.classList.remove("tile"));
    }
    const save = body.querySelector('[data-brand="save"]');
    if (save) save.disabled = !canSave();
    const info = body.querySelector("[data-brand-contrast]");
    if (info) info.textContent = colorInfo();
    const hex = body.querySelector('[data-brand="hex"]');
    if (hex) hex.setAttribute("aria-invalid", colorInvalid() ? "true" : "false");
    const err = body.querySelector("[data-brand-color-error]");
    if (err) err.textContent = colorInvalid() ? t("brand.color.invalid") : "";
    const picker = body.querySelector('[data-brand="color"]');
    if (picker && !colorInvalid()) picker.value = colorParsed() || DEFAULT_BRAND.color;
    const reset = body.querySelector('[data-brand="color-reset"]');
    if (reset) reset.disabled = colorValue().trim() === "";
  }

  function paint() {
    const s = st.saved;
    const state = st.pending ? t("brand.chosen", { name: st.pending.name })
      : !s ? t("brand.current.default")
      : !s.preset && s.updatedAt ? t("brand.updated", { at: fmtDateTime(s.updatedAt), by: s.updatedBy || "–" })
      : "";
    const edit = canEdit ? html`
      <div class="field"><label for="brand-name">${t("brand.name")}</label>
        <input type="text" id="brand-name" data-brand="name" maxlength="${MAX_NAME}" autocomplete="off" placeholder="${st.team?.name || ""}" value="${nameValue()}">
        <div class="help">${t("brand.name.help")}</div></div>
      <div class="field"><label for="brand-hex">${t("brand.color")}</label>
        <div class="color-row">
          <input type="color" data-brand="color" aria-label="${t("brand.color.pick")}" value="${colorParsed() || DEFAULT_BRAND.color}">
          <input type="text" id="brand-hex" data-brand="hex" maxlength="7" autocomplete="off" spellcheck="false" placeholder="${DEFAULT_BRAND.color}" value="${colorValue()}" aria-invalid="false">
          <button type="button" class="btn" data-brand="color-reset">${t("brand.color.reset")}</button>
        </div>
        <div class="help">${t("brand.color.help")} <span data-brand-contrast></span></div>
        <div class="err" role="alert" data-brand-color-error></div></div>
      <div class="btn-row wrap">
        <label class="btn">${icon("upload")} ${t("brand.choose")}<input type="file" accept="${ACCEPT}" data-brand="file" class="sr"></label>
        <button type="button" class="btn btn-primary" data-brand="save" ${canSave() ? "" : "disabled"}>${t("common.save")}</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-danger-ghost" data-brand="reset" ${busy || !s ? "disabled" : ""}>${t("brand.reset")}</button>
      </div>
      <p class="help">${t("brand.formats", { kb: Math.round(brand.MAX_LOGO_BYTES / 1024) })}</p>` : html`<p class="help">${t("brand.readonly")}</p>`;
    body.innerHTML = html`
      <p class="help">${t("brand.help")}</p>
      <div data-brand-preview></div>
      <p class="help" data-brand-state>${state}</p>
      ${edit}
      <div class="err" role="alert" data-brand-error>${st.error}</div>`.toString();
    repaintPreview();
  }

  const fail = (e) => {
    if (store.handleAuthError(e)) return;
    st.error = e.message || t("toast.actionFailed");
    paint();
  };

  /**
   * Ist dies das eigene Team (Plattform: das Team der Karte ist das aktive)? Dann folgen Seitenleiste, Titel und Symbol – ausser beim Superadmin:
   * Er sieht immer «KGC CRM»; was er einstellt, sehen nur die Mitglieder des Teams.
   */
  const adopt = (view) => {
    st.saved = view;
    st.pending = null;
    st.name = null;
    st.color = null;
    st.error = "";
    if (!store.isSuper() && store.getTeam() && (!teamId || store.getTeam().id === teamId)) brand.setActive(store.getTeam(), view, { isSuper: false });
  };

  async function load() {
    try {
      const r = await api.branding(teamId || undefined);
      st.team = r.team || st.team;
      st.saved = r.branding;
      st.loaded = true;
      st.error = "";
    } catch (e) {
      if (store.handleAuthError(e)) return;
      if (!st.loaded) st.error = t("brand.loadFailed", { err: e.message });
    }
    if (body.isConnected) paint();
  }

  async function save() {
    const patch = {};
    if (st.pending) patch.logo = st.pending.logo;
    if (nameValue().trim() !== savedName()) patch.displayName = nameValue().trim();
    if (!colorInvalid() && colorParsed() !== savedColor()) patch.color = colorParsed();
    if (!Object.keys(patch).length) { toast(t("brand.nothingToSave")); return; }
    busy = true;
    st.error = "";
    paint();
    try {
      adopt((await api.setBranding(teamId || undefined, patch)).branding);
      toast(t("brand.toast.saved"), { type: "ok" });
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
      if (body.isConnected) paint();
    }
  }

  async function reset() {
    const ok = await confirmDialog({ title: t("brand.reset.title"), message: html`<p>${t("brand.reset.msg")}</p>`, confirmLabel: t("brand.reset"), danger: true });
    if (!ok) return;
    busy = true;
    paint();
    try {
      await api.resetBranding(teamId || undefined);
      adopt(null);
      toast(t("brand.toast.reset"), { type: "ok" });
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
      if (body.isConnected) paint();
    }
  }

  async function choose(file) {
    const mime = brand.logoMime(file);
    st.error = "";
    if (!mime) st.error = t("err.bad_logo.type");
    else if (file.size > brand.MAX_LOGO_BYTES) st.error = t("err.bad_logo.size");
    else {
      try { st.pending = { logo: await readLogo(file, mime), name: file.name }; } catch (e) { st.error = e.message; }
    }
    if (body.isConnected) paint();
  }

  body.addEventListener("change", (e) => {
    if (e.target.dataset?.brand === "file" && e.target.files?.[0]) { const f = e.target.files[0]; e.target.value = ""; choose(f); }
  });
  body.addEventListener("input", (e) => {
    const k = e.target.dataset?.brand;
    if (k === "name") st.name = e.target.value;
    else if (k === "hex") st.color = e.target.value;
    else if (k === "color") { st.color = e.target.value; const hex = body.querySelector('[data-brand="hex"]'); if (hex) hex.value = e.target.value; }
    else return;
    repaintPreview();
  });
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-brand]");
    if (!b || b.disabled) return;
    if (b.dataset.brand === "save") save();
    if (b.dataset.brand === "reset") reset();
    if (b.dataset.brand === "color-reset") { st.color = ""; const hex = body.querySelector('[data-brand="hex"]'); if (hex) hex.value = ""; repaintPreview(); }
  });

  paint();
  load();
}
