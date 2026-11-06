// Befehlspalette / globale Suche (Strg+K bzw. Cmd+K, «/» ausserhalb von Eingabefeldern, Suchknopf in der Kopfzeile).
// Durchsucht nur die Daten des aktuellen Teams (store.all), dazu Seiten und Aktionen. Bedienung per Tastatur: ↑ ↓ Enter Esc.
import * as store from "./store.js";
import { navLabel } from "./config.js";
import { ENT, isTaskOpen } from "./model.js";
import * as F from "./forms.js";
import { editInvoice } from "./views/invoices.js";
import { html, esc, raw, fmtDate } from "./util.js";
import { t, tn, tv, getLang, setLang, onLangChange, LANGS } from "./i18n.js";
import { icon, anyDialogOpen } from "./ui.js";

const MAX_PER_GROUP = 8;
const MAX_RECENT = 5;
const GROUP_ORDER = ["actions", "customers", "suppliers", "articles", "deals", "invoices", "tasks", "pages"];

let pagesProvider = () => [];
let root, input, list, status, panel;
let items = []; // Suchindex (wird bei jedem Öffnen neu aufgebaut)
let opts = []; // aktuell dargestellte Zeilen
let active = -1;
let lastFocus = null;
let recent = []; // nur im Speicher: ["customers:<id>", …]

// ------------------------------------------------------------ Suchlogik

/** klein, ohne Akzente/Umlaute (ä → a, ß → ss), damit «uebersicht», «übersicht» und «Ubersicht» dasselbe finden */
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").toLowerCase();

const isSubsequence = (needle, hay) => {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
};

/** Wertung eines Suchworts gegen die Felder (Feld 0 = Haupttext, zählt am meisten); 0 = kein Treffer */
function scoreToken(tok, fields) {
  let best = 0, via = -1;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    const at = f.indexOf(tok);
    let s = 0;
    if (at === 0) s = 100;
    else if (at > 0) s = /[\s.\-_/@(·]/.test(f[at - 1]) ? 80 : 55;
    else if (i === 0 && tok.length >= 3 && isSubsequence(tok, f)) s = 25; // unscharf: Buchstaben in Reihenfolge
    if (!s) continue;
    s = s * (i === 0 ? 1 : 0.85) + (i === 0 ? 5 : 0);
    if (s > best) { best = s; via = i; }
  }
  return { score: best, via };
}

function scoreItem(item, toks) {
  let total = 0, via = -1;
  for (const tok of toks) {
    const r = scoreToken(tok, item.fields);
    if (!r.score) return null;
    total += r.score;
    if (r.via > 0 && via < 0) via = r.via;
  }
  return { total, via };
}

// ------------------------------------------------------------ Index

const go = (hash) => () => { location.hash = hash; };
const nrOf = (coll, r) => (r.nr ? (ENT[coll].fmtNr?.(r.nr) ?? String(r.nr)) : "");
const byNrDesc = (a, b) => (Number(b.nr) || 0) - (Number(a.nr) || 0);
const custName = (id) => store.byId("customers", id)?.firma || "";
const supName = (id) => store.byId("suppliers", id)?.firma || "";

function contactEntries(rec) {
  return (rec.contacts || []).map((c) => ({ label: c.name || c.email || "", norm: norm([c.name, c.funktion, c.email, c.telefon, c.mobile].filter(Boolean).join(" ")) }));
}

function buildIndex() {
  const out = [];
  const add = (it) => out.push({ labels: [], ...it });

  for (const coll of ["customers", "suppliers"]) {
    for (const r of store.all(coll)) {
      const cs = contactEntries(r);
      add({
        kind: coll, id: r.id, icon: coll === "customers" ? "users" : "factory", primary: r.firma || "",
        sub: [nrOf(coll, r), r.ort].filter(Boolean).join(" · "), meta: coll === "customers" ? tv("phase", r.phase) : tv("suppStatus", r.status),
        fields: [norm(r.firma), norm(nrOf(coll, r)), norm([r.plz, r.ort].filter(Boolean).join(" ")), ...cs.map((c) => c.norm)],
        labels: ["", "", "", ...cs.map((c) => c.label)],
        run: go(`#/${ENT[coll].route}/${r.id}`),
      });
    }
  }
  for (const r of [...store.all("articles")].sort(byNrDesc)) {
    const nr = nrOf("articles", r);
    add({
      kind: "articles", id: r.id, icon: "box", primary: r.bezeichnung || "", sub: nr, meta: "",
      fields: [norm(r.bezeichnung), norm(nr), String(r.nr ?? "")],
      run: go(`#/artikel/${r.id}`),
    });
  }
  for (const r of [...store.all("deals")].sort(byNrDesc)) {
    const title = ENT.deals.title(r);
    add({
      kind: "deals", id: r.id, icon: "file", primary: title, sub: [r.nr, custName(r.customerId)].filter(Boolean).join(" · "), meta: tv("phase", r.phase),
      fields: [norm(title), norm(r.nr), norm(custName(r.customerId))],
      run: () => F.editRecord("deals", r.id),
    });
  }
  for (const r of [...(store.all("invoices") || [])].sort(byNrDesc)) {
    add({
      kind: "invoices", id: r.id, icon: "receipt", primary: ENT.invoices.title(r), sub: custName(r.customerId), meta: tv("invStatus", r.status),
      fields: [norm(r.nr), norm(ENT.invoices.title(r)), norm(custName(r.customerId)), norm(r.referenz)],
      run: go(`#/rechnungen/${r.id}`),
    });
  }
  for (const r of [...store.all("tasks")].sort((a, b) => Number(isTaskOpen(b)) - Number(isTaskOpen(a)) || byNrDesc(a, b))) {
    add({
      kind: "tasks", id: r.id, icon: "check", primary: r.aufgabe || "", sub: [fmtDate(r.faellig), custName(r.customerId)].filter(Boolean).join(" · "), meta: tv("taskStatus", r.status),
      fields: [norm(r.aufgabe), norm(custName(r.customerId)), norm(r.owner)],
      run: () => F.editRecord("tasks", r.id),
    });
  }
  for (const r of [...store.all("activities")].sort(byNrDesc)) {
    const title = r.naechsterSchritt || r.notiz || "";
    add({
      kind: "tasks", id: `act-${r.id}`, icon: "chat", primary: title ? `${tv("actType", r.typ)}: ${title}` : tv("actType", r.typ), sub: [fmtDate(r.datum), custName(r.customerId) || supName(r.supplierId)].filter(Boolean).join(" · "), meta: tv("taskStatus", r.status),
      fields: [norm(title), norm(tv("actType", r.typ)), norm(custName(r.customerId)), norm(supName(r.supplierId)), norm(r.owner), norm(r.notiz)],
      run: () => F.editRecord("activities", r.id),
    });
  }

  // Aktionen: «Neuer …» nur, wenn es Teamdaten gibt (nicht im Plattform-Bereich des Superadmins)
  if (!store.S.noTeam) {
    const make = (key, ic, run) => add({ kind: "actions", id: key, icon: ic, primary: t(`cmdk.new.${key}`), sub: "", meta: "", fields: [norm(t(`cmdk.new.${key}`)), norm(ENT[key].singular)], run });
    make("customers", "plus", () => F.editRecord("customers"));
    make("suppliers", "plus", () => F.editRecord("suppliers"));
    make("deals", "plus", () => F.editRecord("deals"));
    make("invoices", "plus", () => editInvoice());
    make("tasks", "plus", () => F.editRecord("tasks"));
    make("activities", "plus", () => F.editRecord("activities"));
    make("articles", "plus", () => F.editRecord("articles"));
  }
  for (const l of LANGS) {
    if (l === getLang()) continue;
    const label = t("cmdk.switchLang", { lang: t(`cmdk.lang.${l}`) });
    add({ kind: "actions", id: `lang-${l}`, icon: "chat", primary: label, sub: "", meta: l.toUpperCase(), fields: [norm(label), norm(t("cmdk.langWords")), norm(t(`cmdk.lang.${l}`))], run: () => setLang(l) });
  }
  for (const p of pagesProvider()) {
    const label = navLabel(p.route);
    const goto = t("cmdk.goto", { page: label });
    add({ kind: "pages", id: p.route, icon: p.icon || "link", primary: goto, sub: "", meta: "", fields: [norm(goto), norm(label)], run: go(`#/${p.route}`) });
  }
  return out;
}

/** Ergebnisgruppen: [{ kind, rows: [{ item, via }] }] */
function search(q) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  const groups = new Map();
  if (!toks.length) {
    const rec = recent.map((k) => items.find((it) => `${it.kind}:${it.id}` === k)).filter(Boolean);
    if (rec.length) groups.set("recent", { kind: "recent", best: 1e6, rows: rec.map((item) => ({ item, via: -1 })) });
    for (const kind of ["actions", "pages"]) {
      const rows = items.filter((it) => it.kind === kind).slice(0, kind === "actions" ? 8 : MAX_PER_GROUP).map((item) => ({ item, via: -1 }));
      if (rows.length) groups.set(kind, { kind, best: kind === "actions" ? 1e5 : 1e4, rows });
    }
    return [...groups.values()];
  }
  const scored = [];
  for (const item of items) {
    const r = scoreItem(item, toks);
    if (r) scored.push({ item, via: r.via, total: r.total });
  }
  scored.sort((a, b) => b.total - a.total); // stabil: bei gleicher Wertung bleibt die Reihenfolge des Index
  for (const s of scored) {
    let g = groups.get(s.item.kind);
    if (!g) groups.set(s.item.kind, (g = { kind: s.item.kind, best: s.total, rows: [] }));
    if (g.rows.length < MAX_PER_GROUP) g.rows.push(s);
  }
  return [...groups.values()].sort((a, b) => b.best - a.best || GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind));
}

// ------------------------------------------------------------ Darstellung

/** Text mit hervorgehobenen Suchwörtern (Vergleich ohne Akzente, Länge bleibt gleich) */
function highlight(text, toks) {
  const s = String(text ?? "");
  if (!toks.length) return esc(s);
  const n = [...s].map((c) => c.normalize("NFD")[0].toLowerCase()).join("");
  if (n.length !== s.length) return esc(s);
  const mark = new Array(s.length).fill(false);
  for (const tok of toks) {
    let at = n.indexOf(tok);
    while (at >= 0 && tok) { for (let i = at; i < at + tok.length; i++) mark[i] = true; at = n.indexOf(tok, at + tok.length); }
  }
  let out = "", open = false;
  for (let i = 0; i < s.length; i++) {
    if (mark[i] !== open) { out += open ? "</mark>" : "<mark>"; open = mark[i]; }
    out += esc(s[i]);
  }
  return out + (open ? "</mark>" : "");
}

const groupTitle = (kind) => (kind === "recent" ? t("cmdk.g.recent") : t(`cmdk.g.${kind}`));

function render() {
  const q = input.value;
  const toks = norm(q).split(/\s+/).filter(Boolean);
  const groups = search(q);
  let n = 0;
  const parts = groups.map((g, gi) => {
    const rows = g.rows.map(({ item, via }) => {
      const id = `cmdk-opt-${n++}`;
      const viaLabel = via > 0 && item.labels[via] ? item.labels[via] : "";
      const sub = viaLabel ? [viaLabel, item.sub].filter(Boolean).join(" · ") : item.sub;
      return html`<div class="cmdk-opt" role="option" id="${id}" aria-selected="false" data-i="${n - 1}"><span class="cmdk-ic">${icon(item.icon)}</span><span class="cmdk-txt"><span class="cmdk-main">${raw(highlight(item.primary, toks))}</span>${sub ? html`<span class="cmdk-sub">${raw(highlight(sub, toks))}</span>` : ""}</span>${item.meta ? html`<span class="cmdk-meta">${item.meta}</span>` : ""}</div>`;
    });
    return html`<div role="group" aria-labelledby="cmdk-g-${gi}"><div class="cmdk-gh" id="cmdk-g-${gi}">${groupTitle(g.kind)}</div>${rows}</div>`;
  });
  list.innerHTML = parts.length ? parts.map(String).join("") : html`<div class="cmdk-empty">${t("cmdk.empty", { q: q.trim() })}</div>`.toString();
  opts = [...list.querySelectorAll(".cmdk-opt")];
  rowsData = groups.flatMap((g) => g.rows.map((r) => r.item));
  status.textContent = toks.length ? tn("cmdk.count", opts.length) : "";
  setActive(opts.length ? 0 : -1, false);
}
let rowsData = [];

function setActive(i, scroll = true) {
  if (active >= 0 && opts[active]) { opts[active].classList.remove("is-active"); opts[active].setAttribute("aria-selected", "false"); }
  active = i;
  const el = opts[i];
  if (!el) { input.removeAttribute("aria-activedescendant"); return; }
  el.classList.add("is-active");
  el.setAttribute("aria-selected", "true");
  input.setAttribute("aria-activedescendant", el.id);
  if (scroll) el.scrollIntoView({ block: "nearest" });
}

function choose(i) {
  const item = rowsData[i];
  if (!item) return;
  if (!["actions", "pages"].includes(item.kind)) {
    const key = `${item.kind}:${item.id}`;
    recent = [key, ...recent.filter((k) => k !== key)].slice(0, MAX_RECENT);
  }
  close();
  try {
    const r = item.run();
    if (r && typeof r.catch === "function") r.catch((e) => console.error(e));
  } catch (e) { console.error(e); }
}

// ------------------------------------------------------------ Öffnen / Schliessen

export const isOpen = () => Boolean(root) && !root.hidden;

export function open() {
  if (!root || isOpen() || anyDialogOpen()) return;
  lastFocus = document.activeElement;
  items = buildIndex();
  input.value = "";
  root.hidden = false;
  document.body.classList.add("cmdk-open");
  render();
  input.focus();
}

export function close() {
  if (!isOpen()) return;
  root.hidden = true;
  document.body.classList.remove("cmdk-open");
  const back = lastFocus;
  lastFocus = null;
  if (back && back.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
}

const typing = (el) => Boolean(el) && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function onGlobalKey(e) {
  if (e.isComposing) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (isOpen()) close(); else open();
    return;
  }
  if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isOpen() && !typing(document.activeElement) && !anyDialogOpen()) {
    e.preventDefault();
    open();
  }
}

function onPaletteKey(e) {
  if (e.isComposing) return;
  switch (e.key) {
    case "Escape": e.preventDefault(); e.stopPropagation(); close(); break;
    case "ArrowDown": e.preventDefault(); if (opts.length) setActive((active + 1) % opts.length); break;
    case "ArrowUp": e.preventDefault(); if (opts.length) setActive((active - 1 + opts.length) % opts.length); break;
    case "Home": if (e.target !== input || !input.value) { e.preventDefault(); if (opts.length) setActive(0); } break;
    case "End": if (e.target !== input || !input.value) { e.preventDefault(); if (opts.length) setActive(opts.length - 1); } break;
    case "Enter": e.preventDefault(); if (active >= 0) choose(active); break;
    case "Tab": e.preventDefault(); break; // Fokus bleibt im Suchfeld (Ergebnisse werden mit den Pfeiltasten gewählt)
  }
}

// ------------------------------------------------------------ Aufbau

const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

/** Beschriftung des Suchknopfs und der Palette in der aktuellen Sprache */
function labels() {
  const btn = document.getElementById("cmdk-btn");
  if (btn) {
    const key = isMac() ? "⌘K" : t("cmdk.ctrlK");
    btn.setAttribute("aria-label", t("cmdk.open"));
    btn.title = `${t("cmdk.open")} (${key})`;
    btn.querySelector(".cmdk-btn-text").textContent = t("cmdk.btn");
    btn.querySelector("kbd").textContent = key;
  }
  if (!root) return;
  panel.setAttribute("aria-label", t("cmdk.title"));
  input.placeholder = t("cmdk.placeholder");
  input.setAttribute("aria-label", t("cmdk.title"));
  list.setAttribute("aria-label", t("cmdk.results"));
  root.querySelector("[data-cmdk-close]").setAttribute("aria-label", t("common.close"));
  root.querySelector(".cmdk-hints").innerHTML = html`<span><kbd>↑</kbd><kbd>↓</kbd> ${t("cmdk.hint.nav")}</span><span><kbd>↵</kbd> ${t("cmdk.hint.open")}</span><span><kbd>Esc</kbd> ${t("cmdk.hint.close")}</span>`.toString();
}

/** Einmal beim Start der Anwendung. pages: () => [{route, icon}] (sichtbare Menüpunkte der angemeldeten Person) */
export function initCmdk({ pages } = {}) {
  if (root) return;
  if (pages) pagesProvider = pages;
  root = document.createElement("div");
  root.className = "cmdk";
  root.hidden = true;
  root.innerHTML = html`<div class="cmdk-backdrop" data-cmdk-close></div>
    <div class="cmdk-panel" role="dialog" aria-modal="true">
      <div class="cmdk-head">${icon("search")}<input type="text" class="cmdk-input" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><button type="button" class="cmdk-x" data-cmdk-close>${icon("x")}</button></div>
      <div class="cmdk-list" id="cmdk-list" role="listbox"></div>
      <div class="cmdk-foot"><div class="cmdk-hints"></div><div class="sr" role="status" aria-live="polite" id="cmdk-status"></div></div>
    </div>`.toString();
  document.body.appendChild(root);
  panel = root.querySelector(".cmdk-panel");
  input = root.querySelector(".cmdk-input");
  list = root.querySelector(".cmdk-list");
  status = root.querySelector("#cmdk-status");

  input.addEventListener("input", render);
  root.addEventListener("keydown", onPaletteKey);
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-cmdk-close]")) { close(); return; }
    const o = e.target.closest(".cmdk-opt");
    if (o) choose(Number(o.dataset.i));
  });
  root.addEventListener("mousedown", (e) => { if (!e.target.closest("input")) e.preventDefault(); }); // Fokus bleibt im Suchfeld
  list.addEventListener("mousemove", (e) => {
    const o = e.target.closest(".cmdk-opt");
    if (o && Number(o.dataset.i) !== active) setActive(Number(o.dataset.i), false);
  });
  document.addEventListener("keydown", onGlobalKey);
  document.addEventListener("click", (e) => { if (e.target.closest("#cmdk-btn")) open(); });
  window.addEventListener("hashchange", close);
  onLangChange(() => { close(); labels(); });
  labels();
}
