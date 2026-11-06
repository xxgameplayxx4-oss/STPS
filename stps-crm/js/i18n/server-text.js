// Englische Fassung der deutschen Hinweise des Servers (Excel-Import: Vorschau-Hinweise, Dateifehler; SharePoint-Diagnose).
// Der Server liefert diese Texte deutsch (stabile Nachrichten, die Tests prüfen); der Browser übersetzt sie bei Sprache «en» per Muster.
// Unbekannte Texte bleiben unverändert (deutsch) – das ist besser als eine falsche Übersetzung.

const NOUN = { "Kundennr.": "Customer no.", "Lieferantennr.": "Supplier no.", "Kunde": "customer", "Lieferant": "supplier" };
const noun = (n) => NOUN[n] ?? n;

/** [Muster, Funktion(Treffer) → Text]. «…» (Guillemets) umschliessen Namen aus der Datei und bleiben unverändert. */
const RULES = [
  // ---- Umwandlungsfehler einer Zelle
  [/^«(.*)» ist keine gültige Nummer$/s, (m) => `«${m[1]}» is not a valid number`],
  [/^«(.*)» ist kein gültiges Datum \(TT\.MM\.JJJJ erwartet\)$/s, (m) => `«${m[1]}» is not a valid date (DD.MM.YYYY expected)`],
  [/^«(.*)» ist kein gültiges Datum$/s, (m) => `«${m[1]}» is not a valid date`],
  [/^«(.*)» ist kein gültiger Betrag$/s, (m) => `«${m[1]}» is not a valid amount`],
  [/^«(.*)» ist kein gültiger Prozentwert$/s, (m) => `«${m[1]}» is not a valid percentage`],
  [/^Chance «(.*)» liegt nicht zwischen 0 und 100 %$/s, (m) => `Probability «${m[1]}» is not between 0 and 100 %`],
  [/^Bewertung «(.*)» liegt nicht zwischen 1 und 5$/s, (m) => `Rating «${m[1]}» is not between 1 and 5`],
  [/^«(.*)» ist weder Ja noch Nein$/s, (m) => `«${m[1]}» is neither Yes nor No`],
  [/^«(.*)» ist kein gültiger Wert für «(.*)» \(erlaubt: (.*)\)$/s, (m) => `«${m[1]}» is not a valid value for «${m[2]}» (allowed: ${m[3]})`],

  // ---- Blatt / Zeile
  [/^Blatt «(.*)»: Kopfzeile nicht gefunden \(erwartet u\. a\. «(.*)»\) – Blatt übersprungen$/s, (m) => `Sheet «${m[1]}»: header row not found (expected e.g. «${m[2]}») – sheet skipped`],
  [/^Blatt «(.*)»: nur die ersten (\d+) Zeilen gelesen$/s, (m) => `Sheet «${m[1]}»: only the first ${m[2]} rows were read`],
  [/^Unbekannte Werte in «(.*)» \(trotzdem übernommen\): (.*)$/s, (m) => `Unknown values in «${m[1]}» (imported anyway): ${m[2]}`],
  [/^… und (\d+) weitere Hinweise$/, (m) => `… and ${m[1]} more notes`],

  // ---- Kunden / Lieferanten
  [/^(Kundennr\.|Lieferantennr\.) (\d+) liegt ausserhalb des Nummernkreises (\S+) – Nummer ignoriert$/, (m) => `${noun(m[1])} ${m[2]} is outside the number range ${m[3]} – number ignored`],
  [/^Firma fehlt – Zeile übersprungen$/, () => "Company name missing – row skipped"],
  [/^Firma fehlt – als «(.*)» übernommen, bitte im CRM ergänzen$/s, (m) => `Company name missing – imported as «${m[1]}», please complete it in the CRM`],
  [/^«(.*)» ist im CRM mehrfach vorhanden – (Kundennr\.|Lieferantennr\.) (\d+) verwendet$/s, (m) => `«${m[1]}» exists several times in the CRM – ${noun(m[2])} ${m[3]} used`],
  [/^(Kundennr\.|Lieferantennr\.) (\d+) nicht im CRM – «(.*)» über den Namen der (Kundennr\.|Lieferantennr\.) (\d+) zugeordnet$/s, (m) => `${noun(m[1])} ${m[2]} not in the CRM – «${m[3]}» matched by name to ${noun(m[4])} ${m[5]}`],
  [/^«(.*)» kommt mehrfach in der Datei vor – Angaben zusammengeführt$/s, (m) => `«${m[1]}» appears several times in the file – details merged`],
  [/^(Kundennr\.|Lieferantennr\.) (\d+) – Firma wird geändert \(Excel: «(.*)»\)$/s, (m) => `${noun(m[1])} ${m[2]} – company name will change (Excel: «${m[3]}»)`],
  [/^(Kundennr\.|Lieferantennr\.) (\d+) ist bereits vergeben – «(.*)» erhält (\d+)$/s, (m) => `${noun(m[1])} ${m[2]} is already taken – «${m[3]}» gets ${m[4]}`],

  // ---- Kontakte
  [/^Kunde\/Lieferant nicht gefunden \((.*)\) – «(.*)» übersprungen$/s, (m) => `Customer/supplier not found (${m[1] === "ohne Angabe" ? "not specified" : m[1]}) – «${m[2]}» skipped`],
  [/^Name, E-Mail und Telefon fehlen – Zeile übersprungen$/, () => "Name, email and phone missing – row skipped"],

  // ---- Angebote
  [/^Kunde (.*) nicht gefunden – Angebot übersprungen$/s, (m) => `Customer ${ref(m[1])} not found – offer skipped`],
  [/^Angebotsnr\. (\d+) liegt ausserhalb des Nummernkreises – Nummer ignoriert$/, (m) => `Offer no. ${m[1]} is outside the number range – number ignored`],
  [/^Angebotsnr\. (\d+) gehört im CRM zu einem anderen Kunden – wird als neues Angebot behandelt$/, (m) => `Offer no. ${m[1]} belongs to a different customer in the CRM – treated as a new offer`],
  [/^Angebot «(.*)» kommt mehrfach in der Datei vor – Angaben zusammengeführt$/s, (m) => `Offer «${m[1]}» appears several times in the file – details merged`],
  [/^Angebotsnr\. (\d+) ist bereits vergeben – neue Nr\. (\d+)$/, (m) => `Offer no. ${m[1]} is already taken – new no. ${m[2]}`],

  // ---- Lieferantenzuordnung
  [/^Kunde (.*) nicht gefunden – Zuordnung übersprungen$/s, (m) => `Customer ${ref(m[1])} not found – assignment skipped`],
  [/^Lieferant «(.*)» war nicht im Lieferantenstamm – als Lieferantennr\. (\d+) neu angelegt$/s, (m) => `Supplier «${m[1]}» was not in the supplier master – created as supplier no. ${m[2]}`],
  [/^Lieferant (.*) nicht im Lieferantenstamm gefunden – Zuordnung übersprungen$/s, (m) => `Supplier ${ref(m[1])} not found in the supplier master – assignment skipped`],
  [/^Angebotsnr\. (.*) gehört nicht zu diesem Kunden – Verknüpfung ignoriert$/s, (m) => `Offer no. ${m[1]} does not belong to this customer – link ignored`],
  [/^Zuordnung Kunde (\d+) ↔ Lieferant (\d+) kommt mehrfach in der Datei vor – Angaben zusammengeführt$/, (m) => `Assignment customer ${m[1]} ↔ supplier ${m[2]} appears several times in the file – details merged`],

  // ---- Aktivitäten
  [/^Datum fehlt – Aktivität übersprungen$/, () => "Date missing – activity skipped"],
  [/^Kunde (.*) nicht gefunden$/s, (m) => `Customer ${ref(m[1])} not found`],
  [/^Lieferant (.*) nicht gefunden$/s, (m) => `Supplier ${ref(m[1])} not found`],
  [/^Weder Kunde noch Lieferant zugeordnet – Aktivität übersprungen$/, () => "Neither customer nor supplier assigned – activity skipped"],
  [/^Aktivitätsnr\. (\d+) liegt ausserhalb des Nummernkreises – Nummer ignoriert$/, (m) => `Activity no. ${m[1]} is outside the number range – number ignored`],
  [/^Aktivitätsnr\. (\d+) gehört im CRM zu einer anderen Aktivität – wird als neu behandelt$/, (m) => `Activity no. ${m[1]} belongs to a different activity in the CRM – treated as new`],
  [/^Aktivität (\d+) kommt mehrfach in der Datei vor – Angaben zusammengeführt$/, (m) => `Activity ${m[1]} appears several times in the file – details merged`],
  [/^Aktivitätsnr\. (\d+) ist bereits vergeben – neue Nr\. (\d+)$/, (m) => `Activity no. ${m[1]} is already taken – new no. ${m[2]}`],

  // ---- Aufgaben
  [/^Aufgabe fehlt – Zeile übersprungen$/, () => "Task missing – row skipped"],
  [/^Kunde (.*) nicht gefunden – Aufgabe «(.*)» ohne Kunden-Verknüpfung$/s, (m) => `Customer ${ref(m[1])} not found – task «${m[2]}» has no customer link`],
  [/^Lieferant (.*) nicht gefunden – Aufgabe «(.*)» ohne Lieferanten-Verknüpfung$/s, (m) => `Supplier ${ref(m[1])} not found – task «${m[2]}» has no supplier link`],
  [/^Fälligkeitsdatum fehlt – Aufgabe «(.*)» trotzdem übernommen$/s, (m) => `Due date missing – task «${m[1]}» imported anyway`],
  [/^Aufgabennr\. (\d+) liegt ausserhalb des Nummernkreises – Nummer ignoriert$/, (m) => `Task no. ${m[1]} is outside the number range – number ignored`],
  [/^Aufgabennr\. (\d+) gehört im CRM zu einer anderen Aufgabe – wird als neu behandelt$/, (m) => `Task no. ${m[1]} belongs to a different task in the CRM – treated as new`],
  [/^Aufgabe (\d+) kommt mehrfach in der Datei vor – Angaben zusammengeführt$/, (m) => `Task ${m[1]} appears several times in the file – details merged`],
  [/^Aufgabennr\. (\d+) ist bereits vergeben – neue Nr\. (\d+)$/, (m) => `Task no. ${m[1]} is already taken – new no. ${m[2]}`],

  // ---- Wochenfokus / Freigaben
  [/^Kunde (.*) nicht gefunden – Eintrag übersprungen$/s, (m) => `Customer ${ref(m[1])} not found – entry skipped`],
  [/^Der Wochenfokus ist auf (\d+) Plätze begrenzt – «(.*)» übersprungen$/s, (m) => `The weekly focus is limited to ${m[1]} slots – «${m[2]}» skipped`],
  [/^Thema fehlt – Zeile übersprungen$/, () => "Topic missing – row skipped"],
  [/^Kunde (.*) nicht gefunden – «(.*)» ohne Kunden-Verknüpfung$/s, (m) => `Customer ${ref(m[1])} not found – «${m[2]}» has no customer link`],

  // ---- Dateifehler (Excel-Import)
  [/^Die Datei ist keine gültige \.xlsx-Datei \(Excel-Arbeitsmappe\)\. Ältere \.xls- und \.csv-Dateien bitte in Excel als \.xlsx speichern\.$/, () => "The file is not a valid .xlsx file (Excel workbook). Please save older .xls and .csv files as .xlsx in Excel."],
  [/^Die Datei ist beschädigt \(Zip-Verzeichnis nicht gefunden\)\.$/, () => "The file is damaged (zip directory not found)."],
  [/^Die Datei ist beschädigt \(Zip-Verzeichnis\)\.$/, () => "The file is damaged (zip directory)."],
  [/^Die Datei ist zu gross oder ungewöhnlich aufgebaut \(Zip64\)\.$/, () => "The file is too large or unusually structured (Zip64)."],
  [/^Die Datei enthält ungewöhnlich viele Teile\.$/, () => "The file contains an unusually large number of parts."],
  [/^Die Datei ist entpackt zu gross \(über 200 MB\)\.$/, () => "The file is too large when unpacked (over 200 MB)."],
  [/^Die Datei konnte nicht gelesen werden \((.*)\)\. Bitte als \.xlsx speichern\.$/s, (m) => `The file could not be read (${m[1]}). Please save it as .xlsx.`],
  [/^Die Datei enthält keines der erwarteten Blätter \((.*)\)\. Ist es die STPS-CRM-Vorlage\?$/s, (m) => `The file contains none of the expected sheets (${m[1]}). Is it the STPS CRM template?`],
  [/^Die Datei in SharePoint ist zu gross \(über 25 MB\)\.$/, () => "The file in SharePoint is too large (over 25 MB)."],
  [/^Die Datei ist leer$/, () => "The file is empty"],
  [/^Die Datei fehlt \(Feld contentBase64\)$/, () => "The file is missing (field contentBase64)"],
  [/^Ungültige Anfrage$/, () => "Invalid request"],
  [/^Daten wurden von jemand anderem geändert – bitte die Vorschau neu öffnen$/, () => "The data was changed by someone else – please reopen the preview"],
  [/^Die Datei hat sich seit der Vorschau geändert – bitte die Vorschau neu öffnen$/, () => "The file has changed since the preview – please reopen the preview"],
  [/^Keine Änderungen – die Datei enthält nichts Neues$/, () => "No changes – the file contains nothing new"],

  // ---- SharePoint-Diagnose (nur Superadmin)
  [/^Es gibt noch keine Daten zum Exportieren\.$/, () => "There is no data to export yet."],
  [/^SP_SITE ist leer$/, () => "SP_SITE is empty"],
  [/^SP_SITE ungültig – erwartet z\. B\. (.*)$/s, (m) => `SP_SITE invalid – expected e.g. ${m[1]}`],
  [/^MS_TENANT_ID ungültig \(Verzeichnis-\/Mandanten-ID erwartet\)$/, () => "MS_TENANT_ID invalid (directory/tenant ID expected)"],
  [/^Microsoft Graph ist nicht erreichbar \(Netzwerkfehler\) – bitte später erneut versuchen$/, () => "Microsoft Graph is unreachable (network error) – please try again later"],
  [/^Unerwartete Antwort von Microsoft Graph \((.*)\)$/s, (m) => `Unexpected response from Microsoft Graph (${gdetail(m[1])})`],
  [/^SharePoint ist nicht eingerichtet – es fehlen: (.*)$/s, (m) => `SharePoint is not set up – missing: ${m[1]}`],
  [/^Keine Berechtigung – App-Berechtigung\/Admin-Zustimmung prüfen$/, () => "No permission – check the app permission / admin consent"],
  [/^Datei\/Site nicht gefunden: (.*)$/s, (m) => `File/site not found: ${gctx(m[1])}`],
  [/^Datei ist gesperrt oder ausgecheckt(?: \((.*)\))? – bitte in SharePoint schliessen\/einchecken und erneut versuchen$/s, (m) => `File is locked or checked out${m[1] ? ` (${gctx(m[1])})` : ""} – please close or check in the file in SharePoint and try again`],
  [/^Konflikt in SharePoint(?: \((.*?)\))?(?:: (\w+))? – bitte erneut versuchen$/s, (m) => `Conflict in SharePoint${m[1] ? ` (${gctx(m[1])})` : ""}${m[2] ? `: ${m[2]}` : ""} – please try again`],
  [/^Datei zu gross oder Speicher in SharePoint voll \(HTTP (\d+)\)$/, (m) => `File too large or SharePoint storage full (HTTP ${m[1]})`],
  [/^Microsoft ist gerade überlastet oder nicht erreichbar \(HTTP (\d+)\) – bitte später erneut versuchen$/, (m) => `Microsoft is currently overloaded or unreachable (HTTP ${m[1]}) – please try again later`],
  [/^Ungültige Anfrage an Microsoft Graph(?: \((.*?)\))?(?:: (\w+))? – Einstellungen \(SP_\*\) prüfen$/s, (m) => `Invalid request to Microsoft Graph${m[1] ? ` (${gctx(m[1])})` : ""}${m[2] ? `: ${m[2]}` : ""} – check the settings (SP_*)`],
  [/^Microsoft Graph meldet einen Fehler \(HTTP (\d+)(?:, (.*))?\)$/s, (m) => `Microsoft Graph reports an error (HTTP ${m[1]}${m[2] ? `, ${m[2]}` : ""})`],
  [/^Anmeldung bei Microsoft fehlgeschlagen: (.*)$/s, (m) => `Sign-in to Microsoft failed: ${tokenDetail(m[1])}`],
  [/^(\S+) ist leer$/, (m) => `${m[1]} is empty`],
  [/^(\S+) darf «\.» und «\.\.» nicht enthalten$/, (m) => `${m[1]} must not contain «.» or «..»`],
];

// Beschreibung dessen, was angefragt wurde (graph.mjs: ctx); Varianten ergänzen eigene Beschreibungen per registerContexts()
const CTX = new Map();
export function registerContexts(pairs) {
  for (const [de, en] of Object.entries(pairs)) CTX.set(de, en);
}
function gctx(s) {
  if (CTX.has(s)) return CTX.get(s);
  return String(s)
    .replace(/^Site «(.*)» \(SP_SITE prüfen\)$/s, "Site «$1» (check SP_SITE)")
    .replace(/^Dokumentbibliotheken der Site «(.*)»$/s, "Document libraries of site «$1»")
    .replace(/^Standard-Dokumentbibliothek der Site «(.*)»$/s, "Default document library of site «$1»")
    .replace(/^Dokumentbibliothek «(.*?)» \(SP_DRIVE\)(?: – vorhanden: (.*))?$/s, (_, a, b) => `Document library «${a}» (SP_DRIVE)${b ? ` – available: ${b}` : ""}`)
    .replace(/^angefragte Ressource$/, "requested resource")
    .replace(/^Excel-Datei in SharePoint$/, "Excel file in SharePoint");
}
function gdetail(s) {
  return s === "Site ohne ID" ? "site without ID" : s === "Bibliothek ohne ID" ? "library without ID" : s;
}
function tokenDetail(s) {
  const known = [
    [/^Client-Secret ungültig – MS_CLIENT_SECRET muss der Secret-Wert sein \(nicht die Secret-ID\)\.$/, "client secret invalid – MS_CLIENT_SECRET must be the secret value (not the secret ID)."],
    [/^Client-Secret abgelaufen – in Entra ein neues Secret erstellen und MS_CLIENT_SECRET ersetzen\.$/, "client secret expired – create a new secret in Entra and replace MS_CLIENT_SECRET."],
    [/^App nicht gefunden – MS_CLIENT_ID prüfen \(Anwendungs-\/Client-ID der App-Registrierung, richtiger Mandant\?\)\.$/, "app not found – check MS_CLIENT_ID (application/client ID of the app registration, correct tenant?)."],
    [/^Mandant nicht gefunden – MS_TENANT_ID prüfen\.$/, "tenant not found – check MS_TENANT_ID."],
  ];
  for (const [re, en] of known) if (re.test(s)) return en;
  const m = /^(.*?) – MS_TENANT_ID, MS_CLIENT_ID und MS_CLIENT_SECRET prüfen\.$/s.exec(s);
  return m ? `${m[1]} – check MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET.` : s;
}

// Teile in Klammern aus der Datei: «ohne Angabe» ist ein Platzhalter des Servers
function ref(s) {
  return s === "ohne Angabe" ? "(not specified)" : s;
}

const ROW = /^Zeile (\d+): (.*)$/s;
const FIELD_IGNORED = /^(.*) – (.*) \(ignoriert\)$/s;
const FIELD_IGNORED2 = /^(.*) – Feld «(.*)» ignoriert$/s;

/** Weitere Muster einer Variante registrieren (z. B. Live-Sync); sie gehen den Standardmustern vor (spezifischer Wortlaut der Variante). */
const EXTRA = [];
export function registerRules(rules) {
  EXTRA.push(...rules);
}

export function translateCore(text) {
  for (const [re, fn] of [...EXTRA, ...RULES]) {
    const m = re.exec(text);
    if (m) return fn(m);
  }
  return null;
}

/** Deutschen Servertext ins Englische übertragen; null, wenn kein Muster passt. */
export function translateEn(text) {
  const s = String(text ?? "");
  if (!s) return s;
  const direct = translateCore(s);
  if (direct !== null) return direct;
  const row = ROW.exec(s);
  if (row) {
    const rest = row[2];
    const inner = translateCore(rest);
    if (inner !== null) return `Row ${row[1]}: ${inner}`;
    // «Zeile 5: Spalte – Fehler (ignoriert)» und «Zeile 5: Fehler – Feld «X» ignoriert»
    const a = FIELD_IGNORED.exec(rest);
    if (a) return `Row ${row[1]}: ${a[1]} – ${translateCore(a[2]) ?? a[2]} (ignored)`;
    const b = FIELD_IGNORED2.exec(rest);
    if (b) return `Row ${row[1]}: ${translateCore(b[1]) ?? b[1]} – field «${b[2]}» ignored`;
  }
  return null;
}
