// Lieferanten-Dokumente/Zertifikate: Editor im Lieferanten-Formular (Feldtyp «widget»), Karte in der Detailansicht, Warn-Badge für Listen,
// Aktion «Erneuert» (archiviert das alte Dokument) und Warnkarte für die Übersicht.
// Ein Dokument: Typ (ISO 9001/14001/13485, Kalibrierzertifikat, Sonstiges), Name, Datei (hochgeladen, js/files.js) ODER Link, ausgestellt am,
// gültig bis, Intervall in Monaten (schlägt die nächste Fälligkeit vor). Gespeichert wird nur der Verweis auf die Datei.
import { html, fmtDate, todayISO, uid } from "../util.js";
import { t } from "../i18n.js";
import { icon, openForm, toast } from "../ui.js";
import { update, byId, handleAuthError } from "../store.js";
import * as files from "../files.js";
import { gauge } from "./common.js";
import { certState, activeDocs, archivedDocs, docsOf, certSummary, safeUrl, CERT_TYPES, MAX_INTERVAL, proposeDue, renewDoc, certAlerts, daysLeft, WARN_DAYS } from "../certs.js";

const STATE_TONE = { expired: "red", soon: "amber", ok: "green" };

/** Kleines Zeichen für den Gültigkeits-Status (leer ohne Ablaufdatum) */
export const stateBadge = (state) => (state ? html`<span class="badge t-${STATE_TONE[state]}">${t(`cert.state.${state}`)}</span>` : "");

/** Warn-Badge(s) für Listen/Kopfzeile: abgelaufene und bald ablaufende Dokumente */
export function warnBadges(s) {
  const c = certSummary(s, todayISO());
  return html`${c.expired ? html`<span class="badge t-red" title="${t("cert.warn.expiredTitle")}">${t("cert.warn.expired", { n: c.expired })}</span>` : ""}${c.soon ? html` <span class="badge t-amber" title="${t("cert.warn.soonTitle")}">${t("cert.warn.soon", { n: c.soon })}</span>` : ""}`;
}

/** Restlaufzeit als Strichskala: wie viel des 60-Tage-Fensters vor dem Ablauf noch übrig ist (abgelaufen = leer, weit gültig = voll) */
const validityScale = (days) => gauge(Math.max(0, Math.min(WARN_DAYS, Number(days) || 0)), WARN_DAYS);

const typeLabel = (d) => t(`cert.type.${CERT_TYPES.includes(d.typ) ? d.typ : "sonstiges"}`);
/** Anzeigename: eigener Name, sonst die Typbezeichnung */
const nameOf = (d) => d.name || (d.typ && d.typ !== "sonstiges" ? typeLabel(d) : "–");

/** Verweis auf die Quelle: hochgeladene Datei (Download) und/oder Link */
function sourceHtml(d) {
  const href = safeUrl(d.link);
  const f = d.file && typeof d.file === "object" && d.file.id ? d.file : null;
  return html`${f ? html`<button type="button" class="linkbtn" data-file-id="${f.id}" data-file-name="${f.name}" title="${t("file.download")}">${icon("file")} ${f.name}</button> <small class="muted">${files.sizeLabel(f.size || 0)}</small>` : ""}${f && href ? " " : ""}${href ? html`<a href="${href}" target="_blank" rel="noopener noreferrer" class="rowlink">${icon("link")} ${f ? t("cert.f.link") : d.link}</a>` : ""}`;
}

const metaHtml = (d, st) => html`${d.ausgestelltAm ? html`<span class="muted">${t("cert.issued")}: ${fmtDate(d.ausgestelltAm)}</span>` : ""}
  ${d.gueltigBis ? html`<span class="muted">${t("cert.validUntil")}: ${fmtDate(d.gueltigBis)}</span>` : html`<span class="muted">${t("cert.noExpiry")}</span>`}
  ${d.intervall ? html`<span class="muted">${t("cert.every", { n: d.intervall })}</span>` : ""} ${stateBadge(st)}${st ? validityScale(daysLeft(d, todayISO())) : ""}`;

/** Karte «Dokumente & Zertifikate» der Lieferanten-Detailansicht */
export function certsCard(s) {
  const docs = activeDocs(s);
  const old = archivedDocs(s);
  const today = todayISO();
  return html`<section class="card" data-certs-card>
    <div class="card-head"><h2>${t("cert.title")} <span class="count">${docs.length}</span></h2></div>
    ${docs.length
      ? html`<ul class="cert-list">${docs.map((d) => {
        const st = certState(d, today);
        return html`<li class="cert ${st === "expired" ? "is-expired" : ""}" data-cert-id="${d.id}">
          <div class="cert-main"><span class="badge t-grey">${typeLabel(d)}</span>${d.name ? html` <strong>${d.name}</strong>` : ""}<div class="cert-src">${sourceHtml(d)}</div></div>
          <div class="cert-meta">${metaHtml(d, st)}<button type="button" class="btn btn-sm" data-cert-renew="${d.id}" data-supplier="${s.id}" title="${t("cert.renew.hint")}">${icon("repeat")} ${t("cert.renew")}</button></div>
        </li>`;
      })}</ul>`
      : html`<p class="muted pad">${t("cert.none")}</p>`}
    ${old.length ? html`<details class="cert-archive"><summary>${t("cert.archive")} <span class="count">${old.length}</span></summary>
      <ul class="cert-list">${old.map((d) => html`<li class="cert is-archived"><div class="cert-main"><span class="badge t-grey">${typeLabel(d)}</span>${d.name ? html` ${d.name}` : ""}<div class="cert-src">${sourceHtml(d)}</div></div>
        <div class="cert-meta">${d.gueltigBis ? html`<span class="muted">${t("cert.validUntil")}: ${fmtDate(d.gueltigBis)}</span>` : ""}<span class="muted">${t("cert.archivedOn", { date: fmtDate(d.archiviertAm) })}</span></div></li>`)}</ul></details>` : ""}
  </section>`;
}

/** Warnkarte für die Übersicht: abgelaufene und innerhalb von 60 Tagen ablaufende Dokumente aller Lieferanten ("" wenn keine) */
export function certDashboardCard(suppliers) {
  const items = certAlerts(suppliers, todayISO());
  if (!items.length) return "";
  const expired = items.filter((i) => i.state === "expired").length;
  const when = (i) => (i.days < 0 ? t("cert.dash.ago", { n: -i.days }) : i.days === 0 ? t("cert.dash.today") : t("cert.dash.in", { n: i.days }));
  return html`<section class="card cert-dash" aria-labelledby="h-certs" data-cert-dash>
    <div class="card-head"><h2 id="h-certs">${t("cert.dash.title")} <span class="count-pill ${expired ? "alert" : ""}">${items.length}</span></h2>
      <span class="muted">${expired ? t("cert.dash.expiredN", { n: expired }) + " · " : ""}${t("cert.dash.soonHint")}</span></div>
    <ul class="cert-list">${items.slice(0, 12).map((i) => html`<li class="cert ${i.state === "expired" ? "is-expired" : ""}">
      <div class="cert-main"><a href="#/lieferanten/${i.supplierId}" class="rowlink">${i.supplier}</a> <span class="muted">· ${typeLabel(i.doc)}${i.doc.name ? " · " + i.doc.name : ""}</span></div>
      <div class="cert-meta"><span class="muted">${fmtDate(i.doc.gueltigBis)}</span> <span class="badge t-${STATE_TONE[i.state]}">${i.state === "expired" ? t("cert.state.expired") : t("cert.state.soon")}</span> ${validityScale(i.days)}<span class="muted">${when(i)}</span></div>
    </li>`)}${items.length > 12 ? html`<li class="muted more">${t("week.andMore", { n: items.length - 12 })}</li>` : ""}</ul>
  </section>`;
}

// ------------------------------------------------------------ Link + Datei (gemeinsam für Editor und «Erneuert»-Dialog)

/** Link und Datei eines Dokuments; st = {link, file, busy, ferr}. Elemente: data-c="link", data-c-file (Input), data-c-unfile */
const attachHtml = (st) => html`<label class="pf cert-link"><span>${t("cert.f.link")}</span><input type="text" data-c="link" autocomplete="off" inputmode="url" placeholder="https://" value="${st.link || ""}"></label>
  <div class="pf cert-file"><span>${t("cert.f.file")}</span>
    ${st.file ? html`<div class="cert-filechip">${icon("file")}<button type="button" class="linkbtn" data-file-id="${st.file.id}" data-file-name="${st.file.name}" title="${t("file.download")}">${st.file.name}</button><small class="muted">${files.sizeLabel(st.file.size || 0)}</small><button type="button" class="icon-btn" data-c-unfile aria-label="${t("file.remove")}" title="${t("file.remove")}">${icon("x")}</button></div>`
      : st.busy ? html`<span class="muted">${t("file.uploading")}</span>`
      : html`<label class="btn btn-sm cert-upload">${icon("upload")} ${t("cert.f.upload")}<input type="file" class="sr" accept="${files.ACCEPT}" data-c-file></label>`}
    ${st.ferr ? html`<div class="cert-ferr" role="alert">${st.ferr}</div>` : ""}</div>`;

/** Hängt Upload/Entfernen an ein Element; getState(Knoten) liefert den Zustand der Zeile, repaint() zeichnet neu, changed() meldet die Änderung */
function bindAttach(el, getState, repaint, changed) {
  el.addEventListener("change", async (e) => {
    const input = e.target.closest?.("[data-c-file]");
    if (!input) return;
    const st = getState(input);
    const f = input.files?.[0];
    if (!st || !f) return;
    st.busy = true; st.ferr = "";
    repaint();
    try {
      st.file = await files.upload(f, { scope: "team" });
      st.pending = [...(st.pending || []), st.file.id];
      changed();
    } catch (err) {
      if (!handleAuthError(err)) st.ferr = err.message || t("file.err.upload");
    } finally {
      st.busy = false;
      repaint();
    }
  });
  el.addEventListener("click", (e) => {
    const un = e.target.closest?.("[data-c-unfile]");
    if (!un) return;
    const st = getState(un);
    if (!st?.file) return;
    // Eben erst (noch nicht gespeichert) hochgeladene Datei sofort löschen; eine bereits gespeicherte bleibt bis zum Speichern des Datensatzes
    if ((st.pending || []).includes(st.file.id)) { files.discard(st.file); st.pending = st.pending.filter((x) => x !== st.file.id); }
    st.file = null;
    changed();
    repaint();
  });
}

// ------------------------------------------------------------ Editor im Lieferanten-Formular

const blank = () => ({ id: uid(), typ: "iso9001", name: "", link: "", file: null, ausgestelltAm: "", gueltigBis: "", intervall: "", _auto: "" });

/** Feldobjekt für openForm: Liste von Dokumenten. Wert = Array in `dokumente` (archivierte Dokumente bleiben unverändert erhalten). */
export function certsField() {
  let el = null;
  let rows = [];
  let archived = [];
  let ctx = null;

  const rowHtml = (d) => {
    const prop = proposeDue(d.ausgestelltAm, d.intervall);
    return html`<div class="cert-row" data-cert="${d.id}">
    <label class="pf cert-type"><span>${t("cert.f.type")}</span><select data-c="typ">${CERT_TYPES.map((v) => html`<option value="${v}" ${v === d.typ ? "selected" : ""}>${t(`cert.type.${v}`)}</option>`)}</select></label>
    <label class="pf cert-name"><span>${t("cert.f.name")}</span><input type="text" data-c="name" autocomplete="off" placeholder="${t("cert.f.namePh")}" value="${d.name}"></label>
    ${attachHtml(d)}
    <label class="pf cert-iss"><span>${t("cert.f.issued")}</span><input type="date" data-c="ausgestelltAm" value="${d.ausgestelltAm || ""}"></label>
    <label class="pf cert-int"><span>${t("cert.f.interval")}</span><input type="number" data-c="intervall" min="1" max="${MAX_INTERVAL}" step="1" inputmode="numeric" placeholder="${t("cert.f.intervalPh")}" value="${d.intervall || ""}"></label>
    <label class="pf cert-due"><span>${t("cert.f.validUntil")}</span><input type="date" data-c="gueltigBis" value="${d.gueltigBis || ""}"></label>
    <button type="button" class="icon-btn" data-c-del aria-label="${t("cert.remove")}" title="${t("cert.remove")}">${icon("trash")}</button>
    <div class="cert-hint muted" data-c-hint>${prop ? t("cert.f.proposal", { date: fmtDate(prop) }) : t("cert.f.proposalHelp")}</div>
  </div>`;
  };
  const paint = () => {
    el.innerHTML = html`<div class="cert-ed">${rows.map(rowHtml)}<button type="button" class="btn btn-sm" data-c-add>${icon("plus")} ${t("cert.add")}</button></div>`.toString();
  };
  const rowOf = (node) => rows.find((r) => r.id === node.closest("[data-cert]")?.dataset.cert);

  const widget = {
    mount(host, vals, c) {
      el = host; ctx = c;
      const all = docsOf(vals);
      archived = all.filter((d) => d.archiviert);
      rows = all.filter((d) => !d.archiviert).map((d) => ({
        id: d.id || uid(), typ: CERT_TYPES.includes(d.typ) ? d.typ : "sonstiges", name: d.name || "", link: d.link || "",
        file: d.file && d.file.id ? d.file : null, ausgestelltAm: d.ausgestelltAm || "", gueltigBis: d.gueltigBis || "", intervall: d.intervall || "",
        _auto: proposeDue(d.ausgestelltAm, d.intervall) === d.gueltigBis ? d.gueltigBis || "" : "", extra: d,
      }));
      paint();
      el.addEventListener("input", (e) => {
        const key = e.target.dataset?.c;
        const r = key && rowOf(e.target);
        if (!r || e.target.type === "file") return;
        r[key] = e.target.value;
        if (key === "ausgestelltAm" || key === "intervall") {
          // Nächste Fälligkeit vorschlagen: «gültig bis» folgt, solange es leer ist oder noch dem letzten Vorschlag entspricht
          const prop = proposeDue(r.ausgestelltAm, r.intervall);
          const rowEl = e.target.closest("[data-cert]");
          if (prop && (!r.gueltigBis || r.gueltigBis === r._auto)) {
            r.gueltigBis = prop;
            rowEl.querySelector('[data-c="gueltigBis"]').value = prop;
          }
          r._auto = prop || r._auto;
          rowEl.querySelector("[data-c-hint]").textContent = prop ? t("cert.f.proposal", { date: fmtDate(prop) }) : t("cert.f.proposalHelp");
        }
        ctx.changed();
      });
      el.addEventListener("change", (e) => { if (e.target.dataset?.c === "typ") { const r = rowOf(e.target); if (r) { r.typ = e.target.value; ctx.changed(); } } });
      bindAttach(el, (n) => rowOf(n), paint, () => ctx.changed());
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-c-add]")) { rows.push(blank()); ctx.changed(); paint(); el.querySelector(".cert-row:last-of-type [data-c=name]")?.focus(); return; }
        const del = e.target.closest("[data-c-del]");
        if (del) {
          const r = rowOf(del);
          for (const id of r?.pending || []) files.discard({ id }); // nur in dieser Sitzung hochgeladene, noch nicht gespeicherte Dateien
          rows = rows.filter((x) => x !== r); ctx.changed(); paint();
        }
      });
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) e.preventDefault(); });
    },
    read() {
      const used = rows.filter((r) => r.name.trim() || r.link.trim() || r.file || r.gueltigBis || r.ausgestelltAm);
      for (const r of used) {
        const label = r.name.trim() || (r.typ !== "sonstiges" ? t(`cert.type.${r.typ}`) : "");
        if (!label) return { value: null, error: t("cert.err.name") };
        if (r.link.trim() && !safeUrl(r.link)) return { value: null, error: t("cert.err.link", { name: label }) };
        const iv = r.intervall === "" ? null : Number(r.intervall);
        if (iv !== null && (!Number.isInteger(iv) || iv < 1 || iv > MAX_INTERVAL)) return { value: null, error: t("cert.err.interval", { name: label, max: MAX_INTERVAL }) };
        if (r.ausgestelltAm && r.gueltigBis && r.gueltigBis < r.ausgestelltAm) return { value: null, error: t("cert.err.order", { name: label }) };
      }
      const out = used.map((r) => {
        const d = { ...(r.extra || {}), id: r.id, typ: r.typ, name: r.name.trim(), link: r.link.trim(), ausgestelltAm: r.ausgestelltAm || "", gueltigBis: r.gueltigBis || "", intervall: r.intervall === "" ? null : Number(r.intervall) };
        if (r.file) d.file = r.file; else delete d.file;
        return d;
      });
      return { value: [...out, ...archived] };
    },
  };
  return { key: "dokumente", type: "widget", get label() { return t("cert.title"); }, full: true, widget };
}

// ------------------------------------------------------------ «Erneuert»: neues Dokument, das alte wird archiviert

function attachField() {
  const st = { link: "", file: null, busy: false, ferr: "", pending: [] };
  let host = null;
  const paint = () => { host.innerHTML = html`<div class="cert-renew-att">${attachHtml(st)}</div>`.toString(); };
  return {
    key: "_att", type: "widget", full: true, get label() { return t("cert.renew.source"); },
    widget: {
      mount(h, _vals, c) {
        host = h; paint();
        h.addEventListener("input", (e) => { if (e.target.dataset?.c === "link") { st.link = e.target.value; c.changed(); } });
        bindAttach(h, () => st, paint, () => c.changed());
        h.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) e.preventDefault(); });
      },
      read() {
        if (st.link.trim() && !safeUrl(st.link)) return { value: null, error: t("cert.err.linkOnly") };
        return { value: { link: st.link.trim(), file: st.file } };
      },
    },
  };
}

/** Dialog «Erneuert»: neue Daten erfassen; das bisherige Dokument wird archiviert und durch das neue ersetzt. */
export async function openRenew(supplierId, docId) {
  const s = byId("suppliers", supplierId);
  const doc = s && docsOf(s).find((d) => d.id === docId && !d.archiviert);
  if (!doc) return false;
  const today = todayISO();
  const name = nameOf(doc);
  const intervals = [...new Set([6, 12, 24, 36, 48, 60, ...(doc.intervall ? [Number(doc.intervall)] : [])])].sort((a, b) => a - b);
  let auto = doc.intervall ? proposeDue(today, doc.intervall) : "";
  const fields = [
    { key: "ausgestelltAm", type: "date", label: t("cert.f.issued") },
    { key: "intervall", type: "select", numeric: true, label: t("cert.f.interval"), blank: t("cert.f.intervalPh"), options: intervals.map((n) => ({ value: n, label: t("cert.every", { n }) })) },
    { key: "gueltigBis", type: "date", label: t("cert.f.validUntil"), help: t("cert.renew.dueHelp") },
    attachField(),
  ];
  return openForm({
    title: t("cert.renew.title", { name }),
    subtitle: t("cert.renew.help"),
    submitLabel: t("cert.renew.submit"),
    fields,
    values: { ausgestelltAm: today, intervall: doc.intervall ? Number(doc.intervall) : "", gueltigBis: auto },
    validate: (v) => (v.gueltigBis && v.ausgestelltAm && v.gueltigBis < v.ausgestelltAm ? { gueltigBis: t("cert.err.order", { name }) } : {}),
    onChange: (key, vals, api) => {
      if (key !== "ausgestelltAm" && key !== "intervall") return;
      const prop = proposeDue(vals.ausgestelltAm, vals.intervall);
      if (prop && (!vals.gueltigBis || vals.gueltigBis === auto)) api.set("gueltigBis", prop);
      auto = prop || auto;
    },
    onSubmit: async (v) => {
      const list = docsOf(byId("suppliers", supplierId));
      const i = list.findIndex((d) => d.id === docId && !d.archiviert);
      if (i < 0) { toast(t("store.recordGone"), { type: "error" }); return false; }
      const { archived, fresh } = renewDoc(list[i], { link: v._att?.link, file: v._att?.file, ausgestelltAm: v.ausgestelltAm, gueltigBis: v.gueltigBis, intervall: v.intervall }, { today, id: uid() });
      update("suppliers", supplierId, { dokumente: [...list.slice(0, i), fresh, archived, ...list.slice(i + 1)] });
      toast(t("cert.renew.done", { name }), { type: "ok" });
    },
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-cert-renew]");
    if (b) { e.preventDefault(); openRenew(b.dataset.supplier, b.dataset.certRenew); }
  });
}
