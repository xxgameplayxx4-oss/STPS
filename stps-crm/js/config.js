// Zentrale Konfiguration: Listen (Dropdowns), Phasen, Nummernkreise, Dashboard-Definitionen.
// Spiegelt das Tabellenblatt "Listen" der Excel-Vorlage STPS_CRM_v.1.0.
// Die Listenwerte (Phasen, Status …) sind gespeicherte Daten und bleiben deutsch; ihre Anzeige übersetzt i18n.js (tv).
import { t } from "./i18n.js";
import { ROUTE as TASKLOG_ROUTE } from "./tasklog.js";

export const APP = {
  name: "KGC CRM",
  schema: 1,
  version: "1.0.0",
};

// Standard-Darstellung: Wortmarke «KGC CRM», kein Untertitel (Plattform, Superadmin immer, Anmeldeseite eines neuen Geräts).
// Ein Team ohne eigene Einstellungen hat dasselbe Logo und Marineblau, aber seinen Teamnamen.
// full: heller Hintergrund (Anmeldeseite) · symbol: Ladeanzeige und Seitenleiste auf heller Farbe · side: dunkle Seitenleiste · icon: Symbol im Browser-Tab
export const DEFAULT_BRAND = {
  name: "KGC CRM",
  color: "#0b2340", // Marineblau der Seitenleiste (--navy in app.css)
  full: "kgc-logo-full.svg",
  symbol: "kgc-favicon.svg",
  side: "kgc-logo-symbol-white.svg",
  icon: "kgc-favicon.svg",
};

// Anmeldeseite ohne Teamdarstellung (neues Gerät, zuletzt war der Superadmin angemeldet): Logo und Name von SwissTech Precision Solutions,
// nicht «KGC CRM». Gilt nur für die Anmeldeseite (Titel und Symbol des Tabs inklusive); nach der Anmeldung gilt die Darstellung wie bisher.
export const LOGIN_BRAND = { name: "SwissTech Precision Solutions", full: "logo-full.svg", icon: "favicon.svg" };

// Nummernkreise: nächste Nummer = max(vorhandene, zuletzt vergebene) + 1, nie wiederverwendet.
export const NR_BASE = {
  customers: 10000,
  suppliers: 20000,
  activities: 30000,
  deals: 40000,
  tasks: 50000,
};

export const COLLECTIONS = ["customers", "suppliers", "rfqs", "deals", "activities", "tasks", "focus", "approvals", "articles", "invoices"];

// Rechnungsnummern: ab settings.billing.invoiceStart; der Zähler (meta.lastNr.invoices) sorgt dafür, dass eine Nummer nie wiederverwendet wird.
// Artikelnummern vergibt js/billing.js aus den Nummernbereichen der Warengruppen.
export const COUNTED = [...Object.keys(NR_BASE), "invoices"];

// ------------------------------------------------------------ Feste Listen (steuern Dashboard-Logik)

export const KUNDENPHASEN = [
  "Akquise",
  "Termin erhalten",
  "Angebot erstellt",
  "Angebot gesendet",
  "Verhandlung Angebot",
  "Abschluss Ja",
  "Abschluss Nein",
];

export const LIEFERANTENPHASEN = [
  "Lieferant zugeordnet",
  "Angebot gesendet",
  "Angebot erhalten",
  "Verhandlung Angebot",
  "Abschluss Ja",
  "Abschluss Nein",
];

export const PRIORITAETEN = ["A", "B", "C"];
export const JA_NEIN = ["Ja", "Nein"];
export const LIEFERANTENSTATUS = ["Aktiv", "In Prüfung", "Gesperrt", "Inaktiv"];
export const AUFGABENSTATUS = ["Offen", "In Arbeit", "Erledigt", "Blockiert"];
// Rechnungsstatus (gespeichert) und abgeleitetes «Überfällig»: Definition in billing.js. Anzeige: val.invStatus.<Wert>
export { INVOICE_STATUS as RECHNUNGSSTATUS, OVERDUE } from "./billing.js";
export const WAEHRUNGEN = ["CHF", "EUR", "USD", "VND"];
// Währungen für Kunden-Potenzial und Angebote (Pipeline); Standard CHF, nie summiert über Währungen hinweg
export const PIPELINE_WAEHRUNGEN = ["CHF", "EUR", "USD"];
// Wahrscheinlichkeit offener Phasen: feste Auswahl; Abschluss Ja/Nein = 100/0 (automatisch)
export const CHANCES = [20, 40, 60, 80];
export const BEWERTUNGEN = ["1", "2", "3", "4", "5"];

// Vorschlag für "Chance %" beim Phasenwechsel (nur wenn das Feld noch leer ist)
export const PHASE_CHANCE = {
  "Akquise": 20,
  "Termin erhalten": 20,
  "Angebot erstellt": 40,
  "Angebot gesendet": 40,
  "Verhandlung Angebot": 60,
  "Abschluss Ja": 100,
  "Abschluss Nein": 0,
};

// ------------------------------------------------------------ Editierbare Listen (in Einstellungen)

export const DEFAULT_LISTS = {
  owners: [
    { name: "Pascal", role: "Kunden & Closing" },
    { name: "Liz", role: "Lieferanten & Preise / RFQs" },
    { name: "Marco", role: "Admin & Freigaben" },
  ],
  quellen: ["Empfehlung Marco", "LinkedIn", "Google / Website", "Messe / Event", "Bestehendes Netzwerk", "Direktanfrage", "Sonstiges"],
  aktivitaetstypen: ["Akquise", "E-Mail", "Telefon", "Termin", "Notiz", "Follow-up", "Angebot", "Verhandlung"],
  kundenstatus: ["Lead", "Prospect", "Aktiver Kunde", "Inaktiv", "Verloren"],
};

// Beschriftung und Hinweis der Listen stehen in den Wörterbüchern: list.<name>.label / list.<name>.hint

// ------------------------------------------------------------ Dashboard

// Kundenpipeline (Blatt "Shopfloor"): Phase (gespeicherter deutscher Wert); Beschriftung: pipe.cust.<Phase>
export const CUSTOMER_PIPELINE = [
  { phase: "Akquise" },
  { phase: "Termin erhalten" },
  { phase: "Angebot erstellt" },
  { phase: "Angebot gesendet" },
  { phase: "Verhandlung Angebot" },
  { phase: "Abschluss Ja" },
  { phase: "Abschluss Nein" },
];

// Beschriftung: pipe.supp.<Phase>
export const SUPPLIER_PIPELINE = [
  { phase: "Lieferant zugeordnet" },
  { phase: "Angebot gesendet" },
  { phase: "Angebot erhalten" },
  { phase: "Verhandlung Angebot" },
  { phase: "Abschluss Ja" },
  { phase: "Abschluss Nein" },
];

// who: Name der Person (null = alle); Text: agenda.<n>
export const SHOPFLOOR_AGENDA = [
  { who: "Pascal", n: 1 },
  { who: "Liz", n: 2 },
  { who: "Marco", n: 3 },
  { who: null, n: 4 },
  { who: null, n: 5 },
];

export const MAX_FOCUS = 10; // Blatt "Shopfloor": 10 Plätze im wöchentlichen Kundenfokus

// ------------------------------------------------------------ Navigation

// server: nur im Servermodus (Konten/Team) · superOnly: nur für den Plattform-Administrator (Superadmin)
// Beschriftung: navLabel(route) → nav.<route>
export const NAV = [
  { route: "plattform", icon: "shield", superOnly: true },
  { route: "uebersicht", icon: "home" },
  { route: "kalender", icon: "calendar", server: true },
  { route: "chat", icon: "chatlines", server: true },
  { route: "kunden", icon: "users" },
  { route: "angebote", icon: "file" },
  { route: "artikel", icon: "box" },
  { route: "rechnungen", icon: "receipt" },
  { route: "lieferanten", icon: "factory" },
  { route: "zuordnung", icon: "link" },
  { route: TASKLOG_ROUTE, icon: "check" }, // Aufgaben & Aktivitäten (früher «aktivitaeten» und «aufgaben», siehe LEGACY_ROUTES)
  { route: "team", icon: "team", server: true },
  { route: "einstellungen", icon: "gear" },
];
export const navLabel = (route) => t(`nav.${route}`);

// ------------------------------------------------------------ localStorage-Schlüssel

export const LS = {
  token: "stps-crm:token",
  user: "stps-crm:user", // nur Lokaler Modus: «Ich bin» (im Servermodus kommt der Benutzer vom Konto)
  me: "stps-crm:me", // zuletzt angemeldetes Konto (für den Offline-Start)
  team: "stps-crm:team", // sessionStorage: vom Superadmin betretenes Team
  lastUser: "stps-crm:last-user", // zuletzt eingegebener Benutzername (Komfort im Login-Formular)
  branding: "stps-crm:branding", // Darstellung des zuletzt angemeldeten Teams auf diesem Gerät (Lade- und Anmeldeseite); Superadmin: Standard
  cache: "stps-crm:cache", // Server-Modus: letzter bekannter Stand (je Team: «:<teamId>» angehängt)
  local: "stps-crm:local-db", // Lokaler Modus: einzige Datenhaltung
  wasServer: "stps-crm:was-server",
  push: "stps-crm:push:", // + Benutzer-ID: Benachrichtigungen auf diesem Gerät für dieses Konto gewünscht ("1")
  cal: "stps-crm:cal", // Kalender: zuletzt gewählte Ansicht (Monat/Liste), Listenfilter, CRM-Fristen ein/aus
};
