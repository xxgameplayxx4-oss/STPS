// Rechnungen: Liste (Statusfilter inkl. abgeleitetem «Überfällig»), Detail, Formular, «Rechnung erstellen» aus einem Angebot.
import { all, byId, create, update, remove, peekInvoiceNr } from "../store.js";
import { html, th, fmtDate, fmtDateTime, todayISO, addDays, clone } from "../util.js";
import { icon, crumbs, openForm, confirmDialog, toast } from "../ui.js";
import { listView } from "../table.js";
import { dealsOf, customerLabel, primaryContact } from "../model.js";
import { dateCell, dash, customerLink, textCell, dl } from "./common.js";
import { positionsField, unpackPositions } from "./positions.js";
import { billingSettings, invBadge, statusOf, totalsOf, docMoney, sumsByCurrency, vatForCustomer, positionsTable, totalsBlock, INVOICE_STATUS } from "./docs.js";
import { INVOICE_CURRENCIES, DEFAULT_CURRENCY, docCurrency, banksFor, bankFor, isRetainedInvoice } from "../billing.js";
import { OVERDUE } from "../config.js";
import { t, tv } from "../i18n.js";

const isOpen = (s) => s === "Gesendet" || s === OVERDUE;
const sumTotal = (rows) => sumsByCurrency(rows, (r) => (statusOf(r) === "Storniert" ? 0 : totalsOf(r).total));
const customerOptions = () => [...all("customers")].sort((a, b) => a.nr - b.nr).map((c) => ({ value: c.id, label: customerLabel(c) }));
const label = (inv) => t("inv.label", { nr: inv.nr });

// ------------------------------------------------------------ Kennzahlen (Übersicht)

/** Offene (gesendet, noch nicht bezahlt) und überfällige Rechnungen: Anzahl und Betrag inkl. MWST, Beträge je Währung (nie über Währungen summiert) */
export function invoiceKpis(today = todayISO()) {
  const open = { n: 0, betrag: [] }, over = { n: 0, betrag: [] };
  const add = (box, cur, v) => { const e = box.betrag.find(([c]) => c === cur); if (e) e[1] += v; else box.betrag.push([cur, v]); };
  for (const inv of all("invoices") || []) {
    const s = statusOf(inv, today);
    if (!isOpen(s)) continue;
    const tot = totalsOf(inv).total, cur = docCurrency(inv);
    open.n++; add(open, cur, tot);
    if (s === OVERDUE) { over.n++; add(over, cur, tot); }
  }
  const order = (c) => { const i = INVOICE_CURRENCIES.indexOf(c); return i < 0 ? 9 : i; };
  open.betrag.sort((a, b) => order(a[0]) - order(b[0]));
  over.betrag.sort((a, b) => order(a[0]) - order(b[0]));
  return { open, over };
}

// ------------------------------------------------------------ Formular

/** Rechnung anlegen/bearbeiten. preset: Vorbelegung (z. B. aus einem Angebot). @returns gespeicherte Rechnung oder null */
export async function editInvoice(id = null, preset = {}) {
  const existing = id ? byId("invoices", id) : null;
  if (id && !existing) { toast(t("toast.recordNotFound"), { type: "error" }); return null; }
  const b = billingSettings();
  const values = existing
    ? clone(existing)
    : { status: "Entwurf", datum: todayISO(), faellig: addDays(todayISO(), b.zahlungsfristTage), positions: [], mwstAktiv: true, mwstSatz: b.mwstSatz, waehrung: DEFAULT_CURRENCY, bankId: "", ...clone(preset) };
  if (!INVOICE_CURRENCIES.includes(values.waehrung)) values.waehrung = DEFAULT_CURRENCY; // alte Rechnungen ohne Währung: CHF
  let faelligTouched = Boolean(existing);
  const f = (key, type, o = {}) => ({ key, type, label: t(`f.invoices.${key}`), ...o });
  const fields = [
    f("customerId", "select", { options: customerOptions, required: true, full: true }),
    f("dealId", "select", { dependsOn: ["customerId"], blank: t("form.none"), full: true, options: (v) => dealsOf(v.customerId).map((d) => ({ value: d.id, label: `${d.nr} · ${d.produkt}` })) }),
    f("datum", "date", { required: true }),
    f("faellig", "date", { required: true }),
    f("status", "select", { required: true, options: () => INVOICE_STATUS.map((v) => ({ value: v, label: tv("invStatus", v) })) }),
    f("referenz", "text", { placeholder: t("f.invoices.referenz.ph") }),
    f("waehrung", "select", { required: true, options: () => INVOICE_CURRENCIES.map((c) => ({ value: c, label: c })) }),
    // Bankkonto: automatisch das erste Konto der Rechnungswährung, bei mehreren Konten frei wählbar
    f("bankId", "select", {
      dependsOn: ["waehrung"],
      help: t("f.invoices.bankId.help"),
      blank: (v) => { const a = bankFor(b, v.waehrung || DEFAULT_CURRENCY); return a ? t("inv.bankAuto", { bank: a.bank || a.iban }) : t("inv.bankNone", { cur: v.waehrung || DEFAULT_CURRENCY }); },
      options: (v) => banksFor(b, v.waehrung || DEFAULT_CURRENCY).map((k) => ({ value: k.id, label: `${k.bank || ""} ${k.iban}`.trim() })),
    }),
    // MWST folgt bei neuen Rechnungen dem Land des Kunden (CH/LI mit MWST, sonst Export ohne MWST), bleibt aber von Hand änderbar
    positionsField({ vatDefault: true, vatAuto: { isNew: !existing, forCustomer: (cid) => vatForCustomer(byId("customers", cid)) } }),
    f("bemerkung", "textarea", { rows: 3, full: true }),
  ];
  let saved = null;
  await openForm({
    title: existing ? t("inv.editTitle", { nr: existing.nr }) : t("inv.newTitle"),
    subtitle: existing ? "" : t("inv.nrNext", { nr: peekInvoiceNr() }),
    fields,
    values,
    submitLabel: existing ? t("common.save") : t("inv.create"),
    validate: (v) => {
      const e = {};
      if (v.positions && !v.positions.positions?.length) e.positions = t("inv.err.noPositions");
      if (v.datum && v.faellig && v.faellig < v.datum) e.faellig = t("inv.err.dueBefore");
      if (existing && isRetainedInvoice(existing) && v.status === "Entwurf") e.status = t("inv.err.noDraft"); // sonst Umweg zum Löschen
      return e;
    },
    onChange(key, vals, api) {
      if (key === "faellig") faelligTouched = true;
      if (key === "datum" && !faelligTouched && vals.datum) api.set("faellig", addDays(vals.datum, b.zahlungsfristTage));
    },
    extra: existing && !isRetainedInvoice(existing) ? [{ label: t("common.delete"), danger: true, onClick: async ({ close }) => { if (await deleteInvoice(existing.id)) close(false); } }] : [],
    onSubmit(v) {
      v = unpackPositions({ ...v });
      if (v.status === "Bezahlt" && !(existing && existing.bezahltAm)) v.bezahltAm = todayISO();
      if (v.status !== "Bezahlt") v.bezahltAm = "";
      v.waehrung = INVOICE_CURRENCIES.includes(v.waehrung) ? v.waehrung : DEFAULT_CURRENCY;
      v.bankId = banksFor(b, v.waehrung).some((k) => k.id === v.bankId) ? v.bankId : ""; // Konto muss zur Währung passen
      if (existing) saved = update("invoices", existing.id, v);
      else saved = create("invoices", v);
      toast(existing ? t("inv.saved", { nr: saved.nr }) : t("inv.created", { nr: saved.nr }), { type: "ok" });
    },
  });
  if (saved && !existing) location.hash = `#/rechnungen/${saved.id}`;
  return saved;
}

/** «Rechnung erstellen»: Formular mit den Positionen (und MWST) des Angebots vorbelegt */
export function invoiceFromDeal(dealId) {
  const d = byId("deals", dealId);
  if (!d) { toast(t("toast.recordNotFound"), { type: "error" }); return null; }
  if (!d.positions?.length) { toast(t("inv.err.dealNoPositions"), { type: "error" }); return null; }
  const b = billingSettings();
  return editInvoice(null, {
    customerId: d.customerId,
    dealId: d.id,
    referenz: t("inv.refFromDeal", { nr: d.nr }),
    positions: d.positions.map((p) => ({ ...clone(p), id: undefined })),
    waehrung: INVOICE_CURRENCIES.includes(d.waehrung) ? d.waehrung : DEFAULT_CURRENCY, // Währung aus dem Angebot
    mwstAktiv: vatForCustomer(byId("customers", d.customerId)) ?? Boolean(d.mwstAktiv), // nach Land des Kunden, sonst wie im Angebot
    mwstSatz: Number(d.mwstSatz) > 0 ? Number(d.mwstSatz) : b.mwstSatz,
  });
}

/** Stornieren statt löschen (10 Jahre Aufbewahrung): Rechnung bleibt mit Nummer erhalten, zählt nicht mehr in Summen */
export async function cancelInvoice(id) {
  const inv = byId("invoices", id);
  if (!inv || inv.status === "Storniert") return false;
  const ok = await confirmDialog({
    title: t("inv.cancelTitle"),
    message: html`<p>${th("inv.cancelMsg", { label: html`<strong>${label(inv)}</strong>` })}</p>`,
    confirmLabel: t("inv.cancelConfirm"),
    danger: true,
  });
  if (!ok) return false;
  update("invoices", id, { status: "Storniert", bezahltAm: "" });
  toast(t("inv.cancelled", { nr: inv.nr }), { type: "ok" });
  return true;
}

export async function deleteInvoice(id) {
  const inv = byId("invoices", id);
  if (!inv) return false;
  if (isRetainedInvoice(inv)) { toast(t("inv.retention.invoice"), { type: "error" }); return false; }
  const ok = await confirmDialog({
    title: t("inv.deleteTitle"),
    message: html`<p>${th("inv.deleteMsg", { label: html`<strong>${label(inv)}</strong>` })}</p><p class="muted">${t("form.deleteIrreversible")}</p>`,
    confirmLabel: t("form.deleteConfirm"),
    danger: true,
  });
  if (!ok) return false;
  if (remove("invoices", id) === false) return false;
  toast(t("inv.deleted"));
  if (location.hash.includes(id)) location.hash = "#/rechnungen";
  return true;
}

// ------------------------------------------------------------ Liste

const STATUS_FILTER = () => [
  { value: "__open", label: t("inv.filterOpen") },
  ...["Entwurf", "Gesendet", OVERDUE, "Bezahlt", "Storniert"].map((v) => ({ value: v, label: tv("invStatus", v) })),
];

const listCfg = () => ({
  id: "invoices",
  title: t("inv.title"),
  intro: t("inv.intro"),
  noun: "invoices",
  rows: () => all("invoices") || [],
  search: (r) => [r.nr, byId("customers", r.customerId)?.firma, byId("customers", r.customerId)?.nr, r.referenz, r.bemerkung].join(" "),
  defaultSort: { key: "nr", dir: "desc" },
  newButton: { label: t("inv.new"), onClick: () => editInvoice() },
  rowHref: (r) => `#/rechnungen/${r.id}`,
  empty: t("inv.empty"),
  filters: [
    { key: "status", label: t("col.status"), options: STATUS_FILTER, test: (r, v) => (v === "__open" ? isOpen(statusOf(r)) : statusOf(r) === v) },
    { key: "kunde", label: t("ent.customers.singular"), options: customerOptions, test: (r, v) => r.customerId === v },
  ],
  columns: [
    { key: "nr", label: t("inv.nr"), sort: (r) => r.nr, cell: (r) => html`<span class="nr">${r.nr}</span>`, cls: "w-nr" },
    { key: "kunde", label: t("ent.customers.singular"), sort: (r) => byId("customers", r.customerId)?.firma || "", cell: (r) => customerLink(r.customerId), cls: "c-title" },
    { key: "datum", label: t("f.invoices.datum"), cls: "hide-lg", sort: (r) => r.datum, cell: (r) => fmtDate(r.datum) || dash },
    { key: "faellig", label: t("f.invoices.faellig"), sort: (r) => r.faellig, cell: (r) => dateCell(r.faellig, { done: !isOpen(statusOf(r)) }) },
    { key: "status", label: t("col.status"), sort: (r) => INVOICE_STATUS.indexOf(r.status), cell: (r) => invBadge(statusOf(r)) },
    { key: "referenz", label: t("f.invoices.referenz"), cls: "hide-lg", sort: (r) => r.referenz, cell: (r) => textCell(r.referenz) },
    { key: "netto", label: t("pos.tot.netto"), align: "right", cls: "hide-lg", sort: (r) => totalsOf(r).netto, cell: (r) => docMoney(r)(totalsOf(r).netto) },
    { key: "total", label: t("pos.tot.total"), align: "right", sort: (r) => totalsOf(r).total, cell: (r) => docMoney(r)(totalsOf(r).total), total: (rows) => sumTotal(rows) },
    { key: "print", label: "", cell: (r) => html`<a class="icon-btn" href="#/druck/rechnung/${r.id}" aria-label="${t("print.invoiceAria", { nr: r.nr })}" title="${t("print.open")}">${icon("download")}</a>` },
  ],
});

// ------------------------------------------------------------ Detail

function detail(root, id) {
  const inv = byId("invoices", id);
  if (!inv) {
    root.innerHTML = html`<a href="#/rechnungen" class="back">${icon("back")} ${t("nav.rechnungen")}</a><div class="card pad"><h2>${t("inv.notFound")}</h2></div>`.toString();
    return;
  }
  const c = byId("customers", inv.customerId);
  const deal = byId("deals", inv.dealId);
  const s = statusOf(inv);
  const tot = totalsOf(inv);
  const contact = c && primaryContact(c);
  root.innerHTML = html`
    ${crumbs([{ label: t("nav.rechnungen"), href: "#/rechnungen" }, { label: t("inv.label", { nr: inv.nr }) }])}
    <div class="page-head detail-head">
      <div>
        <h1>${t("inv.label", { nr: inv.nr })}</h1>
        <div class="chips">${invBadge(s)}${c ? html`<span class="muted">·</span> <a href="#/kunden/${c.id}">${c.firma}</a>` : ""}</div>
      </div>
      <div class="head-actions">
        ${s === "Entwurf" ? html`<button type="button" class="btn" data-act="mark-sent">${t("inv.markSent")}</button>` : ""}
        ${isOpen(s) ? html`<button type="button" class="btn btn-primary" data-act="mark-paid">${t("inv.markPaid")}</button>` : ""}
        <a class="btn" href="#/druck/rechnung/${inv.id}">${icon("download")} ${t("print.open")}</a>
        <button type="button" class="btn" data-act="edit">${icon("edit")} ${t("common.edit")}</button>
        ${isRetainedInvoice(inv)
          ? (s === "Storniert" ? "" : html`<button type="button" class="btn btn-danger-ghost" data-act="cancel">${icon("x")} ${t("inv.cancel")}</button>`)
          : html`<button type="button" class="btn btn-danger-ghost" data-act="delete">${icon("trash")} ${t("common.delete")}</button>`}
      </div>
    </div>
    <section class="card">
      <div class="card-head"><h2>${t("pos.title")} <span class="count-pill">${(inv.positions || []).length}</span></h2></div>
      ${positionsTable(inv.positions)}
      <div class="totals-wrap">${totalsBlock(inv)}</div>
    </section>
    <div class="detail-grid">
      <div class="col-main">
        <section class="card">
          <div class="card-head"><h2>${t("inv.details")}</h2></div>
          ${dl([
            [t("inv.nr"), inv.nr],
            [t("ent.customers.singular"), c ? html`<a href="#/kunden/${c.id}">${c.firma}</a>` : ""],
            [t("print.attn"), contact?.name || ""],
            [t("ent.deals.singular"), deal ? html`${deal.nr} · ${deal.produkt}` : ""],
            [t("f.invoices.datum"), fmtDate(inv.datum)],
            [t("f.invoices.faellig"), inv.faellig ? dateCell(inv.faellig, { done: !isOpen(s), rel: true }) : ""],
            [t("f.invoices.referenz"), inv.referenz],
            [t("inv.paidOn"), inv.status === "Bezahlt" ? fmtDate(inv.bezahltAm) : ""],
            [t("f.invoices.waehrung"), docCurrency(inv)],
            [t("f.invoices.bankId"), bankFor(billingSettings(), docCurrency(inv), inv.bankId)?.bank || ""],
            [t("pos.tot.total"), docMoney(inv)(tot.total)],
          ])}
          <p class="meta">${t("det.created", { at: fmtDateTime(inv.createdAt) })}${inv.createdBy ? " " + t("det.by", { name: inv.createdBy }) : ""}${inv.updatedAt && inv.updatedAt !== inv.createdAt ? html`<br>${t("det.changed", { at: fmtDateTime(inv.updatedAt) })}${inv.updatedBy ? " " + t("det.by", { name: inv.updatedBy }) : ""}` : ""}</p>
        </section>
      </div>
      <div class="col-side">
        ${inv.bemerkung ? html`<section class="card"><div class="card-head"><h2>${t("f.invoices.bemerkung")}</h2></div><div class="pad pre">${inv.bemerkung}</div></section>` : ""}
      </div>
    </div>`.toString();
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    switch (el.dataset.act) {
      case "edit": return editInvoice(id);
      case "delete": return deleteInvoice(id);
      case "cancel": return cancelInvoice(id);
      case "mark-sent": update("invoices", id, { status: "Gesendet" }); return toast(t("inv.markedSent", { nr: inv.nr }), { type: "ok" });
      case "mark-paid": update("invoices", id, { status: "Bezahlt", bezahltAm: todayISO() }); return toast(t("inv.markedPaid", { nr: inv.nr }), { type: "ok" });
    }
  });
}

export function render(root, route) {
  if (route.id) detail(root, route.id);
  else listView(listCfg()).render(root, route);
}
