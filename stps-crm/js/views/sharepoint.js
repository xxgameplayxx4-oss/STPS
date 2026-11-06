// Einstellungen: Karten «Microsoft SharePoint» (nur Superadmin: Verbindung, Import, Export), «Excel in SharePoint» (kleine Karte für das
// Team, nur wenn der Export eingerichtet ist) und «Excel» (Import mit Vorschau, Download).
// Import/Export laufen auf dem Server (Netlify Function); im Lokalen Modus sind die Excel-Funktionen deaktiviert.
import * as store from "../store.js";
import * as api from "../api.js";
import { html, th, fmtDateTime, todayISO } from "../util.js";
import { t, tn, tryT, serverText } from "../i18n.js";
import { icon, toast, confirmDialog } from "../ui.js";
import { downloadFile } from "../csv.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_UPLOAD = 4.5 * 1024 * 1024; // Netlify Functions nehmen max. ca. 6 MB pro Anfrage an
const TABLE_ORDER = ["customers", "suppliers", "contacts", "deals", "rfqs", "activities", "tasks", "focus", "approvals"];

/** Zustand der Karten (überlebt das Neuzeichnen der Seite) */
const sp = { status: null, test: null, loadedAt: 0, busy: "", error: "", summary: null, minBusy: false };

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const httpsUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : "");
const msgOf = (e) => e?.message || "";

// ------------------------------------------------------------ Karte «Microsoft SharePoint» (Superadmin)

function badge() {
  const st = sp.status;
  if (!st) return html`<span class="badge t-grey">${t("sp.badge.loading")}</span>`;
  if (!st.configured) return html`<span class="badge t-grey">${t("sp.badge.off")}</span>`;
  if (sp.test?.ok) return html`<span class="badge t-green">${t("sp.badge.ok")}</span>`;
  if (sp.test) return html`<span class="badge t-red">${t("sp.badge.err")}</span>`;
  return html`<span class="badge t-blue">${t("sp.badge.ready")}</span>`;
}

function lastLine(label, info, ok) {
  if (!info) return "";
  const how = info.trigger ? ` (${tryT("sp.trigger." + info.trigger) || info.trigger})` : "";
  return ok
    ? html`<div><dt>${label}</dt><dd>${fmtDateTime(info.at)}${how}${info.files?.length ? html` · ${th("sp.filesIn", { n: info.files.length, folder: info.folder })}` : ""}</dd></div>`
    : html`<div><dt>${label}</dt><dd><span class="badge t-red">${t("sp.failed")}</span> ${fmtDateTime(info.at)}${how}<br><span class="err-text">${serverText(info.error)}</span></dd></div>`;
}

function body() {
  const st = sp.status;
  const intro = html`<p class="help">${t("sp.intro")}</p>`;
  if (!st) {
    return html`${intro}<p class="muted">${sp.error ? t("sp.loadFailed", { err: sp.error }) : t("sp.loading")}</p>${sp.error ? html`<div class="btn-row"><button type="button" class="btn btn-sm" data-sp="reload">${t("sp.reload")}</button></div>` : ""}`;
  }
  if (!st.configured) {
    return html`${intro}<div class="callout warn">${th("sp.notSetup")}
      <ul class="vars">${st.missing.map((v) => html`<li><code>${v}</code></li>`)}</ul>
      <p class="help">${th("sp.notSetupHelp")}</p></div>`;
  }
  const s = st.settings;
  const tst = sp.test;
  const b = sp.busy;
  const m = st.meta || {};
  const importDetail = (f) => (f.size != null ? ` (${fmtSize(f.size)}${f.modified ? `, ${t("sp.modified", { at: fmtDateTime(f.modified) })}` : ""})` : "");
  return html`${intro}
    ${tst?.ok ? html`<div class="callout ok">${th("sp.test.ok", { site: tst.siteName, drive: tst.driveName })}
        ${tst.importFile ? (tst.importFile.exists ? html`<br>${t("sp.test.importFound", { detail: importDetail(tst.importFile) })}` : html`<br><span class="err-text">${th("sp.test.importMissing", { path: tst.importFile.path })}</span>`) : ""}
        ${tst.exportFolder ? (tst.exportFolder.exists ? html`<br>${t("sp.test.exportOk")}` : html`<br>${th("sp.test.exportNew", { path: tst.exportFolder.path })}`) : ""}</div>` : ""}
    ${tst && !tst.ok ? html`<div class="callout err">${th("sp.test.fail", { message: serverText(tst.message) })}</div>` : ""}
    ${!st.canImport || !st.canExport ? html`<div class="callout warn">${!st.canImport ? html`${th("sp.missingImport")} ` : ""}${!st.canExport ? th("sp.missingExport") : ""}</div>` : ""}
    <dl class="dl flush">
      <div><dt>${t("sp.dl.site")}</dt><dd><code>${s.site}</code></dd></div>
      <div><dt>${t("sp.dl.drive")}</dt><dd>${s.drive || t("sp.dl.driveDefault")}</dd></div>
      ${s.importPath ? html`<div><dt>${t("sp.dl.importFile")}</dt><dd><code>${s.importPath}</code></dd></div>` : ""}
      ${s.exportFolder ? html`<div><dt>${t("sp.dl.exportFolder")}</dt><dd><code>${s.exportFolder}</code></dd></div>` : ""}
      ${m.lastExport ? lastLine(t("sp.lastExport"), m.lastExport, m.lastExport.ok) : html`<div><dt>${t("sp.lastExport")}</dt><dd class="muted">${t("sp.never")}</dd></div>`}
      ${m.lastExport && !m.lastExport.ok ? lastLine(t("sp.lastSuccess"), m.lastSuccess, true) : ""}
      ${m.lastImport ? html`<div><dt>${t("sp.lastImport")}</dt><dd>${fmtDateTime(m.lastImport.at)} · ${m.lastImport.source === "sharepoint" ? "SharePoint" : t("sp.srcFile")}${m.lastImport.file ? html` «${m.lastImport.file}»` : ""}${m.lastImport.totals ? ` · ${t("sp.importTotals", m.lastImport.totals)}` : ""}</dd></div>` : ""}
    </dl>
    <div class="btn-row wrap">
      <button type="button" class="btn" data-sp="test" ${b ? "disabled" : ""}>${icon("cloud")} ${b === "test" ? t("sp.btn.testing") : t("sp.btn.test")}</button>
      <button type="button" class="btn" data-sp="import" ${b || !st.canImport ? "disabled" : ""} title="${!st.canImport ? t("sp.noImportPath") : ""}">${icon("download")} ${b === "import" ? t("sp.btn.importing") : t("sp.btn.import")}</button>
      <button type="button" class="btn btn-primary" data-sp="export" ${b || !st.canExport ? "disabled" : ""} title="${!st.canExport ? t("sp.noExportFolder") : ""}">${icon("upload")} ${b === "export" ? t("sp.btn.exporting") : t("sp.btn.export")}</button>
    </div>`;
}

function paint() {
  const card = document.querySelector("[data-sp-card]");
  if (!card) return;
  card.querySelector("[data-sp-badge]").innerHTML = badge().toString();
  card.querySelector("[data-sp-body]").innerHTML = body().toString();
}

async function loadStatus({ force = false } = {}) {
  if (!force && sp.status && Date.now() - sp.loadedAt < 30000) { paint(); return; }
  sp.error = "";
  try {
    const st = await api.spStatus(false);
    sp.status = st;
    sp.loadedAt = Date.now();
  } catch (e) {
    sp.error = e.message || t("common.error");
  }
  paint();
}

async function testConnection() {
  sp.busy = "test";
  paint();
  try {
    const st = await api.spStatus(true);
    sp.status = st;
    sp.loadedAt = Date.now();
    sp.test = st.test || null;
    if (sp.test?.ok) toast(t("sp.toast.connOk"), { type: "ok" });
    else if (sp.test) toast(serverText(sp.test.message), { type: "error", ms: 9000 });
  } catch (e) {
    toast(t("sp.toast.testFailed", { msg: msgOf(e) }), { type: "error", ms: 9000 });
  } finally {
    sp.busy = "";
    paint();
  }
}

async function exportNow() {
  sp.busy = "export";
  paint();
  try {
    const r = await api.spExport(store.getUser());
    toast(tn("sp.toast.exported", r.files.length, { folder: r.folder }), { type: "ok" });
  } catch (e) {
    toast(t("sp.toast.exportFailed", { msg: msgOf(e) }), { type: "error", ms: 9000 });
  } finally {
    sp.busy = "";
    await loadStatus({ force: true });
  }
}

// ------------------------------------------------------------ Karte «Excel in SharePoint» (Team: nur wenn eingerichtet)

function minHtml() {
  const sum = sp.summary;
  const url = httpsUrl(sum?.folderUrl);
  const busy = sp.minBusy;
  return html`<section class="card" data-sp-min ${sum?.configured ? "" : "hidden"}>
    <div class="card-head"><h2>${t("spmin.title")}</h2></div>
    <div class="pad stack">
      <p class="help">${t("spmin.text")}</p>
      <p class="help" data-sp-min-last>${sum?.lastExportAt ? t("spmin.last", { at: fmtDateTime(sum.lastExportAt) }) : t("spmin.never")}</p>
      <div class="btn-row wrap">
        <button type="button" class="btn btn-primary" data-spmin="upload" ${busy ? "disabled" : ""}>${icon("upload")} ${busy ? t("spmin.uploading") : t("spmin.upload")}</button>
        ${url ? html`<a class="btn" href="${url}" target="_blank" rel="noopener noreferrer" data-spmin="open">${icon("link")} ${t("spmin.open")}</a>` : ""}
      </div>
    </div>
  </section>`;
}

function paintMin() {
  const card = document.querySelector("[data-sp-min]");
  if (!card) return;
  card.outerHTML = minHtml().toString();
}

async function loadSummary() {
  try {
    sp.summary = await api.spSummary();
  } catch {
    sp.summary = { configured: false }; // ohne Antwort bleibt die Karte unsichtbar (keine technischen Meldungen)
  }
  paintMin();
}

async function uploadNow() {
  if (sp.minBusy) return;
  // Das Fenster muss synchron im Klick geöffnet werden, sonst blockiert der Browser es; die Adresse folgt nach der Antwort.
  let win = null;
  try { win = window.open("about:blank", "_blank"); } catch { win = null; }
  sp.minBusy = true;
  paintMin();
  try {
    const r = await api.spExport(store.getUser());
    const url = httpsUrl(r.folderUrl) || httpsUrl(sp.summary?.folderUrl);
    sp.summary = { configured: true, lastExportAt: r.at || new Date().toISOString(), folderUrl: url || null };
    if (url && win && !win.closed) {
      try { win.opener = null; } catch { /* nicht erlaubt */ }
      win.location.href = url;
    } else if (win && !win.closed) {
      win.close();
    }
    toast(t("spmin.done"), { type: "ok", ms: url ? 12000 : 4500, link: url ? { href: url, label: t("spmin.open") } : null });
  } catch {
    try { if (win && !win.closed) win.close(); } catch { /* egal */ }
    toast(t("spmin.failed"), { type: "error", ms: 9000 });
  } finally {
    sp.minBusy = false;
    paintMin();
  }
}

// ------------------------------------------------------------ Import mit Vorschau

function previewHtml(pre) {
  const tot = pre.totals;
  const src = pre.source === "sharepoint"
    ? th("imp.srcSharepoint", { path: pre.file.path })
    : th("imp.srcFile", { name: pre.file?.name || "Excel" });
  const rows = TABLE_ORDER.map((k) => (pre.summary[k] ? { key: k, ...pre.summary[k] } : null)).filter(Boolean);
  const warned = rows.filter((s) => s.warnings.length);
  const label = (s) => tryT("imp.table." + s.key) || s.label;
  return html`<div class="imp-preview">
    <p class="muted">${src}${pre.file?.size ? ` · ${fmtSize(pre.file.size)}` : ""}${pre.file?.modified ? ` · ${t("sp.modified", { at: fmtDateTime(pre.file.modified) })}` : ""}</p>
    <table class="imp-tbl"><thead><tr><th>${t("imp.col.table")}</th><th>${t("imp.col.added")}</th><th>${t("imp.col.updated")}</th><th>${t("imp.col.unchanged")}</th><th>${t("imp.col.skipped")}</th></tr></thead><tbody>
      ${rows.map((s) => (s.found
        ? html`<tr><td>${label(s)}</td><td class="n ${s.added ? "pos" : ""}">${s.added}</td><td class="n ${s.updated ? "pos" : ""}">${s.updated}</td><td class="n">${s.unchanged}</td><td class="n ${s.skipped ? "neg" : ""}">${s.skipped}</td></tr>`
        : html`<tr class="off"><td>${label(s)}</td><td colspan="4">${t("imp.noSheet")}</td></tr>`))}
    </tbody></table>
    ${warned.length ? html`<details class="imp-warn" ${tot.warnings <= 6 ? "open" : ""}><summary>${t("imp.warnings", { n: tot.warnings })}</summary>
      ${warned.map((s) => html`<strong>${label(s)}</strong><ul>${s.warnings.map((w) => html`<li>${serverText(w)}</li>`)}</ul>`)}</details>` : ""}
    <p class="muted">${pre.changed ? t("imp.footChanged") : t("imp.footNone")}</p>
  </div>`;
}

/** Vorschau anzeigen, bei «Übernehmen» speichern und die Daten neu laden. */
async function runImport({ label, preview, apply }) {
  // Alles Offene zuerst speichern, damit die Vorschau und das Zusammenführen auf dem aktuellen Stand beruhen.
  await store.flushNow();
  if (store.isDirty()) { toast(t("imp.unsaved"), { type: "error" }); return; }
  let pre;
  try {
    pre = await preview();
  } catch (e) {
    toast(`${label}: ${msgOf(e)}`, { type: "error", ms: 9000 });
    return;
  }
  if (!pre.changed) {
    await confirmDialog({ title: t("imp.noChangesTitle", { label }), message: previewHtml(pre), confirmLabel: t("common.close"), cancelLabel: null, wide: true });
    return;
  }
  const ok = await confirmDialog({ title: t("imp.previewTitle", { label }), message: previewHtml(pre), confirmLabel: t("imp.apply"), cancelLabel: t("common.cancel"), wide: true });
  if (!ok) return;
  try {
    const res = await apply(pre);
    await store.reloadFromServer({ silent: true });
    const tot = res.totals || pre.totals;
    toast(t("imp.done", { added: tot.added, updated: tot.updated }), { type: "ok", ms: 7000 });
  } catch (e) {
    const stale = e instanceof api.ApiError && e.status === 409;
    toast(stale ? `${msgOf(e)}.` : t("imp.failed", { msg: msgOf(e) }), { type: "error", ms: 9000 });
  } finally {
    if (document.querySelector("[data-sp-card]")) loadStatus({ force: true });
  }
}

// ------------------------------------------------------------ Einbindung

/**
 * server: es gibt eine API (nicht Lokaler Modus). admin: Superadmin – nur er sieht Einrichtung, Diagnose und Import.
 * Alle anderen sehen höchstens die kleine Karte «Excel in SharePoint» (erst sichtbar, wenn der Server meldet, dass sie eingerichtet ist).
 */
export function cardsHtml({ server, admin = false } = {}) {
  const dis = server ? "" : "disabled";
  return html`${server && admin ? html`<section class="card" data-sp-card>
      <div class="card-head"><h2>${t("sp.title")}</h2><span data-sp-badge>${badge()}</span></div>
      <div class="pad sp-body" data-sp-body>${body()}</div>
    </section>` : ""}
    ${server && !admin ? minHtml() : ""}
    <section class="card">
      <div class="card-head"><h2>${t("xl.title")}</h2></div>
      <div class="pad stack">
        <div><h3>${t("xl.importH")}</h3>
          <p class="help">${th("xl.importHelp")}</p>
          <label class="btn" aria-disabled="${server ? "false" : "true"}">${icon("upload")} ${t("xl.importBtn")}<input type="file" accept=".xlsx,${XLSX_MIME}" data-xlsx="import" class="sr" ${dis}></label></div>
        <div><h3>${t("xl.exportH")}</h3>
          <p class="help">${t("xl.exportHelp")}</p>
          <button type="button" class="btn btn-primary" data-xlsx="export" ${dis}>${icon("download")} ${t("xl.exportBtn")}</button></div>
        ${server ? "" : html`<p class="help">${t("xl.localOnly")}</p>`}
      </div>
    </section>`;
}

/** Ereignisse der Karten an die (frisch gezeichnete) Seite binden. */
export function bind(root, { server, admin = false } = {}) {
  if (server && admin) loadStatus();
  else if (server) { if (sp.summary) paintMin(); loadSummary(); }

  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-sp],[data-spmin=upload],[data-xlsx=export]");
    if (!b || b.disabled) return;
    const by = store.getUser();
    if (b.dataset.spmin === "upload") return uploadNow();
    if (b.dataset.sp === "reload") return loadStatus({ force: true });
    if (b.dataset.sp === "test") return testConnection();
    if (b.dataset.sp === "export") return exportNow();
    if (b.dataset.sp === "import") {
      sp.busy = "import";
      paint();
      try {
        await runImport({
          label: t("imp.labelSp"),
          preview: () => api.spImport({ dryRun: true, by }),
          apply: (pre) => api.spImport({ dryRun: false, baseVersion: pre.baseVersion, expect: pre.fileHash, by }),
        });
      } finally {
        sp.busy = "";
        paint();
      }
      return;
    }
    if (b.dataset.xlsx === "export") {
      b.disabled = true;
      try {
        const blob = await api.downloadXlsx();
        downloadFile(`STPS_CRM_Export_${todayISO()}.xlsx`, blob, XLSX_MIME);
        toast(t("xl.toast.created"), { type: "ok" });
      } catch (err) {
        toast(t("xl.toast.exportFailed", { msg: msgOf(err) }), { type: "error", ms: 8000 });
      } finally {
        b.disabled = false;
      }
    }
  });

  root.addEventListener("change", async (e) => {
    const inp = e.target;
    if (inp.dataset?.xlsx !== "import" || !inp.files?.[0]) return;
    const file = inp.files[0];
    inp.value = "";
    if (!/\.xlsx$/i.test(file.name)) { toast(t("xl.notXlsx"), { type: "error", ms: 8000 }); return; }
    if (file.size > MAX_UPLOAD) { toast(t("xl.tooBig", { size: fmtSize(file.size) }), { type: "error", ms: 8000 }); return; }
    let bytes;
    try { bytes = await file.arrayBuffer(); } catch { toast(t("xl.unreadable"), { type: "error" }); return; }
    const by = store.getUser();
    await runImport({
      label: t("imp.labelFile", { name: file.name }),
      preview: () => api.importXlsx(bytes, { dryRun: true, name: file.name, by }),
      apply: (pre) => api.importXlsx(bytes, { dryRun: false, name: file.name, baseVersion: pre.baseVersion, expect: pre.fileHash, by }),
    });
  });
}
