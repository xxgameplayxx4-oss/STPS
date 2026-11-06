// Länderliste (ISO-3166-Alpha-2) für das Pflichtfeld «Land». Gespeichert wird der Ländercode («CH»), angezeigt der Name.
// Reine Daten/Funktionen ohne DOM-Abhängigkeit (auch in Node nutzbar). Wird u. a. für die MWST-Logik (isDomestic) verwendet.

const RAW = [
  // Inland / Hauptmärkte zuerst
  ["CH", "Schweiz", "Switzerland"], ["DE", "Deutschland", "Germany"], ["AT", "Österreich", "Austria"], ["LI", "Liechtenstein", "Liechtenstein"],
  // übrige Länder Europas (alphabetisch nach deutschem Namen)
  ["AL", "Albanien", "Albania"], ["AD", "Andorra", "Andorra"], ["BE", "Belgien", "Belgium"], ["BA", "Bosnien und Herzegowina", "Bosnia and Herzegovina"],
  ["BG", "Bulgarien", "Bulgaria"], ["DK", "Dänemark", "Denmark"], ["EE", "Estland", "Estonia"], ["FI", "Finnland", "Finland"],
  ["FR", "Frankreich", "France"], ["GR", "Griechenland", "Greece"], ["IE", "Irland", "Ireland"], ["IS", "Island", "Iceland"],
  ["IT", "Italien", "Italy"], ["HR", "Kroatien", "Croatia"], ["LV", "Lettland", "Latvia"], ["LT", "Litauen", "Lithuania"],
  ["LU", "Luxemburg", "Luxembourg"], ["MT", "Malta", "Malta"], ["MD", "Moldau", "Moldova"], ["MC", "Monaco", "Monaco"],
  ["ME", "Montenegro", "Montenegro"], ["NL", "Niederlande", "Netherlands"], ["MK", "Nordmazedonien", "North Macedonia"], ["NO", "Norwegen", "Norway"],
  ["PL", "Polen", "Poland"], ["PT", "Portugal", "Portugal"], ["RO", "Rumänien", "Romania"], ["SM", "San Marino", "San Marino"],
  ["SE", "Schweden", "Sweden"], ["RS", "Serbien", "Serbia"], ["SK", "Slowakei", "Slovakia"], ["SI", "Slowenien", "Slovenia"],
  ["ES", "Spanien", "Spain"], ["CZ", "Tschechien", "Czechia"], ["TR", "Türkei", "Türkiye"], ["UA", "Ukraine", "Ukraine"],
  ["HU", "Ungarn", "Hungary"], ["GB", "Vereinigtes Königreich", "United Kingdom"], ["CY", "Zypern", "Cyprus"],
  // Übrige Welt (häufige Handelspartner)
  ["US", "USA", "United States"], ["CA", "Kanada", "Canada"], ["CN", "China", "China"], ["IN", "Indien", "India"],
  ["JP", "Japan", "Japan"], ["TW", "Taiwan", "Taiwan"], ["VN", "Vietnam", "Vietnam"], ["AE", "Vereinigte Arabische Emirate", "United Arab Emirates"],
];

export const COUNTRIES = RAW.map(([code, name_de, name_en]) => ({ code, name_de, name_en }));

/** Inland im Sinn der MWST-Logik: Schweiz und Liechtenstein (gemeinsames Zollgebiet / MWST-Gebiet) */
export const isDomestic = (code) => code === "CH" || code === "LI";

const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const INDEX = new Map();
for (const c of COUNTRIES) for (const k of [c.code, c.name_de, c.name_en]) INDEX.set(norm(k), c.code);
// gängige Schreibweisen aus Freitexten
for (const [k, v] of Object.entries({ ch: "CH", suisse: "CH", svizzera: "CH", "schweiz ch": "CH", brd: "DE", germany: "DE", deutschland: "DE", oesterreich: "AT", osterreich: "AT", ae: "AE", uk: "GB", "great britain": "GB", england: "GB", "united states of america": "US", usa: "US", vae: "AE" })) INDEX.set(norm(k), v);

/** Freitext oder Code → Ländercode («Schweiz» → «CH»); unbekannt → null */
export function countryCode(text) {
  const key = norm(text);
  return key ? INDEX.get(key) || null : null;
}

/** Name in der gewünschten Sprache; unbekannter Code → der Wert selbst */
export function countryName(code, lang = "de") {
  const c = COUNTRIES.find((x) => x.code === code);
  return c ? (lang === "en" ? c.name_en : c.name_de) : code || "";
}
