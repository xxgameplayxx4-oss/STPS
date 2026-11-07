// Board: drei Spalten (In Bearbeitung | Gesendet | Freigegeben) für Angebote und Rechnungen, Karten per Drag & Drop in die nächste Spalte ziehen.
//  - Zeigerereignisse (Pointer Events): Maus, Stift und Touch mit demselben Code. Maus/Griff: Ziehen ab 4 px; Touch auf der Karte: langes Drücken,
//    damit das Wischen zum Scrollen frei bleibt; der Griff links oben zieht auf Touch sofort.
//  - Tastatur/Screenreader: Pfeil-Schaltflächen auf der Karte (links/rechts), Alt+Pfeil auf der Karte, Enter öffnet.
//  - Jede Änderung läuft über store.update() (gestempelt, gespeichert, im Verlauf) und lässt sich 8 s lang rückgängig machen.
//  - Angebote: Spalte setzt die Phase (Angebot erstellt / Angebot gesendet / Abschluss Ja; passt die Phase schon zur Spalte, bleibt sie), die Chance folgt
//    der Phasenregel des Formulars. Rechnungen: Entwurf / Gesendet / Bezahlt wie im Rechnungsformular; versendete Rechnungen gehen nicht zurück auf Entwurf
//    (Aufbewahrung), stornierte und abgelehnte Angebote sind ausgeblendet.
import { all, byId, update } from "../store.js";
import { html, raw, initials, debounce, todayISO } from "../util.js";
import { L, nameOf, isClosedPhase, normChance, amt, amt3, curLines, sumByCur, badge } from "../model.js";
import { PHASE_CHANCE, OVERDUE } from "../config.js";
import { isRetainedInvoice, docCurrency } from "../billing.js";
import { dateCell } from "./common.js";
import { totalsOf, statusOf, invBadge, money2 } from "./docs.js";
import { editInvoice } from "./invoices.js";
import * as F from "../forms.js";
import { icon } from "../ui.js";
import { t, tv } from "../i18n.js";

const MODE_KEY = "stps-crm:board-mode"; // nur dieser Browser
const UNDO_MS = 8000;
const HOLD_MS = 350; // langes Drücken auf Touch
const DRAG_PX = 4;

const read = () => { try { return localStorage.getItem(MODE_KEY) === "invoices" ? "invoices" : "deals"; } catch { return "deals"; } };
const write = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* privater Modus o. ä. */ } };

// Zustand nur im Speicher (die Ansicht wird bei jeder Datenänderung neu gezeichnet)
const st = { mode: null, q: "", owner: "", scroll: 0 }; // scroll: waagrechte Position des Boards (Handy), bleibt beim Neuzeichnen erhalten
let pendingFocus = null; // { id, dir } – Fokus nach dem Neuzeichnen (Tastaturbedienung)

// ------------------------------------------------------------ Spalten

const DEAL_COLS = [
  { key: "proc", label: "board.col.proc", tone: "grey", phases: ["Akquise", "Termin erhalten", "Angebot erstellt"], target: "Angebot erstellt" },
  { key: "sent", label: "board.col.sent", tone: "navy", phases: ["Angebot gesendet", "Verhandlung Angebot"], target: "Angebot gesendet" },
  { key: "appr", label: "board.col.appr", tone: "green", phases: ["Abschluss Ja"], target: "Abschluss Ja" },
];
const INV_COLS = [
  { key: "draft", label: "board.col.draft", tone: "grey", status: "Entwurf" },
  { key: "sent", label: "board.col.sent", tone: "navy", status: "Gesendet" },
  { key: "paid", label: "board.col.paid", tone: "green", status: "Bezahlt" },
];
const colsOf = (mode) => (mode === "invoices" ? INV_COLS : DEAL_COLS);

/** Spalte einer Karte; null = ausgeblendet (Abschluss Nein, storniert) */
function dealCol(d) {
  if (d.phase === "Abschluss Nein") return null;
  return (DEAL_COLS.find((c) => c.phases.includes(d.phase)) || DEAL_COLS[0]).key;
}
function invCol(inv) {
  const s = inv.status || "Entwurf";
  if (s === "Storniert") return null;
  return (INV_COLS.find((c) => c.status === s) || INV_COLS[0]).key;
}

// ------------------------------------------------------------ Daten je Modus

const ownerOfInvoice = (inv) => byId("deals", inv.dealId)?.owner || inv.createdBy || "";
const dealSearch = (d) => [d.nr, nameOf("customers", d.customerId), byId("customers", d.customerId)?.nr, d.produkt, d.naechsterSchritt, d.kommentar, d.owner].join(" ").toLowerCase();
const invSearch = (i) => [i.nr, nameOf("customers", i.customerId), byId("customers", i.customerId)?.nr, i.referenz, ownerOfInvoice(i)].join(" ").toLowerCase();

const MODES = {
  deals: {
    coll: "deals", colOf: dealCol, search: dealSearch, owner: (d) => d.owner || "",
    sum: (r) => r.wert,
    sumTitle: "board.sumDeals", hiddenKey: "board.hiddenDeals", empty: "board.emptyDeals", help: "board.helpDeals", countKey: "kanban.count",
    hidden: (r) => r.phase === "Abschluss Nein",
    owners: () => [...new Set([...L.owners(), ...all("deals").map((d) => d.owner)].filter(Boolean))],
    edit: (id) => F.editRecord("deals", id),
    sort: (a, b) => (a.erwarteterAbschluss || "9999").localeCompare(b.erwarteterAbschluss || "9999") || a.nr - b.nr,
  },
  invoices: {
    coll: "invoices", colOf: invCol, search: invSearch, owner: ownerOfInvoice,
    sum: (r) => totalsOf(r).total,
    sumTitle: "board.sumInvoices", hiddenKey: "board.hiddenInvoices", empty: "board.emptyInvoices", help: "board.helpInvoices", countKey: "board.countInvoices",
    hidden: (r) => r.status === "Storniert",
    owners: () => [...new Set([...L.owners(), ...all("invoices").map(ownerOfInvoice)].filter(Boolean))],
    edit: (id) => editInvoice(id),
    sort: (a, b) => (a.faellig || "9999").localeCompare(b.faellig || "9999") || a.nr - b.nr,
  },
};

// ------------------------------------------------------------ Verschieben

/** Darf diese Karte in diese Spalte? → { ok, same, reason } */
function canMove(mode, rec, colKey) {
  if (MODES[mode].colOf(rec) === colKey) return { ok: false, same: true };
  if (mode === "invoices" && colKey === "draft" && isRetainedInvoice(rec)) return { ok: false, reason: t("inv.err.noDraft") };
  return { ok: true };
}

/** Änderung (Patch) und Gegenstück zum Rückgängigmachen */
function planMove(mode, rec, colKey) {
  if (mode === "deals") {
    const col = DEAL_COLS.find((c) => c.key === colKey);
    const phase = col.target;
    const patch = { phase };
    // Chance wie im Formular: auf die Auswahl der neuen Phase abbilden (100 bei Abschluss Ja), leer = Vorschlag je Phase;
    // aus einer Abschluss-Phase heraus (100 % / 0 % sind dort fest) gilt der Vorschlag der neuen Phase
    const ch = isClosedPhase(rec.phase) ? PHASE_CHANCE[phase] : (normChance(rec.chance, phase) ?? PHASE_CHANCE[phase]);
    if (ch !== undefined && ch !== null) patch.chance = ch;
    return { patch, back: { phase: rec.phase, chance: rec.chance ?? "" }, label: L.kundenphasen().find((o) => o.value === phase)?.label || phase };
  }
  const col = INV_COLS.find((c) => c.key === colKey);
  const patch = { status: col.status, bezahltAm: col.status === "Bezahlt" ? (rec.bezahltAm || todayISO()) : "" };
  return { patch, back: { status: rec.status || "Entwurf", bezahltAm: rec.bezahltAm || "" }, label: tv("invStatus", col.status) };
}

function colLabel(mode, colKey) {
  return t(colsOf(mode).find((c) => c.key === colKey).label);
}

/** Karte in eine Spalte legen; meldet das Ergebnis mit «Rückgängig». @returns true, wenn verschoben */
function moveTo(mode, id, colKey, focusDir = null) {
  const rec = byId(MODES[mode].coll, id);
  if (!rec) return false;
  const chk = canMove(mode, rec, colKey);
  if (chk.same) return false;
  if (!chk.ok) { snack(chk.reason); return false; }
  const plan = planMove(mode, rec, colKey);
  let saved;
  try { saved = update(MODES[mode].coll, id, plan.patch); } catch (e) { snack(e.message); return false; }
  pendingFocus = { id, dir: focusDir };
  const stamp = saved.updatedAt;
  snack(t(mode === "deals" ? "board.movedDeal" : "board.movedInvoice", { nr: rec.nr, col: colLabel(mode, colKey) }), {
    undo: () => {
      const cur = byId(MODES[mode].coll, id);
      if (!cur) return snack(t("store.recordGone"));
      if (cur.updatedAt !== stamp) return snack(t("board.undoStale")); // inzwischen geändert (auch von anderen): nichts überschreiben
      try { update(MODES[mode].coll, id, plan.back); pendingFocus = { id, dir: null }; snack(t("board.undone", { nr: rec.nr })); } catch (e) { snack(e.message); }
    },
  });
  return true;
}

// ------------------------------------------------------------ Meldung mit «Rückgängig» (lebt ausserhalb der Seite, übersteht das Neuzeichnen)

let snackEl = null, snackTimer = 0;
function snack(msg, { undo = null } = {}) {
  clearTimeout(snackTimer);
  snackEl?.remove();
  const el = document.createElement("div");
  el.className = "bd-snack";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  const span = document.createElement("span");
  span.textContent = msg;
  el.append(span);
  if (undo) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bd-snack-btn";
    b.dataset.undo = "";
    b.textContent = t("board.undo");
    b.addEventListener("click", () => { clearTimeout(snackTimer); el.remove(); snackEl = null; undo(); });
    el.append(b);
  }
  document.body.appendChild(el);
  snackEl = el;
  snackTimer = setTimeout(() => { el.remove(); if (snackEl === el) snackEl = null; }, undo ? UNDO_MS : 4500);
}

// ------------------------------------------------------------ Karten

function cardHtml(mode, rec, idx) {
  const cols = colsOf(mode);
  const cust = nameOf("customers", rec.customerId) || "–";
  const owner = MODES[mode].owner(rec);
  const prev = cols[idx - 1], next = cols[idx + 1];
  const nav = (dir, target) => {
    const chk = target ? canMove(mode, rec, target.key) : { ok: false };
    const lbl = target ? t(dir < 0 ? "board.moveLeft" : "board.moveRight", { nr: rec.nr, col: t(target.label) }) : "";
    return html`<button type="button" class="bd-nav" data-dir="${dir}" ${chk.ok ? "" : raw("disabled")} ${target ? html`aria-label="${lbl}" title="${chk.ok ? lbl : chk.reason || lbl}"` : raw('aria-hidden="true" tabindex="-1"')}>${icon(dir < 0 ? "chevron-left" : "chevron-right")}</button>`;
  };
  let sub = "", amount = "", amountLabel = "", tags = "", foot = "";
  if (mode === "deals") {
    const closed = isClosedPhase(rec.phase);
    sub = rec.produkt || "";
    amount = amt3(rec, rec.wert) || "–";
    amountLabel = amt(rec, rec.wert) || "–";
    tags = badge(rec.phase);
    foot = dateCell(rec.erwarteterAbschluss, { done: closed });
  } else {
    const s = statusOf(rec);
    sub = rec.referenz || byId("deals", rec.dealId)?.produkt || "";
    amount = amountLabel = money2(totalsOf(rec).total, docCurrency(rec));
    tags = s === OVERDUE ? invBadge(OVERDUE) : "";
    foot = rec.faellig ? html`<span class="muted">${t("f.invoices.faellig")}</span> ${dateCell(rec.faellig, { done: s === "Bezahlt" })}` : "";
  }
  return html`<article class="bd-card" data-id="${rec.id}" tabindex="0" aria-label="${rec.nr} · ${cust} · ${amountLabel}">
    <div class="bd-card-top">
      <span class="bd-grip" aria-hidden="true" title="${t("board.grip")}">${icon("grip")}</span>
      <span class="nr bd-nr">${rec.nr}</span>
      <span class="bd-tags">${tags}</span>
      <span class="bd-moves">${nav(-1, prev)}${nav(1, next)}</span>
    </div>
    <div class="bd-cust">${cust}</div>
    ${sub ? html`<div class="bd-sub" title="${sub}">${sub}</div>` : ""}
    <div class="bd-meta"><span class="bd-amt">${amount}</span>${owner ? html`<span class="av" title="${owner}" role="img" aria-label="${t("col.owner")}: ${owner}">${initials(owner)}</span>` : ""}</div>
    ${foot ? html`<div class="bd-foot">${foot}</div>` : ""}
  </article>`;
}

// ------------------------------------------------------------ Seite

export const pageTitle = () => t("nav.board");

export function render(root, route) {
  if (route?.query?.m) st.mode = route.query.m === "rechnungen" ? "invoices" : "deals";
  if (!st.mode) st.mode = read();
  const mode = st.mode;
  const M = MODES[mode];
  const cols = colsOf(mode);
  const owners = M.owners();
  if (st.owner && !owners.includes(st.owner)) st.owner = "";

  const view = document.createElement("div");
  root.replaceChildren(view);
  view.innerHTML = html`
    <div class="page-head">
      <div><h1>${t("board.title")}</h1><p class="intro">${t("board.intro")}</p></div>
      <div class="head-actions">
        <div class="seg seg-view" role="group" aria-label="${t("board.mode")}">
          <button type="button" class="seg-btn" data-mode="deals" aria-pressed="${String(mode === "deals")}">${t("board.modeDeals")}</button>
          <button type="button" class="seg-btn" data-mode="invoices" aria-pressed="${String(mode === "invoices")}">${t("board.modeInvoices")}</button>
        </div>
      </div>
    </div>
    <div class="toolbar">
      <label class="search">${icon("search")}<input type="search" id="q-board" placeholder="${t("tbl.search")}" value="${st.q}" autocomplete="off" aria-label="${t("tbl.searchLabel")}"></label>
      <label class="flt"><span>${t("col.owner")}</span><select data-owner><option value="">${t("tbl.all")}</option>${owners.map((o) => html`<option value="${o}" ${o === st.owner ? "selected" : ""}>${o}</option>`)}</select></label>
      <button type="button" class="btn btn-sm btn-ghost" data-reset ${st.q.trim() || st.owner ? "" : raw("hidden")}>${t("tbl.resetFilters")}</button>
      <span class="count" aria-live="polite" data-count></span>
    </div>
    <p class="sr" id="bd-help">${t(M.help)}</p>
    <div class="bd-board" data-board role="group" aria-label="${t("board.boardLabel", { what: t(mode === "deals" ? "board.modeDeals" : "board.modeInvoices") })}" aria-describedby="bd-help"></div>
    <p class="bd-hidden muted" data-hidden hidden></p>`.toString();

  const board = view.querySelector("[data-board]");

  // ---- Zeichnen
  const terms = st.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const everything = all(M.coll);
  const shown = everything.filter((r) => !M.hidden(r) && (!st.owner || M.owner(r) === st.owner) && (!terms.length || terms.every((x) => M.search(r).includes(x))));
  view.querySelector("[data-count]").textContent = t(M.countKey, { n: shown.length, total: everything.filter((r) => !M.hidden(r)).length });
  const hiddenN = everything.filter(M.hidden).length;
  const hiddenEl = view.querySelector("[data-hidden]");
  hiddenEl.hidden = !hiddenN;
  hiddenEl.textContent = hiddenN ? t(M.hiddenKey, { n: hiddenN }) : "";

  board.innerHTML = cols.map((c, i) => {
    const cards = shown.filter((r) => M.colOf(r) === c.key).sort(M.sort);
    return html`<section class="bd-col" data-col="${c.key}" aria-labelledby="bd-h-${c.key}">
      <header class="bd-col-head">
        <h2 id="bd-h-${c.key}"><span class="bd-dot t-${c.tone}" aria-hidden="true"></span>${t(c.label)}</h2>
        <span class="bd-count" title="${t("board.countTitle")}">${cards.length}</span>
        <span class="bd-sum" title="${t(M.sumTitle)}">${curLines(sumByCur(cards, M.sum))}</span>
      </header>
      <div class="bd-col-body" data-body>${cards.length ? cards.map((r) => cardHtml(mode, r, i)) : html`<p class="bd-empty">${t(M.empty)}</p>`}</div>
    </section>`;
  }).join("");

  board.scrollLeft = st.scroll;
  board.addEventListener("scroll", () => { st.scroll = board.scrollLeft; }, { passive: true });
  if (pendingFocus) {
    const card = board.querySelector(`.bd-card[data-id="${CSS.escape(pendingFocus.id)}"]`);
    const btn = pendingFocus.dir ? card?.querySelector(`.bd-nav[data-dir="${pendingFocus.dir}"]:not(:disabled)`) : null;
    (btn || card)?.focus({ preventScroll: pendingFocus.dir == null });
    pendingFocus = null;
  }

  // ---- Bedienung (Klicks, Tastatur)
  const openCard = (id) => M.edit(id);
  let suppressClick = false;
  view.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]");
    if (m) {
      if (m.getAttribute("aria-pressed") === "true") return;
      st.mode = m.dataset.mode; st.owner = ""; st.scroll = 0;
      write(st.mode);
      try { history.replaceState(null, "", `#/board?m=${st.mode === "invoices" ? "rechnungen" : "angebote"}`); } catch { /* ignore */ }
      render(root, null);
      return;
    }
    if (e.target.closest("[data-reset]")) { st.q = ""; st.owner = ""; render(root, null); return; }
    if (suppressClick) { suppressClick = false; return; }
    const nav = e.target.closest(".bd-nav");
    if (nav) {
      if (nav.disabled) return;
      const card = nav.closest(".bd-card");
      const idx = cols.findIndex((c) => c.key === M.colOf(byId(M.coll, card.dataset.id) || {}));
      const dir = Number(nav.dataset.dir);
      if (cols[idx + dir]) moveTo(mode, card.dataset.id, cols[idx + dir].key, dir);
      return;
    }
    const card = e.target.closest(".bd-card");
    if (card) openCard(card.dataset.id);
  });
  view.addEventListener("input", debounce((e) => { if (e.target.id !== "q-board") return;
    const pos = e.target.selectionStart;
    st.q = e.target.value;
    render(root, null);
    const inp = root.querySelector("#q-board");
    inp?.focus();
    try { inp?.setSelectionRange(pos, pos); } catch { /* search-Felder ohne Auswahl */ }
  }, 150));
  view.addEventListener("change", (e) => { if (e.target.matches("[data-owner]")) { st.owner = e.target.value; render(root, null); } });
  board.addEventListener("keydown", (e) => {
    const card = e.target.closest(".bd-card");
    if (!card || e.target !== card) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(card.dataset.id); return; }
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      card.querySelector(`.bd-nav[data-dir="${e.key === "ArrowLeft" ? -1 : 1}"]`)?.click();
    }
  });

  // ---- Ziehen (Pointer Events)
  let drag = null; // { id, card, pid, x0, y0, started, touch, grip, timer, ghost, ph, ox, oy, x, y, over, raf, cleanup }
  const colAt = (x, y) => {
    for (const c of board.querySelectorAll(".bd-col")) {
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 40 && y <= r.bottom + 40) return c;
    }
    return null;
  };
  const clearOver = () => {
    board.querySelectorAll(".bd-col.over, .bd-col.deny").forEach((c) => c.classList.remove("over", "deny"));
    drag?.ph?.remove();
  };
  function pick() {
    if (!drag?.started) return;
    const col = colAt(drag.x, drag.y);
    const key = col?.dataset.col || null;
    if (key === drag.over) return;
    clearOver();
    drag.over = key;
    if (!col) return;
    const rec = byId(M.coll, drag.id);
    const chk = rec ? canMove(mode, rec, key) : { ok: false };
    if (chk.same) return;
    if (!chk.ok) { col.classList.add("deny"); return; }
    col.classList.add("over");
    const ph = document.createElement("div");
    ph.className = "bd-ph";
    ph.style.height = `${drag.h}px`;
    ph.textContent = t("board.drop", { col: colLabel(mode, key) });
    ph.setAttribute("aria-hidden", "true");
    col.querySelector("[data-body]").prepend(ph); // oben: bei langen Spalten immer sichtbar (die Reihenfolge ergibt sich aus Datum/Nummer)
    drag.ph = ph;
  }
  function frame() {
    if (!drag?.started) return;
    if (!board.isConnected) { endDrag(true); return; }
    const br = board.getBoundingClientRect();
    const edge = 56, step = 14;
    if (drag.x < br.left + edge) board.scrollLeft -= step * Math.min(1, (br.left + edge - drag.x) / edge + .2);
    else if (drag.x > br.right - edge) board.scrollLeft += step * Math.min(1, (drag.x - (br.right - edge)) / edge + .2);
    if (drag.y < 70) window.scrollBy(0, -step);
    else if (drag.y > window.innerHeight - 70) window.scrollBy(0, step);
    pick();
    drag.raf = requestAnimationFrame(frame);
  }
  function place() {
    drag.ghost.style.transform = `translate3d(${drag.x - drag.ox}px, ${drag.y - drag.oy}px, 0)`;
  }
  function begin() {
    if (!drag || drag.started) return;
    clearTimeout(drag.timer);
    const r = drag.card.getBoundingClientRect();
    drag.started = true;
    drag.h = r.height;
    drag.ox = drag.x0 - r.left;
    drag.oy = drag.y0 - r.top;
    const g = drag.card.cloneNode(true);
    g.classList.add("bd-ghost");
    g.removeAttribute("tabindex");
    g.setAttribute("aria-hidden", "true");
    g.style.width = `${r.width}px`;
    document.body.appendChild(g);
    drag.ghost = g;
    drag.card.classList.add("bd-lifted");
    board.classList.add("bd-active");
    document.body.classList.add("bd-dragging");
    try { drag.card.setPointerCapture(drag.pid); } catch { /* Zeiger schon weg */ }
    place();
    drag.raf = requestAnimationFrame(frame);
  }
  function endDrag(cancel) {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.raf);
    d.cleanup();
    if (d.started) {
      d.ghost.remove();
      d.card.classList.remove("bd-lifted");
      board.classList.remove("bd-active");
      document.body.classList.remove("bd-dragging");
      board.querySelectorAll(".bd-col.over, .bd-col.deny").forEach((c) => c.classList.remove("over", "deny"));
      d.ph?.remove();
      suppressClick = true; // der Klick nach dem Loslassen öffnet die Karte nicht; das nächste pointerdown hebt das wieder auf
      if (!cancel && board.isConnected) {
        const col = colAt(d.x, d.y);
        if (col) moveTo(mode, d.id, col.dataset.col, null);
      }
    }
  }
  board.addEventListener("pointerdown", (e) => {
    suppressClick = false;
    if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.target.closest(".bd-nav")) return;
    const card = e.target.closest(".bd-card");
    if (!card) return;
    const touch = e.pointerType !== "mouse";
    const grip = Boolean(e.target.closest(".bd-grip"));
    drag = { id: card.dataset.id, card, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false, touch, grip, over: null };
    const onMove = (ev) => {
      if (!drag || ev.pointerId !== drag.pid) return;
      drag.x = ev.clientX; drag.y = ev.clientY;
      if (!drag.started) {
        const dist = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);
        if (touch && !grip) { if (dist > 10) endDrag(true); return; } // Wischen = Scrollen, kein Ziehen
        if (dist < DRAG_PX) return;
        begin();
      }
      ev.preventDefault();
      place();
    };
    const onUp = (ev) => { if (drag && ev.pointerId === drag.pid) endDrag(ev.type === "pointercancel"); };
    const onTouchMove = (ev) => { if (drag?.started && ev.cancelable) ev.preventDefault(); }; // hält die Seite beim Ziehen still
    const onKey = (ev) => { if (ev.key === "Escape" && drag) { ev.stopPropagation(); endDrag(true); } };
    const onCtx = (ev) => { if (drag) ev.preventDefault(); };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("contextmenu", onCtx);
    drag.cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("contextmenu", onCtx);
    };
    if (touch && !grip) drag.timer = setTimeout(begin, HOLD_MS);
  });
  board.addEventListener("dragstart", (e) => e.preventDefault()); // keine native Bild-/Textvorschau
}
