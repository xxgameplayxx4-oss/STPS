// Einstellungen: Benutzer, Darstellung (Admins ändern, Mitglieder sehen), Datensicherung (JSON/CSV), SharePoint (nur Superadmin) & Excel, Server-Backups, Listen, Beispieldaten
import * as store from "../store.js";
import * as api from "../api.js";
import { html, th, fmtDateTime, todayISO, fmtDate } from "../util.js";
import { icon, toast, confirmDialog } from "../ui.js";
import { DEFAULT_LISTS, APP, COLLECTIONS } from "../config.js";
import { t, tv } from "../i18n.js";
import { CSV_TABLES, exportCsv, downloadFile } from "../csv.js";
import { loadSampleData } from "../seed.js";
import * as sharepoint from "./sharepoint.js";
import * as outlook from "./outlook.js";
import * as usersView from "./users.js";
import * as brandingView from "./branding.js";
import * as billingView from "./settings-billing.js";
import * as fxView from "./settings-fx.js";
import * as catsView from "./settings-cats.js";
import * as push from "../push.js";

const summary = (counts) => COLLECTIONS.filter((c) => counts[c]).map((c) => `${t("set.label." + c)}: ${counts[c]}`).join(", ") || t("set.empty");

function listEditor(name) {
  const items = store.getList(name);
  const isOwners = name === "owners";
  return html`<form class="list-ed card-inner" data-list="${name}" novalidate>
    <h3>${t(`list.${name}.label`)}</h3><p class="help">${t(`list.${name}.hint`)}</p>
    <div class="le-rows">${items.map((it) => listRow(isOwners, it))}</div>
    <div class="le-actions">
      <button type="button" class="btn btn-sm" data-le="add">${icon("plus")} ${t("set.entry")}</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm btn-ghost" data-le="reset">${t("set.resetDefault")}</button>
      <button type="submit" class="btn btn-sm btn-primary">${t("common.save")}</button>
    </div>
    <div class="err" role="alert"></div>
  </form>`;
}

function listRow(isOwners, it) {
  return html`<div class="le-row">
    <input type="text" data-v="name" value="${isOwners ? it.name : it}" aria-label="${t("set.name")}" placeholder="${t("set.name")}">
    ${isOwners ? html`<input type="text" data-v="role" value="${it.role || ""}" aria-label="${t("set.role")}" placeholder="${t("set.role")}">` : ""}
    <button type="button" class="icon-btn" data-le="del" aria-label="${t("set.removeEntry")}" title="${t("common.remove")}">${icon("trash")}</button>
  </div>`;
}

export function render(root) {
  const S = store.S;
  const counts = store.counts();
  const empty = COLLECTIONS.every((c) => !counts[c]);
  const server = S.mode === "server";
  const modeText = server ? t(S.backend === "mysql" ? "set.modeServerMysql" : "set.modeServer") : S.mode === "offline" ? t("set.modeOffline") : t("set.modeLocal");
  const spAdmin = server && store.isSuper(); // SharePoint-Einrichtung/-Diagnose: nur Superadmin (auch im betretenen Team)

  root.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.einstellungen")}</h1><p class="intro">${t("set.intro")}</p></div></div>

    <div class="settings-grid">
      <section class="card">
        <div class="card-head"><h2>${t("set.userConnection")}</h2></div>
        <div class="pad">
          ${usersView.identityHtml()}
          <dl class="dl">
            <div><dt>${t("set.mode")}</dt><dd>${modeText}</dd></div>
            ${server ? html`<div><dt>${t("set.dataVersion")}</dt><dd>${S.version}${S.savedAt ? html` · ${t("set.lastSaved", { at: fmtDateTime(S.savedAt) })}${S.savedBy ? " " + t("det.by", { name: S.savedBy }) : ""}` : ""}</dd></div>` : ""}
            <div><dt>${t("set.content")}</dt><dd>${summary(counts)}</dd></div>
            <div><dt>${t("set.version")}</dt><dd>${APP.name} ${APP.version}</dd></div>
          </dl>
          ${server ? html`<div class="btn-row wrap"><button type="button" class="btn" data-account="password">${icon("key")} ${t("acct.changePassword")}</button><button type="button" class="btn" data-set="logout">${icon("logout")} ${t("acct.logout")}</button></div>` : ""}
        </div>
      </section>
      ${usersView.settingsCard()}
      ${push.settingsCard()}
      ${server && store.getTeam() ? brandingView.cardHtml() : ""}
      ${billingView.cardsHtml()}
      ${fxView.cardHtml()}
      ${catsView.cardHtml()}

      <section class="card">
        <div class="card-head"><h2>${t("set.backup")}</h2></div>
        <div class="pad stack">
          <div><h3>${t("set.jsonTitle")}</h3>
            <p class="help">${t("set.jsonHelp")}</p>
            <div class="btn-row wrap">
              <button type="button" class="btn btn-primary" data-set="export-json">${icon("download")} ${t("set.jsonExport")}</button>
              <label class="btn">${icon("upload")} ${t("set.jsonImport")}<input type="file" accept=".json,application/json" data-set="import-json" class="sr"></label>
            </div></div>
          <div><h3>${t("set.csvTitle")}</h3>
            <p class="help">${t("set.csvHelp")}</p>
            <div class="btn-row wrap">${CSV_TABLES.map((tbl) => html`<button type="button" class="btn btn-sm" data-csv="${tbl.id}">${icon("download")} ${t("csv." + tbl.id)}</button>`)}</div></div>
        </div>
      </section>

      ${outlook.cardHtml({ server })}

      ${sharepoint.cardsHtml({ server, admin: spAdmin })}

      ${server ? html`<section class="card">
        <div class="card-head"><h2>${t("set.serverBackups")}</h2></div>
        <div class="pad"><p class="help">${t("set.backupsHelp")}</p><div data-backups><p class="muted">${t("common.loading")}</p></div></div>
      </section>` : ""}

      <section class="card span-all">
        <div class="card-head"><h2>${t("set.lists")}</h2></div>
        <div class="pad lists-grid">${Object.keys(DEFAULT_LISTS).map(listEditor)}</div>
        <div class="pad"><p class="help">${th("set.listsNote")}</p></div>
      </section>

      <section class="card">
        <div class="card-head"><h2>${t("set.sampleTitle")}</h2></div>
        <div class="pad">
          <p class="help">${t("set.sampleHelp")}</p>
          <button type="button" class="btn" data-set="sample" ${empty ? "" : "disabled"}>${t("set.sampleLoad")}</button>
          ${empty ? "" : html`<p class="help">${t("set.sampleNotEmpty")}</p>`}
          ${store.S.dev ? html`<p class="help">${t("set.sampleFullHelp")}</p><button type="button" class="btn" data-set="sample-full">${icon("upload")} ${t("set.sampleFullLoad")}</button>` : ""}
        </div>
      </section>

      <section class="card danger-zone">
        <div class="card-head"><h2>${t("set.dangerTitle")}</h2></div>
        <div class="pad">
          <p class="help">${t("set.dangerHelp")}</p>
          <button type="button" class="btn btn-danger-ghost" data-set="wipe" ${empty ? "disabled" : ""}>${icon("trash")} ${t("set.wipe")}</button>
        </div>
      </section>
    </div>`.toString();

  // ---- Darstellung (Logo, Farbe, Name): Team-Admins und der Superadmin im betretenen Team ändern, Mitglieder sehen sie nur
  if (server && store.getTeam()) brandingView.bind(root, { canEdit: store.isTeamAdmin() });

  // ---- Abrechnung (Warengruppen, Firmenangaben, MWST)
  billingView.bind(root);
  fxView.bind(root);
  catsView.bind(root);

  // ---- Benachrichtigungen (Push; nur sichtbar, wenn der Server sie eingerichtet hat)
  push.mountSettings(root);

  // ---- Backups (Server)
  if (server) loadBackups(root.querySelector("[data-backups]"));

  // ---- SharePoint & Excel
  sharepoint.bind(root, { server, admin: spAdmin });
  outlook.bind(root, { server });

  // ---- Listen-Editor
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-le]");
    if (!b) return;
    const form = b.closest("form");
    const name = form.dataset.list;
    const isOwners = name === "owners";
    if (b.dataset.le === "add") {
      form.querySelector(".le-rows").insertAdjacentHTML("beforeend", listRow(isOwners, isOwners ? { name: "", role: "" } : "").toString());
      form.querySelector(".le-row:last-child input").focus();
    } else if (b.dataset.le === "del") {
      b.closest(".le-row").remove();
    } else if (b.dataset.le === "reset") {
      store.setList(name, null);
      toast(t("toast.listReset"));
    }
  });
  root.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-list]");
    if (!form) return;
    e.preventDefault();
    const name = form.dataset.list;
    const rows = [...form.querySelectorAll(".le-row")].map((r) => ({ name: r.querySelector('[data-v="name"]').value.trim(), role: r.querySelector('[data-v="role"]')?.value.trim() || "" })).filter((r) => r.name);
    const err = form.querySelector(".err");
    const names = rows.map((r) => r.name.toLowerCase());
    if (!rows.length) { err.textContent = t("set.listMin"); return; }
    if (new Set(names).size !== names.length) { err.textContent = t("set.listDup"); return; }
    store.setList(name, name === "owners" ? rows : rows.map((r) => r.name));
    toast(t("toast.listSaved"), { type: "ok" });
  });

  // ---- übrige Aktionen
  root.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.dataset.set === "user") { store.setUser(el.value); toast(t("toast.signedInAs", { name: el.value })); }
    if (el.dataset.set === "import-json" && el.files?.[0]) {
      const file = el.files[0];
      el.value = "";
      try {
        const parsed = JSON.parse(await file.text());
        await confirmAndReplace(parsed, t("set.fileLabel", { name: file.name }));
      } catch (err) {
        toast(t("toast.importFailed", { msg: err.message }), { type: "error", ms: 8000 });
      }
    }
  });
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-set],[data-csv]");
    if (!el) return;
    if (el.dataset.csv) return exportCsv(el.dataset.csv);
    switch (el.dataset.set) {
      case "export-json":
        downloadFile(`stps-crm-backup-${todayISO()}.json`, store.exportJson(), "application/json;charset=utf-8");
        toast(t("toast.jsonExported"), { type: "ok" });
        break;
      case "logout":
        push.detach().finally(() => store.logout().finally(() => location.reload()));
        break;
      case "sample":
        loadSampleData();
        toast(t("toast.sampleLoaded"), { type: "ok" });
        break;
      case "sample-full":
        try {
          const res = await fetch("/sample/beispieldaten.json", { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (await confirmAndReplace(await res.json(), t("set.sampleFullLabel"))) await seedSampleChat();
        } catch (err) { toast(t("toast.importFailed", { msg: err.message }), { type: "error", ms: 8000 }); }
        break;
      case "wipe": {
        const ok = await confirmDialog({
          title: t("set.wipeTitle"),
          message: html`<p>${th("set.wipeMsg", { summary: summary(store.counts()) })}</p><p class="muted">${t("set.wipeTip")}</p>`,
          confirmLabel: t("set.wipeConfirm"), danger: true, requireText: t("set.wipeWord"),
        });
        if (ok) { await store.resetAll(); toast(t("toast.allDeleted")); }
        break;
      }
      case "restore": {
        const date = el.dataset.date;
        try {
          const b = await api.getBackup(date);
          await confirmAndReplace(b.data, backupLabel(date, el.dataset.time));
        } catch (err) { toast(t("toast.restoreFailed", { msg: err.message }), { type: "error" }); }
        break;
      }
      case "dl-backup": {
        try {
          const b = await api.getBackup(el.dataset.date);
          downloadFile(`stps-crm-backup-${el.dataset.date}.json`, JSON.stringify(b.data, null, 2), "application/json;charset=utf-8");
        } catch (err) { toast(t("toast.downloadFailed", { msg: err.message }), { type: "error" }); }
        break;
      }
    }
  });
}

async function confirmAndReplace(raw, label) {
  // Struktur prüfen, bevor etwas ersetzt wird
  const probe = store.normalizeDb(raw);
  const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, probe[c].length]));
  const ok = await confirmDialog({
    title: t("set.replaceTitle"),
    message: html`<p>${th("set.replaceMsg", { current: html`<strong>${summary(store.counts())}</strong>`, label })}</p><p><strong>${summary(counts)}</strong></p><p class="muted">${t("set.replaceNote")}</p>`,
    confirmLabel: t("set.replaceConfirm"), danger: true,
  });
  if (!ok) return false;
  await store.replaceDb(raw);
  toast(t("toast.dbReplaced"), { type: "ok" });
  return true;
}

// Beispiel-Chat (nur Entwicklungsmodus, nur wenn der Team-Chat noch leer ist)
const SAMPLE_CHAT = [
  "Guten Morgen zusammen – die Offerte 40003 für Muster Maschinenbau geht heute raus.",
  "Super. Hanoi Sheet Metal hat das ISO-9001-Zertifikat noch nicht erneuert, ich frage nach.",
  "Rechnung 60001 ist seit dem 28.10. überfällig – Mahnung vorbereiten?",
  "Ja bitte. Und die Export-Rechnungen nach Österreich im Auge behalten (EUR).",
];
async function seedSampleChat() {
  try {
    const r = await api.chatList({ limit: 1 });
    if (r?.messages?.length) return;
    for (const m of SAMPLE_CHAT) await api.chatSend(m);
  } catch { /* Chat ist optional */ }
}

const backupLabel = (id, time) => (time ? t("set.backupLabelImport", { date: fmtDate(id.slice(0, 10)), time }) : t("set.backupLabel", { date: fmtDate(id.slice(0, 10)) }));

async function loadBackups(host) {
  try {
    const { backups } = await api.listBackups();
    if (!host.isConnected) return;
    host.innerHTML = backups.length
      ? html`<ul class="backups">${backups.map((b) => { const id = b.id || b.date; const time = b.kind === "import" ? (b.time || "").slice(0, 5) : ""; return html`<li><span>${fmtDate(b.date)}${b.kind === "import" ? html` <span class="badge t-grey">${t("set.beforeImport")}${time ? " " + time : ""}</span>` : ""}</span><span class="spacer"></span><button type="button" class="btn btn-sm" data-set="dl-backup" data-date="${id}">${icon("download")} JSON</button><button type="button" class="btn btn-sm" data-set="restore" data-date="${id}" data-time="${time}">${t("set.restore")}</button></li>`; })}</ul>`.toString()
      : html`<p class="muted">${t("set.noBackups")}</p>`.toString();
  } catch (e) {
    if (host.isConnected) host.innerHTML = html`<p class="muted">${t("set.backupsFailed", { msg: e.message })}</p>`.toString();
  }
}
