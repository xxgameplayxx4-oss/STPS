// Pipeline-Board der Angebote: eine Spalte pro Kundenphase, Karten per Drag & Drop oder Phasenmenü verschieben.
// Phasenwechsel laufen über store.update() (wie das Formular): gestempelt, gespeichert, im Verlauf sichtbar.
import { all, byId, update } from "../store.js";
import { html, raw, fmtPct, initials, debounce, todayISO } from "../util.js";
import { L, tone, nameOf, isClosedPhase, normChance, amt3, curLines, sumByCur } from "../model.js";
import { KUNDENPHASEN, PHASE_CHANCE } from "../config.js";
import { dateCell } from "./common.js";
import * as F from "../forms.js";
import { icon, toast } from "../ui.js";
import { t } from "../i18n.js";

const VIEW_KEY = "stps-crm:deals-view"; // nur dieser Browser

export function getDealView() {
  try { return localStorage.getItem(VIEW_KEY) === "board" ? "board" : "list"; } catch { return "list"; }
}
function setDealView(v) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* privater Modus o. ä.: Auswahl gilt nur bis zum Neuladen */ }
}

/** Umschalter «Liste | Board» (Markup); bindToggle() macht ihn bedienbar */
export function viewToggle(mode) {
  return html`<div class="seg seg-view" role="group" aria-label="${t("kanban.view")}">
    <button type="button" class="seg-btn" data-dealview="list" aria-pressed="${String(mode === "list")}">${icon("list")}<span>${t("kanban.list")}</span></button>
    <button type="button" class="seg-btn" data-dealview="board" aria-pressed="${String(mode === "board")}">${icon("kanban")}<span>${t("kanban.board")}</span></button>
  </div>`;
}

/** Klicks auf den Umschalter: Auswahl merken und onChange() aufrufen */
export function bindToggle(root, onChange) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dealview]");
    if (!b || b.getAttribute("aria-pressed") === "true") return;
    setDealView(b.dataset.dealview);
    onChange();
  });
}

// ------------------------------------------------------------ Zustand (nur im Speicher, wie die Listen)

const st = { q: "", owner: "" };
let pendingFocus = null; // Karte, die nach dem Neuzeichnen den Fokus bekommt (Tastaturbedienung)
let closeMenu = () => {};


const searchText = (r) => [r.nr, nameOf("customers", r.customerId), byId("customers", r.customerId)?.nr, r.produkt, r.naechsterSchritt, r.kommentar, r.owner].join(" ").toLowerCase();

function visibleDeals() {
  const terms = st.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return all("deals").filter((r) => (!st.owner || r.owner === st.owner) && (!terms.length || terms.every((x) => searchText(r).includes(x))));
}

/** Phase ändern – derselbe Weg wie im Formular (inkl. Chance-Vorschlag, wenn das Feld leer ist) */
function moveDeal(id, phase) {
  const d = byId("deals", id);
  if (!d || d.phase === phase) return;
  const patch = { phase };
  const ch = normChance(d.chance, phase) ?? PHASE_CHANCE[phase];
  if (ch !== undefined && ch !== null) patch.chance = ch;
  try {
    update("deals", id, patch);
    pendingFocus = id;
    toast(t("kanban.moved", { nr: d.nr, phase: L.kundenphasen().find((o) => o.value === phase)?.label || phase }), { type: "ok" });
  } catch (e) {
    toast(e.message, { type: "error" });
  }
}

function cardHtml(d, canDrag) {
  const cust = nameOf("customers", d.customerId);
  const closed = isClosedPhase(d.phase);
  return html`<article class="kb-card ${!closed && d.erwarteterAbschluss && d.erwarteterAbschluss < todayISO() ? "kb-late" : ""}" data-id="${d.id}" tabindex="0" ${canDrag ? raw('draggable="true"') : ""} aria-label="${d.nr} · ${cust} · ${d.produkt || ""}">
    <div class="kb-card-top">
      <span class="nr kb-nr">${d.nr}</span>
      <button type="button" class="kb-menu-btn" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="${t("kanban.moveAria", { nr: d.nr })}" title="${t("kanban.move")}">${icon("dots")}</button>
    </div>
    <div class="kb-cust">${cust || "–"}</div>
    ${d.produkt ? html`<div class="kb-proj" title="${d.produkt}">${d.produkt}</div>` : ""}
    <div class="kb-meta"><span class="kb-val">${amt3(d, d.wert) || "–"}</span>${d.chance !== "" && d.chance != null ? html`<span class="kb-chance" title="${t("col.chance")}">${fmtPct(normChance(d.chance, d.phase))}</span>` : ""}</div>
    <div class="kb-foot">${dateCell(d.erwarteterAbschluss, { done: closed })}${d.owner ? html`<span class="av" title="${d.owner}" role="img" aria-label="${t("col.owner")}: ${d.owner}">${initials(d.owner)}</span>` : ""}</div>
  </article>`;
}

export function renderBoard(root, route, { title, intro, newButton, headExtra }) {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const phases = L.kundenphasen();
  const owners = [...new Set([...L.owners(), ...all("deals").map((d) => d.owner).filter(Boolean)])];
  if (st.owner && !owners.includes(st.owner)) st.owner = "";

  root.innerHTML = html`
    <div class="page-head">
      <div><h1>${title}</h1>${intro ? html`<p class="intro">${intro}</p>` : ""}</div>
      <div class="head-actions">${headExtra || ""}${newButton ? html`<button type="button" class="btn btn-primary" data-new>${icon("plus")} ${newButton.label}</button>` : ""}</div>
    </div>
    <div class="toolbar">
      <label class="search">${icon("search")}<input type="search" id="q-deals-board" placeholder="${t("tbl.search")}" value="${st.q}" autocomplete="off" aria-label="${t("tbl.searchLabel")}"></label>
      <label class="flt"><span>${t("col.owner")}</span><select data-owner><option value="">${t("tbl.all")}</option>${owners.map((o) => html`<option value="${o}" ${o === st.owner ? "selected" : ""}>${o}</option>`)}</select></label>
      <button type="button" class="btn btn-sm btn-ghost" data-reset hidden>${t("tbl.resetFilters")}</button>
      <span class="count" data-count aria-live="polite"></span>
    </div>
    <p class="sr" id="kb-help">${t("kanban.help")}</p>
    <div class="kb-board" data-board role="group" aria-label="${t("kanban.boardLabel")}" aria-describedby="kb-help"></div>`.toString();

  const board = root.querySelector("[data-board]");
  const countEl = root.querySelector("[data-count]");
  const resetBtn = root.querySelector("[data-reset]");

  function draw() {
    closeMenu();
    const rows = visibleDeals();
    resetBtn.hidden = !st.q.trim() && !st.owner;
    countEl.textContent = t("kanban.count", { n: rows.length, total: all("deals").length });
    const byPhase = Object.fromEntries(phases.map((p) => [p.value, []]));
    const other = [];
    for (const d of rows) (byPhase[d.phase] || other).push(d);
    const byDate = (a, b) => (a.erwarteterAbschluss || "9999").localeCompare(b.erwarteterAbschluss || "9999") || a.nr - b.nr;
    board.innerHTML = phases.map((p) => {
      const cards = byPhase[p.value].sort(byDate);
      return html`<section class="kb-col" data-phase="${p.value}" aria-labelledby="kb-h-${KUNDENPHASEN.indexOf(p.value)}">
        <header class="kb-col-head">
          <h2 id="kb-h-${KUNDENPHASEN.indexOf(p.value)}"><span class="kb-dot t-${tone(p.value)}" aria-hidden="true"></span>${p.label}</h2>
          <span class="kb-count" title="${t("kanban.countTitle")}">${cards.length}</span>
          <span class="kb-sum" title="${t("kanban.sumTitle")}">${curLines(sumByCur(cards, (r) => r.wert))}</span>
        </header>
        <div class="kb-col-body" data-drop>${cards.length ? cards.map((d) => cardHtml(d, !coarse)) : html`<p class="kb-empty">${t("kanban.emptyCol")}</p>`}</div>
      </section>`;
    }).join("");
    if (pendingFocus) {
      board.querySelector(`.kb-card[data-id="${CSS.escape(pendingFocus)}"]`)?.focus({ preventScroll: false });
      pendingFocus = null;
    }
  }

  // ---- Phasenmenü (Tastatur und Touch)
  function openMenu(btn) {
    closeMenu();
    const card = btn.closest(".kb-card");
    const d = byId("deals", card.dataset.id);
    if (!d) return;
    const menu = document.createElement("div");
    menu.className = "kb-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", t("kanban.moveAria", { nr: d.nr }));
    menu.innerHTML = phases.map((p) => html`<button type="button" role="menuitemradio" aria-checked="${String(p.value === d.phase)}" data-to="${p.value}"><span class="kb-dot t-${tone(p.value)}" aria-hidden="true"></span>${p.label}</button>`).join("");
    root.appendChild(menu);
    btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect();
    const mh = menu.offsetHeight, mw = menu.offsetWidth;
    menu.style.top = `${Math.max(8, Math.min(r.bottom + 4, window.innerHeight - mh - 8))}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8))}px`;
    const items = [...menu.querySelectorAll("button")];
    (items.find((b) => b.dataset.to === d.phase) || items[0]).focus();
    const onDoc = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenu(); };
    const onKey = (e) => {
      const i = items.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); btn.focus(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === "Tab") closeMenu();
    };
    menu.addEventListener("keydown", onKey);
    menu.addEventListener("click", (e) => {
      const it = e.target.closest("[data-to]");
      if (!it) return;
      const id = card.dataset.id;
      closeMenu();
      if (it.dataset.to === d.phase) { btn.focus(); return; }
      moveDeal(id, it.dataset.to);
    });
    setTimeout(() => document.addEventListener("click", onDoc), 0);
    const onResize = () => closeMenu();
    window.addEventListener("resize", onResize);
    closeMenu = () => {
      document.removeEventListener("click", onDoc);
      window.removeEventListener("resize", onResize);
      menu.remove();
      btn.setAttribute("aria-expanded", "false");
      closeMenu = () => {};
    };
  }

  // ---- Ereignisse
  root.addEventListener("input", debounce((e) => { if (e.target.id === "q-deals-board") { st.q = e.target.value; draw(); } }, 120));
  root.addEventListener("change", (e) => { if (e.target.matches("[data-owner]")) { st.owner = e.target.value; draw(); } });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-new]")) { F.editRecord("deals"); return; }
    if (e.target.closest("[data-reset]")) {
      st.q = ""; st.owner = "";
      root.querySelector("#q-deals-board").value = "";
      root.querySelector("[data-owner]").value = "";
      draw();
      return;
    }
    const mb = e.target.closest("[data-menu]");
    if (mb) { mb.getAttribute("aria-expanded") === "true" ? closeMenu() : openMenu(mb); return; }
    const card = e.target.closest(".kb-card");
    if (card && !e.target.closest(".kb-menu")) F.editRecord("deals", card.dataset.id);
  });
  board.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".kb-card")) { e.preventDefault(); F.editRecord("deals", e.target.dataset.id); }
  });

  // Drag & Drop (Maus); auf Touch-Geräten gibt es das Phasenmenü
  let dragId = null;
  const clearOver = () => board.querySelectorAll(".kb-col.over").forEach((c) => c.classList.remove("over"));
  board.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.(".kb-card");
    if (!card) return;
    closeMenu();
    dragId = card.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
    card.classList.add("dragging");
  });
  board.addEventListener("dragend", () => { dragId = null; clearOver(); board.querySelectorAll(".dragging").forEach((c) => c.classList.remove("dragging")); });
  board.addEventListener("dragover", (e) => {
    const col = e.target.closest?.(".kb-col");
    if (!dragId || !col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!col.classList.contains("over")) { clearOver(); col.classList.add("over"); }
  });
  board.addEventListener("dragleave", (e) => {
    const col = e.target.closest?.(".kb-col");
    if (col && !col.contains(e.relatedTarget)) col.classList.remove("over");
  });
  board.addEventListener("drop", (e) => {
    const col = e.target.closest?.(".kb-col");
    if (!col || !dragId) return;
    e.preventDefault();
    const id = dragId;
    dragId = null;
    clearOver();
    moveDeal(id, col.dataset.phase);
  });

  draw();
}
