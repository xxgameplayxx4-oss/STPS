// Datenmodell: Felder der Tabellen (Formulare, CSV), berechnete Werte, Beziehungen, Badge-Farben.
import * as C from "./config.js";
import { ROUTE as TASKLOG_ROUTE } from "./tasklog.js";
import { all, byId, getList, ownerNames, getUser, getBilling, getFx } from "./store.js";
import { FX_CURS, convert, roundFx } from "./fx.js";
import { html, chf, money, fmtDate, fmtPct, fmtNum, price, todayISO } from "./util.js";
import { t, tv, tvAny, getLang } from "./i18n.js";
import { COUNTRIES, countryName } from "./countries.js";
import { SHIP_STATUS, CARRIERS, safeUrl } from "./logistics.js";
import { INVOICE_STATUS, fmtArtNr, nextArtNr, margin, dueDate, DEFAULT_MWST_SATZ, INVOICE_CURRENCIES } from "./billing.js";

// ------------------------------------------------------------ Listen als Funktionen (dynamisch editierbar)

// Optionen als {value, label}: value = gespeicherter (deutscher) Wert, label = Anzeige in der gewählten Sprache
const opts = (group, arr) => arr.map((v) => ({ value: v, label: tv(group, v) }));

export const L = {
  owners: () => ownerNames(),
  quellen: () => opts("source", getList("quellen")),
  aktivitaetstypen: () => opts("actType", getList("aktivitaetstypen")),
  kundenstatus: () => opts("custStatus", getList("kundenstatus")),
  kundenphasen: () => opts("phase", C.KUNDENPHASEN),
  lieferantenphasen: () => opts("phase", C.LIEFERANTENPHASEN),
  prioritaeten: () => C.PRIORITAETEN,
  lieferantenstatus: () => opts("suppStatus", C.LIEFERANTENSTATUS),
  aufgabenstatus: () => opts("taskStatus", C.AUFGABENSTATUS),
  waehrungen: () => C.WAEHRUNGEN,
  pipelineWaehrungen: () => C.PIPELINE_WAEHRUNGEN,
  bewertungen: () => C.BEWERTUNGEN,
  jaNein: () => opts("yesNo", C.JA_NEIN),
  versandstatus: () => opts("shipStatus", SHIP_STATUS),
  spediteure: () => opts("carrier", CARRIERS),
  rechnungsstatus: () => opts("invStatus", INVOICE_STATUS),
  // Länder (Pflichtfeld Land): value = Ländercode, label = «CH · Schweiz»
  laender: () => COUNTRIES.map((c) => ({ value: c.code, label: `${c.code} · ${countryName(c.code, getLang())}` })),
  // Warengruppen (Einstellungen): value = id der Warengruppe
  warengruppen: () => getBilling().warengruppen.map((g) => ({ value: g.id, label: wgLabel(g) })),
};

/** «A · Warengruppe A (100.001–100.100)» */
export const wgLabel = (g) => (g ? `${g.code}${g.name ? ` · ${g.name}` : ""} (${fmtArtNr(g.von)}–${fmtArtNr(g.bis)})` : "");
/** «A · Kunststoffteile» (ohne Bereich) */
export const warengruppeLabel = (g) => (g ? [g.code, g.name].filter(Boolean).join(" · ") : "");
export const warengruppeOf = (id) => getBilling().warengruppen.find((g) => g.id === id);
export const articlesOf = (kind, id) => all("articles").filter((a) => a[kind + "Id"] === id);

// ------------------------------------------------------------ Badges

const TONES = {
  // Kunden- und Lieferantenphasen
  "Akquise": "grey",
  "Termin erhalten": "sky",
  "Angebot erstellt": "blue",
  "Angebot gesendet": "navy",
  "Verhandlung Angebot": "amber",
  "Abschluss Ja": "green",
  "Abschluss Nein": "red",
  "Lieferant zugeordnet": "grey",
  "Angebot erhalten": "teal",
  // Status
  "Lead": "grey", "Prospect": "sky", "Aktiver Kunde": "green", "Inaktiv": "grey", "Verloren": "red",
  "Aktiv": "green", "In Prüfung": "amber", "Gesperrt": "red",
  "Versendet": "blue", "Unterwegs": "sky", "Zugestellt": "green", "Verzögert": "red", // Lieferverfolgung (logistics.js)
  "Offen": "blue", "In Arbeit": "amber", "Erledigt": "green", "Blockiert": "red",
  // Prioritäten
  "A": "red", "B": "amber", "C": "grey",
  // Rechnungen («Überfällig» ist abgeleitet, siehe billing.invoiceStatus)
  "Entwurf": "grey", "Gesendet": "blue", "Bezahlt": "green", "Storniert": "grey", "Überfällig": "red",
};
export const tone = (v) => TONES[v] || "grey";
/** Badge: gespeicherter Wert bestimmt die Farbe, die Anzeige ist übersetzt. Eigene Werte (Listen in den Einstellungen) bleiben unverändert. */
export const badge = (text, toneName) => (text ? html`<span class="badge t-${toneName || tone(text)}">${tvAny(text)}</span>` : "");
export const prio = (p) => (p ? html`<span class="prio p-${p}" title="${t("prio.title", { p })}">${p}</span>` : "");
export function stars(n) {
  const v = Number(n) || 0;
  if (!v) return "";
  const label = t("stars.of", { n: v });
  return html`<span class="stars" title="${label}"><span aria-hidden="true">${"★".repeat(v)}</span><span class="stars-off" aria-hidden="true">${"★".repeat(5 - v)}</span><span class="sr">${label}</span></span>`;
}

// ------------------------------------------------------------ Hilfen zu Datensätzen

export const customerLabel = (c) => (c ? `${c.nr} · ${c.firma}` : "");
export const supplierLabel = (s) => (s ? `${s.nr} · ${s.firma}` : "");
export const articleLabel = (a) => (a ? `${fmtArtNr(a.nr)} · ${a.bezeichnung}` : "");
export const invoiceLabel = (i) => (i ? t("ent.invoices.title", { nr: i.nr }) : "");
export const contactsOf = (rec) => rec?.contacts || [];
export const primaryContact = (rec) => {
  const cs = contactsOf(rec);
  return cs.find((c) => c.primary) || cs[0] || null;
};
/** Rechnungskontakt (Buchhaltung): erster als «Buchhaltung» markierter Kontakt, sonst der Hauptkontakt */
export const billingContact = (rec) => contactsOf(rec).find((c) => c.rechnung) || primaryContact(rec);

// ---- Adressen eines Kunden: Stammadresse (strasse/plz/ort/land) = Rechnungsadresse, dazu Lieferadressen (addresses) mit Unternummer 10000.1, .2 …
export const countryLabel = (code) => (code ? countryName(code, getLang()) : "");
export const deliveryAddresses = (c) => (Array.isArray(c?.addresses) ? c.addresses : []);
/** Rechnungsadresse (Stammdaten) */
export const billingAddress = (c) => ({ strasse: c?.strasse || "", plz: c?.plz || "", ort: c?.ort || "", land: c?.land || "" });
/** Wirksame Adresse einer Lieferadresse («gleich wie Rechnungsadresse» → Stammadresse) */
export const effectiveAddress = (c, a) => (a.same ? billingAddress(c) : { strasse: a.strasse || "", plz: a.plz || "", ort: a.ort || "", land: a.land || "" });
/** «10000.1» (ohne Kundennummer: «.1») */
export const addressNr = (c, a) => `${c?.nr ?? ""}.${a.sub}`;
/** Adresszeilen: Strasse, «PLZ Ort», Land (Name) */
export function addressLines(addr, { country = true } = {}) {
  return [addr.strasse, [addr.plz, addr.ort].filter(Boolean).join(" "), country ? countryLabel(addr.land) : ""].filter(Boolean);
}
export const addressLabel = (c, a) => [a.bezeichnung || t("addr.delivery"), addressNr(c, a)].filter(Boolean).join(" · ");
/** Aktive Lieferadressen (für Auswahl in Offerten/Aufträgen) */
export const activeDeliveryAddresses = (c) => deliveryAddresses(c).filter((a) => a.aktiv !== false);
export const rfqContact = (rfq) => {
  const s = byId("suppliers", rfq.supplierId);
  if (!s) return null;
  return (rfq.contactId && contactsOf(s).find((c) => c.id === rfq.contactId)) || primaryContact(s);
};

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** Wahrscheinlichkeit: feste Auswahl 20/40/60/80 (Abschluss Ja/Nein = 100/0), Logik in config.js (auch vom Speichern/Import genutzt) */
export const normChance = C.normChance;
const chanceOptions = (vals) => (vals.phase === "Abschluss Ja" ? [100] : vals.phase === "Abschluss Nein" ? [0] : C.CHANCES).map((v) => ({ value: v, label: fmtPct(v) }));
export const weightedCustomer = (c) => (num(c.potenzial) === null || num(c.chance) === null ? null : (c.potenzial * normChance(c.chance, c.phase)) / 100);
export const weightedDeal = (d) => (num(d.wert) === null || num(d.chance) === null ? null : (d.wert * normChance(d.chance, d.phase)) / 100);

// Währungen: Beträge werden nie über Währungen hinweg summiert (leer = CHF, wie bei Altdaten)
export const curOf = (r) => r?.waehrung || "CHF";
/** Summe je Währung: [[«CHF», 1200], [«EUR», 300]] (CHF zuerst, dann EUR, USD, übrige); Zeilen ohne Betrag zählen nicht */
export function sumByCur(rows, f) {
  const m = new Map();
  for (const r of rows) { const v = f(r); if (num(v) !== null) m.set(curOf(r), (m.get(curOf(r)) || 0) + Number(v)); }
  const order = (c) => { const i = ["CHF", "EUR", "USD"].indexOf(c); return i < 0 ? 9 : i; };
  return [...m].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
}
/** Eine Zeile je Währung (html); ohne Beträge «CHF 0» bzw. empty */
export function curLines(entries, { empty = "CHF 0", always = false } = {}) {
  const list = entries.filter(([, v]) => v || always);
  if (!list.length) return empty ? html`<span class="cur-line">${empty}</span>` : "";
  return html`<span class="cur-lines">${list.map(([c, v]) => html`<span class="cur-line" data-cur="${c}">${money(v, c)}</span>`)}</span>`;
}
/** Betrag einer Zeile mit eigener Währung */
export const amt = (r, v) => (v === null || v === undefined || v === "" ? "" : money(v, curOf(r)));

// Mehrwährungs-Anzeige (WP-C): jeder Wert in drei Zeilen CHF / EUR / USD. Die Originalwährung steht fett ohne «≈», die anderen sind mit den
// Kursen aus den Einstellungen (js/fx.js, Basis CHF) umgerechnet und mit «≈» gekennzeichnet. Gespeichert wird nur der Originalbetrag.
const fxTip = () => { const fx = getFx(); return fx.date ? t("fx.tip", { date: fmtDate(fx.date), eur: fx.EUR, usd: fx.USD }) : t("fx.tipDefault", { eur: fx.EUR, usd: fx.USD }); };
/** Betrag einer Zeile als drei Zeilen (html); leer, wenn kein Betrag. Währungen ausser CHF/EUR/USD (z. B. VND) bleiben einzeilig. */
export function amt3(r, v) {
  if (num(v) === null) return "";
  const cur = curOf(r);
  if (!FX_CURS.includes(cur)) return html`<span class="fx3"><span class="fx-line orig" data-cur="${cur}">${money(v, cur)}</span></span>`;
  const fx = getFx();
  return html`<span class="fx3" title="${fxTip()}">${FX_CURS.map((c) => c === cur
    ? html`<span class="fx-line orig" data-cur="${c}" title="${t("fx.orig")}">${money(v, c)}</span>`
    : html`<span class="fx-line conv" data-cur="${c}"><span class="fx-approx" aria-hidden="true">≈</span> ${money(roundFx(convert(v, cur, c, fx)), c)}</span>`)}</span>`;
}
/** Vorschau im Formular (Kunde: potenzial/angebot, Angebot: wert) */
export function fxInfo(vals) {
  const parts = ["wert", "potenzial", "angebot"].filter((k) => num(vals[k]) !== null);
  if (!parts.length) return html`<span class="muted">${t("fx.formHint")}</span>`;
  return html`${parts.map((k) => amt3({ waehrung: vals.waehrung }, vals[k]))}`;
}
/** Summen (aus sumByCur) in allen drei Währungen: alles über CHF umgerechnet; ≈ vor jeder Zeile */
export function fxTotalLines(entries, { empty = "CHF 0" } = {}) {
  const list = entries.filter(([, v]) => v);
  if (!list.length) return empty ? html`<span class="cur-line">${empty}</span>` : "";
  const fx = getFx();
  const other = list.filter(([c]) => !FX_CURS.includes(c));
  const lines = FX_CURS.map((to) => [to, list.filter(([c]) => FX_CURS.includes(c)).reduce((s, [c, v]) => s + convert(v, c, to, fx), 0)]);
  return html`<span class="cur-lines fx-total" title="${fxTip()}">${lines.map(([c, v]) => html`<span class="cur-line" data-cur="${c}"><span class="fx-approx" aria-hidden="true">≈</span> ${money(roundFx(v), c)}</span>`)}${other.map(([c, v]) => html`<span class="cur-line" data-cur="${c}">${money(v, c)}</span>`)}</span>`;
}
/** Kennzahl-Zeilen je nach Modus: "cur" = nach Währung (je Währung eine Zeile), "conv" = umgerechnet in CHF/EUR/USD */
export const kpiLines = (entries, mode, opts) => (mode === "conv" ? fxTotalLines(entries, opts) : curLines(entries, opts));

export const isClosedPhase = (p) => p === "Abschluss Ja" || p === "Abschluss Nein";
export const isTaskDone = (t) => t.status === "Erledigt";
export const isTaskOpen = (t) => t.status === "Offen" || t.status === "In Arbeit"; // wie Excel-KPI
export const isActivityDone = (a) => a.status === "Erledigt";

// Beziehungen
export const dealsOf = (cid) => all("deals").filter((d) => d.customerId === cid);
export const rfqsOfCustomer = (cid) => all("rfqs").filter((r) => r.customerId === cid);
export const rfqsOfSupplier = (sid) => all("rfqs").filter((r) => r.supplierId === sid);
export const activitiesOf = (kind, id) => all("activities").filter((a) => a[kind + "Id"] === id);
export const tasksOf = (kind, id) => all("tasks").filter((t) => t[kind + "Id"] === id);

export const nameOf = (coll, id) => {
  const r = byId(coll, id);
  return r ? r.firma : "";
};

// ------------------------------------------------------------ Feldtypen für Formulare

const customerOptions = () =>
  [...all("customers")].sort((a, b) => a.nr - b.nr).map((c) => ({ value: c.id, label: customerLabel(c) }));
const supplierOptions = () =>
  [...all("suppliers")].sort((a, b) => a.nr - b.nr).map((s) => ({ value: s.id, label: supplierLabel(s) }));
const dealOptions = () =>
  [...all("deals")].sort((a, b) => a.nr - b.nr).map((d) => ({ value: d.id, label: `${d.nr} · ${d.produkt || ""}${byId("customers", d.customerId) ? ` (${byId("customers", d.customerId).firma})` : ""}` }));

// ------------------------------------------------------------ Beschriftungen aus den Wörterbüchern
// Felder und Entitäten werden einmal beim Laden angelegt; Beschriftungen, Hilfetexte und Platzhalter sind Getter und werden
// beim Zugriff übersetzt (beim Öffnen eines Formulars bzw. beim Zeichnen einer Seite) – so wirkt der Sprachwechsel sofort.

const lazy = (obj, name, fn) => Object.defineProperty(obj, name, { get: fn, enumerable: true, configurable: true });

/** Formularfeld: Beschriftung f.<coll>.<key>, optional Hilfetext (.help), Platzhalter (.ph), Leer-Option (blank = Schlüssel) */
function fld(coll, key, type, o = {}) {
  const { help, placeholder, blank, ...rest } = o;
  const f = { key, type, ...rest };
  lazy(f, "label", () => t(`f.${coll}.${key}`));
  if (help) lazy(f, "help", () => t(`f.${coll}.${key}.help`));
  if (placeholder) lazy(f, "placeholder", () => t(`f.${coll}.${key}.ph`));
  if (blank) lazy(f, "blank", () => t(blank));
  return f;
}

/** Nur anzeigendes Feld (Vorschau im Formular) */
function infoField(coll, key, o) {
  const f = { key, type: "info", ...o };
  lazy(f, "label", () => t(`f.${coll}.${key}`));
  return f;
}

function entity(coll, o) {
  const e = { coll, ...o };
  for (const k of ["singular", "singularLc", "plural", "pluralLc"]) lazy(e, k, () => t(`ent.${coll}.${k}`));
  lazy(e, "nrLabel", () => (o.hasNr ? t(`ent.${coll}.nr`) : ""));
  return e;
}

/** Marge-Vorschau im Artikelformular (intern: der Kunde sieht den Einkaufspreis nie) */
export function marginInfo(vals) {
  const ek = vals.ek, netto = vals.netto;
  if (ek === null || ek === undefined || ek === "" || netto === null || netto === undefined || netto === "") return html`<span class="muted">${t("art.marginHint")}</span>`;
  const m = margin({ ek: Number(ek), netto: Number(netto) });
  return html`<strong class="${m.betrag < 0 ? "neg" : ""}">${t("art.marginValue", { betrag: price(m.betrag, vals.waehrung || "CHF"), prozent: fmtNum(m.prozent, 1) })}</strong> <span class="muted">${t("art.internalOnly")}</span>`;
}

const CONTACT = (key, type, o) => fld("contact", key, type, o);
export const CONTACT_FIELDS = [
  CONTACT("name", "text", { required: true, full: true }),
  CONTACT("funktion", "text"),
  CONTACT("email", "email"),
  CONTACT("telefon", "tel"),
  CONTACT("mobile", "tel"),
  CONTACT("notiz", "textarea", { rows: 2, full: true }),
  CONTACT("rechnung", "checkbox", { help: true }),
];

// ------------------------------------------------------------ Entitäten

export const ENT = {
  customers: entity("customers", {
    route: "kunden", hasNr: true,
    title: (r) => r.firma,
    defaults: () => ({ prioritaet: "B", phase: "Akquise", status: "Lead", waehrung: "CHF", land: "CH", owner: getUser(), contacts: [], addresses: [] }),
    fields: [
      fld("customers", "firma", "text", { required: true, full: true }),
      fld("customers", "strasse", "text", { full: true }),
      fld("customers", "plz", "text"),
      fld("customers", "ort", "text"),
      fld("customers", "land", "select", { options: L.laender, required: true }),
      fld("customers", "prioritaet", "select", { options: L.prioritaeten }),
      fld("customers", "status", "select", { options: L.kundenstatus }),
      fld("customers", "phase", "select", { options: L.kundenphasen, required: true }),
      fld("customers", "owner", "select", { options: L.owners }),
      fld("customers", "produkt", "text", { full: true }),
      fld("customers", "waehrung", "select", { options: L.pipelineWaehrungen, required: true, normalize: (v) => v || "CHF" }),
      fld("customers", "potenzial", "money"),
      fld("customers", "angebot", "money"),
      infoField("customers", "_fx", { full: true, dependsOn: ["potenzial", "angebot", "waehrung"], render: fxInfo }),
      fld("customers", "chance", "select", { options: chanceOptions, numeric: true, normalize: (v, vals) => normChance(v, vals.phase), dependsOn: ["phase"], help: true }),
      fld("customers", "quelle", "select", { options: L.quellen }),
      fld("customers", "naechsterSchritt", "text", { full: true }),
      fld("customers", "termin", "date"),
      fld("customers", "followUp", "date"),
      fld("customers", "erstkontakt", "date"),
      fld("customers", "letzterKontakt", "date"),
      fld("customers", "kommentar", "textarea", { rows: 3, full: true }),
      fld("customers", "addresses", "addresses", { full: true }),
      fld("customers", "contacts", "contacts", { full: true }),
    ],
  }),
  suppliers: entity("suppliers", {
    route: "lieferanten", hasNr: true,
    title: (r) => r.firma,
    defaults: () => ({ status: "In Prüfung", owner: getUser(), contacts: [] }),
    fields: [
      fld("suppliers", "firma", "text", { required: true, full: true }),
      fld("suppliers", "ort", "text"),
      fld("suppliers", "status", "select", { options: L.lieferantenstatus, required: true }),
      fld("suppliers", "produkte", "textarea", { rows: 2, full: true }),
      fld("suppliers", "qualitaet", "textarea", { rows: 2, full: true }),
      fld("suppliers", "owner", "select", { options: L.owners }),
      fld("suppliers", "bewertung", "select", { options: L.bewertungen }),
      fld("suppliers", "seit", "date"),
      fld("suppliers", "zahlungskonditionen", "text"),
      fld("suppliers", "letzterKontakt", "date"),
      fld("suppliers", "followUp", "date"),
      fld("suppliers", "notiz", "textarea", { rows: 8, full: true, help: true }),
      fld("suppliers", "contacts", "contacts", { full: true }),
    ],
  }),
  articles: entity("articles", {
    route: "artikel", hasNr: true,
    fmtNr: fmtArtNr,
    title: (r) => r.bezeichnung,
    defaults: () => {
      const g = getBilling().warengruppen[0];
      const nr = g ? nextArtNr(all("articles"), g) : null;
      return { warengruppeId: g?.id || "", nr: nr ? fmtArtNr(nr) : "", einheit: "Stk", waehrung: "CHF", rabatt: 0, ek: null, brutto: null, netto: null, customerId: null, supplierId: null };
    },
    fields: [
      fld("articles", "warengruppeId", "select", { options: L.warengruppen, required: true, full: true, help: true }),
      fld("articles", "nr", "text", { required: true, help: true }),
      fld("articles", "einheit", "text"),
      fld("articles", "bezeichnung", "text", { required: true, full: true }),
      fld("articles", "beschreibung", "textarea", { rows: 3, full: true }),
      fld("articles", "customerId", "select", { options: customerOptions, blank: "form.noCustomer", full: true }),
      fld("articles", "supplierId", "select", { options: supplierOptions, blank: "form.noSupplier", full: true }),
      fld("articles", "lieferantenArtNr", "text"),
      fld("articles", "waehrung", "select", { options: L.waehrungen }),
      fld("articles", "ek", "money", { help: true }),
      fld("articles", "brutto", "money"),
      fld("articles", "rabatt", "percent"),
      fld("articles", "netto", "money", { help: true }),
      infoField("articles", "_margin", { full: true, dependsOn: ["ek", "brutto", "rabatt", "netto", "waehrung"], render: marginInfo }),
      fld("articles", "notiz", "textarea", { rows: 3, full: true }),
    ],
  }),
  rfqs: entity("rfqs", {
    route: "zuordnung",
    title: (r) => `${nameOf("customers", r.customerId)} ↔ ${nameOf("suppliers", r.supplierId)}`,
    defaults: () => ({ phase: "Lieferant zugeordnet", waehrung: "CHF", contactId: "" }),
    fields: [
      fld("rfqs", "customerId", "select", { options: customerOptions, required: true, full: true }),
      fld("rfqs", "supplierId", "select", { options: supplierOptions, required: true, full: true }),
      fld("rfqs", "contactId", "select", { options: null, full: true, help: true }),
      fld("rfqs", "dealId", "select", { options: null, full: true }),
      fld("rfqs", "produkt", "text", { full: true }),
      fld("rfqs", "phase", "select", { options: L.lieferantenphasen, required: true }),
      fld("rfqs", "waehrung", "select", { options: L.waehrungen }),
      fld("rfqs", "gesendetAm", "date"),
      fld("rfqs", "erhaltenAm", "date"),
      fld("rfqs", "angebot", "money"),
      fld("rfqs", "moq", "text"),
      fld("rfqs", "leadTime", "text", { placeholder: true }),
      // Lieferverfolgung (R13, siehe logistics.js) – nur intern, für Kunden nie mit Lieferantenbezug
      fld("rfqs", "versandStatus", "select", { options: L.versandstatus, blank: "log.noStatus" }),
      fld("rfqs", "versandAm", "date"),
      fld("rfqs", "lieferungErwartet", "date"),
      fld("rfqs", "spediteur", "select", { options: L.spediteure, blank: "log.noCarrier" }),
      fld("rfqs", "trackingNr", "text"),
      fld("rfqs", "trackingLink", "text", { full: true, placeholder: true, validate: (v) => (v && !safeUrl(v) ? t("log.err.link") : "") }),
      fld("rfqs", "naechsterSchritt", "text", { full: true }),
      fld("rfqs", "kommentar", "textarea", { rows: 3, full: true }),
    ],
  }),
  deals: entity("deals", {
    route: "angebote", hasNr: true,
    title: (r) => r.produkt || t("ent.deals.fallbackTitle", { nr: r.nr }),
    defaults: () => ({ phase: "Angebot erstellt", waehrung: "CHF", owner: getUser() }),
    fields: [
      fld("deals", "customerId", "select", { options: customerOptions, required: true, full: true }),
      fld("deals", "produkt", "text", { required: true, full: true }),
      fld("deals", "erstellt", "date"),
      fld("deals", "gesendet", "date"),
      fld("deals", "waehrung", "select", { options: L.pipelineWaehrungen, required: true, normalize: (v) => v || "CHF" }),
      fld("deals", "wert", "money"),
      infoField("deals", "_fx", { full: true, dependsOn: ["wert", "waehrung"], render: fxInfo }),
      fld("deals", "phase", "select", { options: L.kundenphasen, required: true }),
      fld("deals", "chance", "select", { options: chanceOptions, numeric: true, normalize: (v, vals) => normChance(v, vals.phase), dependsOn: ["phase"] }),
      fld("deals", "erwarteterAbschluss", "date"),
      fld("deals", "owner", "select", { options: L.owners }),
      fld("deals", "liefertermin", "date"),
      fld("deals", "lieferadresseId", "select", { dependsOn: ["customerId"], full: true, help: true, blank: "deal.addrNone", options: (v) => activeDeliveryAddresses(byId("customers", v.customerId)).map((a) => ({ value: a.id, label: addressLabel(byId("customers", v.customerId), a) })) }),
      fld("deals", "lieferadresse", "textarea", { rows: 4, full: true, help: true }),
      fld("deals", "naechsterSchritt", "text", { full: true }),
      fld("deals", "kommentar", "textarea", { rows: 3, full: true }),
    ],
  }),
  invoices: entity("invoices", {
    route: "rechnungen", hasNr: true,
    title: (r) => invoiceLabel(r),
    defaults: () => {
      const b = getBilling();
      const datum = todayISO();
      return { datum, faellig: dueDate(datum, b.zahlungsfristTage), status: "Entwurf", mwstAktiv: true, mwstSatz: b.mwstSatz ?? DEFAULT_MWST_SATZ, waehrung: "CHF", bankId: "", dealId: null, positions: [] };
    },
    fields: [
      fld("invoices", "customerId", "select", { options: customerOptions, required: true, full: true }),
      fld("invoices", "dealId", "select", { options: dealOptions, blank: "form.noDeal", full: true }),
      fld("invoices", "datum", "date", { required: true }),
      fld("invoices", "faellig", "date"),
      fld("invoices", "status", "select", { options: L.rechnungsstatus, required: true }),
      fld("invoices", "referenz", "text"),
      fld("invoices", "waehrung", "select", { options: () => INVOICE_CURRENCIES.map((c) => ({ value: c, label: c })) }),
      fld("invoices", "mwstAktiv", "checkbox"),
      fld("invoices", "mwstSatz", "percent"),
      fld("invoices", "bemerkung", "textarea", { rows: 3, full: true }),
    ],
  }),
  activities: entity("activities", {
    route: TASKLOG_ROUTE, hasNr: true,
    title: (r) => `${r.typ ? tv("actType", r.typ) : t("ent.activities.singular")} ${fmtDate(r.datum)}`,
    defaults: () => ({ datum: todayISO(), typ: "Telefon", owner: getUser(), status: "Offen" }),
    fields: [
      fld("activities", "datum", "date", { required: true }),
      fld("activities", "typ", "select", { options: L.aktivitaetstypen, required: true }),
      fld("activities", "ort", "text", { placeholder: true }),
      fld("activities", "customerId", "select", { options: customerOptions, blank: "form.noCustomer", full: true }),
      fld("activities", "supplierId", "select", { options: supplierOptions, blank: "form.noSupplier", full: true }),
      fld("activities", "contactId", "select", { options: null, full: true, help: true }),
      fld("activities", "owner", "select", { options: L.owners, required: true }),
      fld("activities", "notiz", "textarea", { rows: 4, full: true }),
      fld("activities", "naechsterSchritt", "text", { full: true }),
      fld("activities", "faellig", "date"),
      fld("activities", "status", "select", { options: L.aufgabenstatus, required: true, help: true }),
    ],
  }),
  tasks: entity("tasks", {
    route: TASKLOG_ROUTE, hasNr: true,
    title: (r) => r.aufgabe,
    defaults: () => ({ owner: getUser(), prioritaet: "B", status: "Offen" }),
    fields: [
      fld("tasks", "aufgabe", "text", { required: true, full: true }),
      fld("tasks", "faellig", "date", { required: true }),
      fld("tasks", "owner", "select", { options: L.owners, required: true }),
      fld("tasks", "customerId", "select", { options: customerOptions, blank: "form.noCustomer", full: true }),
      fld("tasks", "supplierId", "select", { options: supplierOptions, blank: "form.noSupplier", full: true }),
      fld("tasks", "prioritaet", "select", { options: L.prioritaeten }),
      fld("tasks", "status", "select", { options: L.aufgabenstatus, required: true }),
      fld("tasks", "erledigtAm", "date"),
      fld("tasks", "kommentar", "textarea", { rows: 3, full: true }),
    ],
  }),
  focus: entity("focus", {
    route: "uebersicht",
    title: (r) => nameOf("customers", r.customerId),
    defaults: () => ({ diese: "Ja" }),
    fields: [
      fld("focus", "customerId", "select", { options: customerOptions, required: true, full: true }),
      fld("focus", "blocker", "text", { full: true }),
      fld("focus", "diese", "select", { options: L.jaNein }),
      fld("focus", "owner", "select", { options: L.owners }),
      fld("focus", "kommentar", "textarea", { rows: 3, full: true }),
    ],
  }),
  approvals: entity("approvals", {
    route: "uebersicht",
    title: (r) => r.thema,
    defaults: () => ({ status: "Offen" }),
    fields: [
      fld("approvals", "thema", "text", { required: true, full: true }),
      fld("approvals", "customerId", "select", { options: customerOptions, blank: "form.noCustomer", full: true }),
      fld("approvals", "entscheidung", "textarea", { rows: 3, full: true }),
      fld("approvals", "termin", "date"),
      fld("approvals", "status", "select", { options: L.aufgabenstatus, required: true }),
    ],
  }),
};

/** Anzeigewert für Pipeline-Beträge (Excel-Format) */
export const fmt = { chf, money, fmtDate, fmtPct };
