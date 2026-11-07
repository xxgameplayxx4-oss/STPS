// Erfassen / Bearbeiten / Löschen von Datensätzen (Formulare, Schnellaktionen).
import { PHASE_CHANCE } from "./config.js";
import { all, byId, create, update, remove, dependents, batch, retainedInvoicesOf } from "./store.js";
import { ENT, CONTACT_FIELDS, contactsOf, primaryContact, dealsOf, warengruppeOf, marginInfo, normChance, deliveryAddresses, effectiveAddress, addressLines } from "./model.js";
import { fmtArtNr, parseArtNr, nextArtNr, nettoFrom, rabattFrom } from "./billing.js";
import { openForm, confirmDialog, toast } from "./ui.js";
import { html, th, todayISO, uid, clone, mailLink, telLink } from "./util.js";
import { t } from "./i18n.js";
import * as presence from "./presence.js";
import { positionsField, unpackPositions } from "./views/positions.js";
import { invoiceFromDeal } from "./views/invoices.js";
import { vatForCustomer } from "./views/docs.js";
import { docTotals } from "./billing.js";
import { categoriesField } from "./views/catpicker.js";
import { subOptions } from "./categories.js";
import { openMatch } from "./views/match.js";
import { certsField } from "./views/certs.js";

// ------------------------------------------------------------ Entität-spezifische Anpassungen

function rfqFields() {
  const f = ENT.rfqs.fields.map((x) => ({ ...x }));
  const by = (k) => f.find((x) => x.key === k);
  const contact = by("contactId");
  contact.dependsOn = ["supplierId"];
  contact.blank = (vals) => {
    const p = primaryContact(byId("suppliers", vals.supplierId));
    return p ? t("rfq.primaryContactNamed", { name: p.name }) : t("contact.primary");
  };
  contact.options = (vals) => contactsOf(byId("suppliers", vals.supplierId)).map((c) => ({ value: c.id, label: `${c.name}${c.funktion ? " – " + c.funktion : ""}${c.primary ? " ★" : ""}` }));
  const deal = by("dealId");
  deal.dependsOn = ["customerId"];
  deal.blank = t("form.none");
  deal.options = (vals) => dealsOf(vals.customerId).map((d) => ({ value: d.id, label: `${d.nr} · ${d.produkt}` }));
  // Vorschau der automatisch übernommenen Lieferantendaten (wie in der Excel-Vorlage)
  const info = {
    key: "_info", label: t("rfq.autoData"), type: "info", full: true, dependsOn: ["supplierId", "contactId"],
    render: (vals) => {
      const s = byId("suppliers", vals.supplierId);
      if (!s) return html`<span class="muted">${t("rfq.pickSupplier")}</span>`;
      const c = (vals.contactId && contactsOf(s).find((x) => x.id === vals.contactId)) || primaryContact(s);
      return html`<div><strong>${t("rfq.supplierNr", { nr: s.nr })}</strong> · ${s.firma}${s.ort ? html` · ${s.ort}` : ""}</div>
        ${c ? html`<div>${c.name}${c.funktion ? html` <span class="muted">(${c.funktion})</span>` : ""}</div><div>${c.email ? mailLink(c.email) : ""}${c.email && (c.telefon || c.mobile) ? " · " : ""}${c.telefon ? telLink(c.telefon) : ""}${c.mobile ? html` · ${telLink(c.mobile)}` : ""}</div>` : html`<div class="muted">${t("contact.none")}</div>`}`;
    },
  };
  f.splice(f.indexOf(contact) + 1, 0, info);
  return f;
}

/** Aktivität: Kontaktperson (Kunde und/oder Lieferant) wählbar – Verlauf pro Kontaktperson */
const contactChoices = (vals) => {
  const cust = byId("customers", vals.customerId), supp = byId("suppliers", vals.supplierId);
  const both = Boolean(cust && supp);
  const lab = (c, rec) => `${c.name}${c.funktion ? " – " + c.funktion : ""}${both ? ` (${rec.firma})` : ""}`;
  return [...contactsOf(cust).map((c) => ({ value: c.id, label: lab(c, cust) })), ...contactsOf(supp).map((c) => ({ value: c.id, label: lab(c, supp) }))];
};
function activityFields() {
  const f = ENT.activities.fields.map((x) => ({ ...x }));
  const contact = f.find((x) => x.key === "contactId");
  contact.dependsOn = ["customerId", "supplierId"];
  contact.blank = t("act.noContact");
  contact.options = contactChoices;
  return f;
}

/** Angebot: Positionen-Editor nach «Produkt»; mit Positionen ist der Angebotswert das Netto-Total (ohne MWST) */
function dealFields(existing) {
  const f = ENT.deals.fields.map((x) => ({ ...x }));
  const wert = f.find((x) => x.key === "wert");
  wert.help = t("pos.dealValueHelp");
  f.splice(f.findIndex((x) => x.key === "produkt") + 1, 0, positionsField({
    vatDefault: false,
    vatAuto: { isNew: !existing, forCustomer: (cid) => vatForCustomer(byId("customers", cid)) }, // neue Angebote: MWST nach Land des Kunden
    onTotals: (tot, n, api) => { if (n > 0) api.set("wert", tot.netto); },
  }));
  return f;
}

/** Produktkategorien (gemeinsamer Baum) nach dem Freitextfeld «Produkt» bzw. «Produkte»; Lieferanten: «Geprüft» nach dem Status, Dokumente/Zertifikate nach «Qualität» */
function customerFields() {
  const f = ENT.customers.fields.map((x) => ({ ...x }));
  f.splice(f.findIndex((x) => x.key === "produkt") + 1, 0, categoriesField(t("f.customers.kategorien")));
  return f;
}
function supplierFields() {
  const f = ENT.suppliers.fields.map((x) => ({ ...x }));
  f.splice(f.findIndex((x) => x.key === "produkte") + 1, 0, categoriesField(t("f.suppliers.kategorien")));
  f.splice(f.findIndex((x) => x.key === "qualitaet") + 1, 0, certsField());
  f.splice(f.findIndex((x) => x.key === "status") + 1, 0, { key: "geprueft", type: "checkbox", label: t("f.suppliers.geprueft"), help: t("f.suppliers.geprueft.help") });
  return f;
}
/** Artikel: Unterkategorie der gewählten Warengruppe */
function articleFields() {
  const f = ENT.articles.fields.map((x) => ({ ...x }));
  f.splice(f.findIndex((x) => x.key === "warengruppeId") + 1, 0, {
    key: "unterkategorieId", type: "select", label: t("f.articles.unterkategorieId"), full: true, dependsOn: ["warengruppeId"],
    blank: t("form.none"), options: (vals) => subOptions(vals.warengruppeId),
  });
  return f;
}

const FIELDS = {
  rfqs: rfqFields,
  activities: activityFields,
  deals: dealFields,
  customers: customerFields,
  suppliers: supplierFields,
  articles: articleFields,
};

/** Zusätzliche Schaltflächen im Formular eines bestehenden Datensatzes */
const dealExtras = (rec) => {
  const leave = async ({ close, isDirty }) => {
    if (isDirty() && !(await confirmDialog({ title: t("form.discardTitle"), message: t("form.discardMsg"), confirmLabel: t("form.discard"), cancelLabel: t("form.keepEditing"), danger: true }))) return false;
    close(false);
    return true;
  };
  return [
    { label: t("match.btn"), onClick: (c) => { if (rec.customerId) openMatch(rec.customerId, { dealId: rec.id }); } },
    { label: t("print.offerBtn"), onClick: async (c) => { if (await leave(c)) location.hash = `#/druck/offerte/${rec.id}`; } },
    { label: t("print.abBtn"), onClick: async (c) => { if (await leave(c)) location.hash = `#/druck/auftragsbestaetigung/${rec.id}`; } },
    { label: t("print.pfBtn"), onClick: async (c) => { if (await leave(c)) location.hash = `#/druck/proforma/${rec.id}`; } },
    { label: t("print.lsBtn"), onClick: async (c) => { if (await leave(c)) location.hash = `#/druck/lieferschein/${rec.id}`; } },
    { label: t("inv.createFromDeal"), onClick: async (c) => { if (await leave(c)) invoiceFromDeal(rec.id); } },
  ];
};

// Bei Phasenwechsel: Chance auf die Auswahl der neuen Phase abbilden (100/0 bei Abschluss), leer = Vorschlag je Phase
const chanceSuggest = (key, vals, api) => {
  if (key !== "phase") return;
  const v = normChance(vals.chance, vals.phase) ?? PHASE_CHANCE[vals.phase];
  if (v !== undefined && v !== null) api.set("chance", v);
};

const HOOKS = {
  articles: articleHooks,
  customers: {
    onChange: chanceSuggest,
    // Unternummern der Lieferadressen nie wiederverwenden: höchste je vergebene Nummer merken
    prepare(v) {
      v.addresses = Array.isArray(v.addresses) ? v.addresses : [];
      v.addrSeq = Math.max(Number(v.addrSeq) || 0, ...v.addresses.map((a) => Number(a.sub) || 0));
      return v;
    },
  },
  deals: {
    onChange(key, vals, api) {
      chanceSuggest(key, vals, api);
      // Lieferadresse aus dem Kundenstamm (WP1) in den Text der Auftragsbestätigung übernehmen; bleibt von Hand änderbar
      if (key === "customerId") { if (vals.lieferadresseId) api.set("lieferadresse", ""); api.set("lieferadresseId", ""); }
      if (key === "lieferadresseId" && vals.lieferadresseId) {
        const c = byId("customers", vals.customerId), a = deliveryAddresses(c).find((x) => x.id === vals.lieferadresseId);
        if (c && a) api.set("lieferadresse", [c.firma, ...addressLines(effectiveAddress(c, a))].join("\n"));
      }
    },
    // Positionen, MWST und Angebotswert aus dem Positionen-Editor in den Datensatz übernehmen
    prepare(v) {
      unpackPositions(v);
      v.positions = v.positions || [];
      if (v.positions.length) {
        v.wert = docTotals(v.positions, { mwstAktiv: v.mwstAktiv, mwstSatz: v.mwstSatz }).netto;
      } else {
        v.mwstAktiv = false;
        v.mwstSatz = 0;
      }
      return v;
    },
  },
  activities: {
    validate: (v) => (!v.customerId && !v.supplierId ? { customerId: t("val.customerOrSupplier"), supplierId: t("val.customerOrSupplier") } : {}),
    prepare(v) {
      // Kontaktperson muss zum gewählten Kunden/Lieferanten gehören
      if (v.contactId && !contactChoices(v).some((o) => o.value === v.contactId)) v.contactId = "";
      // Ohne nächsten Schritt ist die Aktivität abgeschlossen
      if (v.status === "Offen" && !v.naechsterSchritt && !v.faellig) v.status = "Erledigt";
      return v;
    },
    after(rec) {
      // "Letzter Kontakt" nachführen, wenn die Aktivität in der Vergangenheit/heute liegt
      if (!rec.datum || rec.datum > todayISO()) return;
      batch(() => {
        for (const [coll, id] of [["customers", rec.customerId], ["suppliers", rec.supplierId]]) {
          const r = byId(coll, id);
          if (r && (!r.letzterKontakt || r.letzterKontakt < rec.datum)) update(coll, id, { letzterKontakt: rec.datum });
        }
      });
    },
  },
  tasks: {
    prepare(v) {
      if (v.status === "Erledigt" && !v.erledigtAm) v.erledigtAm = todayISO();
      if (v.status !== "Erledigt") v.erledigtAm = "";
      return v;
    },
  },
};

/** Artikel: Nummer aus dem Bereich der Warengruppe, Brutto/Rabatt/Netto rechnen in beide Richtungen, Marge (intern) */
function articleHooks(existing) {
  const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    init(v) { if (typeof v.nr === "number") v.nr = fmtArtNr(v.nr); },
    onChange(key, vals, api) {
      if (key === "warengruppeId") {
        const g = warengruppeOf(vals.warengruppeId);
        const cur = parseArtNr(vals.nr);
        const inRange = g && cur !== null && cur >= g.von && cur <= g.bis;
        const taken = cur !== null && all("articles").some((a) => a.nr === cur && a.id !== existing?.id);
        if (g && (!inRange || taken)) {
          const n = nextArtNr(all("articles").filter((a) => a.id !== existing?.id), g);
          api.set("nr", n === null ? "" : fmtArtNr(n));
        }
      } else if (key === "brutto" || key === "rabatt") {
        const b = num(vals.brutto);
        if (b !== null) { vals.netto = nettoFrom(b, num(vals.rabatt) || 0); api.set("netto", vals.netto); }
      } else if (key === "netto") {
        const n = num(vals.netto), b = num(vals.brutto);
        if (n !== null && b !== null && b > 0) { vals.rabatt = rabattFrom(b, n); api.set("rabatt", vals.rabatt); }
        else if (n !== null && !b) { vals.brutto = n; vals.rabatt = 0; api.set("brutto", n); api.set("rabatt", 0); }
      }
      const info = api.form.querySelector('[data-info="_margin"]');
      if (info) info.innerHTML = marginInfo({ ...vals, ek: num(vals.ek), netto: num(vals.netto) }).toString();
    },
    validate(v) {
      const err = {};
      const n = parseArtNr(v.nr);
      const g = warengruppeOf(v.warengruppeId);
      if (!g) err.warengruppeId = t("art.val.noGroup");
      if (n === null) err.nr = g && !String(v.nr).trim() ? t("art.val.rangeFull") : t("art.val.nrInvalid");
      else if (g && (n < g.von || n > g.bis)) err.nr = t("art.val.nrRange", { von: fmtArtNr(g.von), bis: fmtArtNr(g.bis) });
      else if (all("articles").some((a) => a.nr === n && a.id !== existing?.id)) err.nr = t("art.val.nrDup", { nr: fmtArtNr(n) });
      return err;
    },
    prepare(v) {
      v.nr = parseArtNr(v.nr);
      v.rabatt = num(v.rabatt) ?? 0;
      v.customerId = v.customerId || null;
      v.supplierId = v.supplierId || null;
      v.unterkategorieId = v.unterkategorieId || "";
      if (v.netto === null) v.netto = nettoFrom(v.brutto || 0, v.rabatt);
      return v;
    },
  };
}

// ------------------------------------------------------------ Anwesenheit: «bearbeitet gerade» (siehe presence.js)

const ROUTES = { customers: "kunden", suppliers: "lieferanten", articles: "artikel" };
const nrOf = (ent, rec) => (ent.fmtNr ? ent.fmtNr(rec.nr) : String(rec.nr));
function editPresence(coll, existing, preset, ent) {
  const related = [existing?.customerId, existing?.supplierId, preset.customerId, preset.supplierId].filter(Boolean);
  return presence.beginEdit({
    spec: existing
      ? { key: "pres.editRecord", params: { kind: coll, nr: existing.nr ? nrOf(ent, existing) : "", name: ent.title(existing) } }
      : { key: "pres.newRecord", params: { kind: coll } },
    recordId: existing?.id || "",
    relatedIds: related,
    ...(existing && ROUTES[coll] ? { route: `#/${ROUTES[coll]}/${existing.id}` } : {}),
  });
}

// ------------------------------------------------------------ Generisch

/**
 * Datensatz anlegen/bearbeiten. preset: Vorbelegung bei neuem Datensatz (z. B. { customerId }).
 * @returns {Promise<object|null>} gespeicherter Datensatz oder null
 */
export async function editRecord(coll, id = null, preset = {}) {
  const ent = ENT[coll];
  const existing = id ? byId(coll, id) : null;
  if (id && !existing) { toast(t("toast.recordNotFound"), { type: "error" }); return null; }
  const values = existing ? clone(existing) : { ...ent.defaults(), ...clone(preset) };
  const hooks = (typeof HOOKS[coll] === "function" ? HOOKS[coll](existing) : HOOKS[coll]) || {};
  hooks.init?.(values);
  const fields = FIELDS[coll] ? FIELDS[coll](existing) : ent.fields;
  let result = null;
  const endEdit = editPresence(coll, existing, preset, ent);
  await openForm({
    title: existing ? t("form.editTitle", { entity: ent.singular }) : t("form.newTitle", { entity: ent.singular }),
    subtitle: existing && existing.nr ? `${ent.nrLabel} ${nrOf(ent, existing)}` : "",
    fields,
    values,
    validate: hooks.validate,
    onChange: hooks.onChange,
    submitLabel: existing ? t("common.save") : t("form.create", { entity: ent.singular, entityLc: ent.singularLc }),
    extra: existing ? [...(coll === "deals" ? dealExtras(existing) : []), { label: t("common.delete"), danger: true, onClick: async ({ close }) => { if (await deleteRecord(coll, id, { navigate: true })) close(false); } }] : [],
    async onSubmit(vals) {
      if (hooks.prepare) vals = hooks.prepare(vals);
      delete vals._info;
      result = existing ? update(coll, id, vals) : create(coll, vals);
      hooks.after?.(result);
      toast(existing ? t("toast.saved", { entity: ent.singular }) : result.nr ? t("toast.createdNr", { entity: ent.singular, nr: nrOf(ent, result) }) : t("toast.created", { entity: ent.singular }), { type: "ok" });
    },
  });
  endEdit();
  return result;
}

/** Löschen mit In-App-Bestätigung. */
export async function deleteRecord(coll, id, { navigate = false } = {}) {
  const ent = ENT[coll];
  const rec = byId(coll, id);
  if (!rec) return false;
  if (coll === "customers" && retainedInvoicesOf(id).length) { toast(t("inv.retention.customer", { n: retainedInvoicesOf(id).length }), { type: "error" }); return false; } // 10 Jahre Aufbewahrung
  const deps = dependents(coll, id);
  const depList = Object.entries(deps);
  const label = coll === "rfqs" || coll === "focus" ? ent.title(rec) : t("form.entityLabel", { entity: ent.singular, title: ent.title(rec) });
  const ok = await confirmDialog({
    title: t("form.deleteTitle", { entity: ent.singular, entityLc: ent.singularLc }),
    message: html`<p>${th("form.deleteMsg", { label: html`<strong>${label}</strong>` })}</p>${depList.length ? html`<p>${t("form.deleteAlso")}</p><ul>${depList.map(([k, n]) => html`<li>${t("dep." + k)}: ${n}</li>`)}</ul>` : ""}<p class="muted">${t("form.deleteIrreversible")}</p>`,
    confirmLabel: t("form.deleteConfirm"),
    danger: true,
  });
  if (!ok) return false;
  if (remove(coll, id) === false) return false;
  toast(t("toast.deleted", { entity: ent.singular }));
  if (navigate && ["customers", "suppliers", "deals", "articles"].includes(coll) && location.hash.includes(id)) location.hash = "#/" + ent.route;
  return true;
}

// ------------------------------------------------------------ Aufgaben-Schnellaktion

export function toggleTask(id) {
  toggleDone("tasks", id);
}

/** Aufgabe oder Aktivität erledigt/offen setzen (Aufgaben merken sich zusätzlich «Erledigt am») */
export function toggleDone(coll, id) {
  const rec = byId(coll, id);
  if (!rec || (coll !== "tasks" && coll !== "activities")) return;
  if (rec.status === "Erledigt") update(coll, id, coll === "tasks" ? { status: "Offen", erledigtAm: "" } : { status: "Offen" });
  else update(coll, id, coll === "tasks" ? { status: "Erledigt", erledigtAm: todayISO() } : { status: "Erledigt" });
}

// ------------------------------------------------------------ Kontaktpersonen

export async function editContact(coll, recId, contactId = null) {
  const rec = byId(coll, recId);
  if (!rec) return;
  const existing = contactId ? contactsOf(rec).find((c) => c.id === contactId) : null;
  const fields = [...CONTACT_FIELDS, { key: "primary", label: t("contact.primaryHelp"), type: "checkbox" }];
  const values = existing ? { ...existing } : { primary: !contactsOf(rec).length };
  const endEdit = presence.beginEdit({
    spec: { key: existing ? "pres.editContact" : "pres.newContact", params: { name: rec.firma } },
    recordId: recId, route: `#/${ROUTES[coll]}/${recId}`,
  });
  await openForm({
    title: existing ? t("contact.editTitle") : t("contact.newTitle"),
    subtitle: rec.firma,
    fields,
    values,
    submitLabel: existing ? t("common.save") : t("common.add"),
    validate: (v) => (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ? { email: t("val.emailInvalidShort") } : {}),
    extra: existing ? [{ label: t("common.delete"), danger: true, onClick: async ({ close }) => { if (await deleteContact(coll, recId, contactId)) close(false); } }] : [],
    onSubmit(v) {
      const list = clone(contactsOf(rec));
      const c = { id: existing?.id || uid(), name: v.name, funktion: v.funktion, email: v.email, telefon: v.telefon, mobile: v.mobile, notiz: v.notiz, primary: v.primary, rechnung: Boolean(v.rechnung) };
      const i = list.findIndex((x) => x.id === c.id);
      if (i >= 0) list[i] = c; else list.push(c);
      if (c.primary) list.forEach((x) => { x.primary = x.id === c.id; });
      if (c.rechnung) list.forEach((x) => { x.rechnung = x.id === c.id; }); // genau ein Rechnungskontakt (Buchhaltung)
      if (!list.some((x) => x.primary)) list[0].primary = true;
      update(coll, recId, { contacts: list });
      toast(t("toast.contactSaved"), { type: "ok" });
    },
  });
  endEdit();
}

export async function deleteContact(coll, recId, contactId) {
  const rec = byId(coll, recId);
  const c = contactsOf(rec).find((x) => x.id === contactId);
  if (!c) return false;
  const ok = await confirmDialog({
    title: t("contact.deleteTitle"),
    message: html`<p>${th("contact.deleteMsg", { name: html`<strong>${c.name}</strong>`, firma: rec.firma })}</p>`,
    confirmLabel: t("common.delete"),
    danger: true,
  });
  if (!ok) return false;
  const list = contactsOf(rec).filter((x) => x.id !== contactId);
  if (list.length && !list.some((x) => x.primary)) list[0] = { ...list[0], primary: true };
  update(coll, recId, { contacts: list });
  // Zuordnungen, die diese Kontaktperson gewählt hatten, fallen auf den Hauptkontakt zurück; im Verlauf bleibt die Aktivität am Kunden/Lieferanten
  batch(() => {
    if (coll === "suppliers") for (const r of rfqsUsing(recId, contactId)) update("rfqs", r.id, { contactId: "" });
    for (const a of all("activities")) if (a.contactId === contactId) update("activities", a.id, { contactId: "" });
    if (coll === "customers") {
      const addrs = deliveryAddresses(byId("customers", recId));
      if (addrs.some((a) => a.contactId === contactId)) update("customers", recId, { addresses: addrs.map((a) => (a.contactId === contactId ? { ...a, contactId: "" } : a)) });
    }
  });
  toast(t("toast.contactDeleted"));
  return true;
}

const rfqsUsing = (supplierId, contactId) => all("rfqs").filter((r) => r.supplierId === supplierId && r.contactId === contactId);

export function setPrimaryContact(coll, recId, contactId) {
  const rec = byId(coll, recId);
  const list = contactsOf(rec).map((c) => ({ ...c, primary: c.id === contactId }));
  update(coll, recId, { contacts: list });
  toast(t("toast.primaryChanged"));
}

