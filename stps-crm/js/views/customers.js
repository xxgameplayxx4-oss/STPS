// Kunden: Verzeichnis (Master-Detail) – Liste links, Detail rechts
import { all, byId, update } from "../store.js";
import { html, fmtPct, fmtDate, fmtDateTime, initials, mailLink, telLink } from "../util.js";
import { icon, toast } from "../ui.js";
import { badge, prio, primaryContact, weightedCustomer, contactsOf, normChance, amt3, deliveryAddresses, billingAddress, addressLines, countryLabel, addressNr, dealsOf, activitiesOf, isActivityDone } from "../model.js";
import { t, tn, tv } from "../i18n.js";
import { dateCell, ownerCell, dash, contactsCard, addressesCard, dl } from "./common.js";
import { articlesSection, rfqsSection, activitiesSection, tasksSection, bindDetailActions } from "./sections.js";
import { invBadge, statusOf, totalsOf, docMoney } from "./docs.js";
import * as F from "../forms.js";
import * as presence from "../presence.js";
import { kategorienOf, catShort } from "../categories.js";
import { openMatch } from "./match.js";
import { historyCard, bindHistory } from "./team.js";

const catChips = (r) => { const ids = kategorienOf(r); return ids.length ? html`<span class="cat-chips">${ids.map((id) => html`<span class="badge t-navy">${catShort(id)}</span>`)}</span>` : dash; };

// ---- Verzeichnis (Master-Detail): Liste links, Detail rechts; auf dem Handy erst die Liste, dann das Detail mit «Zurück».
const st = { q: "", mode: "all", listScroll: 0 }; // Suche, Darstellung (all | company) und Bildlaufposition bleiben über das Neuzeichnen erhalten

const searchText = (r) => [r.nr, r.firma, r.produkt, r.kommentar, r.naechsterSchritt, r.owner, r.quelle, r.strasse, r.plz, r.ort, r.land, countryLabel(r.land), ...deliveryAddresses(r).flatMap((a) => [a.bezeichnung, a.strasse, a.plz, a.ort, a.land, `${r.nr}.${a.sub}`]), ...contactsOf(r).flatMap((c) => [c.name, c.email, c.telefon, c.mobile, c.funktion])].join(" ").toLowerCase() + " " + kategorienOf(r).map(catShort).join(" ").toLowerCase();
const byName = (a, b) => (a.firma || "").localeCompare(b.firma || "", undefined, { sensitivity: "base", numeric: true }) || a.nr - b.nr;
const subLine = (c) => primaryContact(c)?.email || [c.plz, c.ort].filter(Boolean).join(" ") || c.nr;
const avatar = (c, cls = "") => html`<span class="av dir-av ${cls}" aria-hidden="true">${initials(c.firma || "?").slice(0, 2)}</span>`;

function listItem(c, sel) {
  const on = c.id === sel;
  return html`<li><a class="dir-item${on ? " is-sel" : ""}" href="#/kunden/${c.id}" data-id="${c.id}" ${on ? html`aria-current="true"` : ""}>
    ${avatar(c)}<span class="dir-item-txt"><span class="dir-name">${c.firma}</span><span class="dir-sub">${subLine(c)}</span></span><span class="dir-nr">${c.nr}</span></a></li>`;
}
function locationRows(c) {
  const locs = deliveryAddresses(c);
  if (!locs.length) return "";
  return html`<ul class="dir-locs">${locs.map((a) => html`<li><a class="dir-loc" href="#/kunden/${c.id}" data-id="${c.id}" data-loc="1"><span class="dir-loc-nr">${addressNr(c, a)}</span><span class="dir-loc-name">${a.bezeichnung || t("addr.delivery")}</span></a></li>`)}</ul>`;
}

function listHtml(rows, sel) {
  if (!rows.length) return html`<p class="muted pad dir-none">${st.q ? t("dir.noResults") : t("customers.empty")}</p>`;
  if (st.mode === "all") return html`<ul class="dir-list">${rows.map((c) => listItem(c, sel))}</ul>`;
  const groups = new Map();
  for (const c of rows) { const k = (c.firma || "").trim().toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  return html`<div class="dir-groups">${[...groups.values()].map((g) => html`<section class="dir-group" aria-label="${g[0].firma}">
    ${g.length > 1 ? html`<h3 class="dir-group-h">${g[0].firma} <span class="count-pill">${g.length}</span></h3>` : ""}
    <ul class="dir-list">${g.map((c) => html`${listItem(c, sel)}${deliveryAddresses(c).length ? html`<li class="dir-locs-li">${locationRows(c)}</li>` : ""}`)}</ul></section>`)}</div>`;
}

const relList = (title, count, items, empty, actions) => html`<section class="card dir-rel">
  <div class="card-head"><h2>${title} <span class="count-pill">${count}</span></h2><div class="card-actions">${actions || ""}</div></div>
  ${count ? html`<ul class="dir-rel-list">${items}</ul>` : html`<p class="muted pad">${empty}</p>`}</section>`;

function relatedHtml(c) {
  const done = (p) => p === "Abschluss Ja" || p === "Abschluss Nein";
  const deals = dealsOf(c.id).sort((a, b) => b.nr - a.nr);
  const invs = all("invoices").filter((i) => i.customerId === c.id).sort((a, b) => b.nr - a.nr);
  const meets = activitiesOf("customer", c.id).filter((a) => a.typ === "Termin").sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  return html`
    ${relList(t("nav.angebote"), deals.length, deals.map((d) => html`<li><button type="button" class="dir-rel-row" data-act="edit-deal" data-id="${d.id}"><span class="nr">${d.nr}</span><span class="dir-rel-main">${d.produkt || "–"}</span>${badge(d.phase)}<span class="num">${amt3(d, d.wert) || dash}</span></button></li>`), t("sec.noDeals"), html`<button type="button" class="btn btn-sm" data-act="add-deal">${icon("plus")} ${t("ent.deals.singular")}</button>`)}
    ${relList(t("ent.invoices.plural"), invs.length, invs.map((i) => html`<li><a class="dir-rel-row" href="#/rechnungen/${i.id}"><span class="nr">${i.nr}</span><span class="dir-rel-main">${i.referenz || t("ent.invoices.title", { nr: i.nr })}</span>${invBadge(statusOf(i))}<span class="num">${docMoney(i)(totalsOf(i).total)}</span></a></li>`), t("dir.noInvoices"))}
    ${relList(t("dir.meetings"), meets.length, meets.map((a) => html`<li><button type="button" class="dir-rel-row" data-act="edit-activity" data-id="${a.id}"><span class="dir-rel-date">${dateCell(a.datum, { done: isActivityDone(a) })}</span><span class="dir-rel-main">${a.notiz || a.ort || tv("actType", a.typ)}</span>${badge(a.status)}</button></li>`), t("dir.noMeetings"), html`<button type="button" class="btn btn-sm" data-act="add-activity">${icon("plus")} ${t("ent.activities.singular")}</button>`)}
    ${contactsCard(c, "customers")}
    <div id="dir-locations">${addressesCard(c)}</div>
    ${activitiesSection("customer", c.id)}
    ${tasksSection("customer", c.id)}
    ${rfqsSection("customer", c.id)}
    ${articlesSection("customer", c.id)}
    ${historyCard()}`;
}

function notesHtml(c, editing) {
  return html`<section class="card dir-notes" data-notes>
    <div class="card-head"><h2>${t("notes.title")}</h2><div class="card-actions"><button type="button" class="btn btn-sm" data-act="dir-notes-edit" data-notes-btn ${editing ? "hidden" : ""}>${icon("edit")} ${t("common.edit")}</button></div></div>
    <div data-notes-view ${editing ? "hidden" : ""}><button type="button" class="dir-notes-text" data-act="dir-notes-edit" aria-label="${t("dir.notesEditAria")}">${c.kommentar ? html`<span class="pre">${c.kommentar}</span>` : html`<span class="muted">${t("dir.notesPlaceholder")}</span>`}</button></div>
    <div class="dir-notes-edit" data-notes-edit ${editing ? "" : "hidden"}>
      <label class="sr" for="dir-notes-ta">${t("notes.title")}</label>
      <textarea id="dir-notes-ta" rows="6" data-notes-ta>${c.kommentar || ""}</textarea>
      <div class="notes-actions"><span class="muted dir-hint">${t("dir.notesHint")}</span><button type="button" class="btn" data-act="dir-notes-cancel">${t("common.cancel")}</button><button type="button" class="btn btn-primary" data-act="dir-notes-save">${t("notes.save")}</button></div>
    </div></section>`;
}

function detailHtml(c) {
  const done = c.phase === "Abschluss Ja" || c.phase === "Abschluss Nein";
  const p = primaryContact(c);
  const w = weightedCustomer(c);
  const place = [c.ort, countryLabel(c.land)].filter(Boolean).join(", ");
  const mail = p?.email;
  return html`
    ${presence.hereBanner(c.id)}
    <header class="dir-head">
      ${avatar(c, "xl")}
      <div class="dir-head-main">
        <h2 class="dir-title" id="dir-title" tabindex="-1">${c.firma}</h2>
        <div class="chips">${c.phase ? badge(c.phase) : ""}${c.status ? badge(c.status) : ""}<span class="nr-pill">${c.nr}</span>${c.prioritaet ? prio(c.prioritaet) : ""}</div>
        <p class="dir-place muted">${place}${c.owner ? html`${place ? " · " : ""}${ownerCell(c.owner)}` : ""}</p>
      </div>
      <div class="dir-actions">
        <button type="button" class="btn btn-primary" data-act="add-deal">${icon("plus")} ${t("dir.newDeal")}</button>
        ${mail ? html`<a class="btn" href="mailto:${mail}">${icon("mail")} ${t("dir.email")}</a>` : ""}
        <button type="button" class="btn" data-act="add-activity">${icon("plus")} ${t("ent.activities.singular")}</button>
        <button type="button" class="btn" data-act="add-task">${icon("plus")} ${t("ent.tasks.singular")}</button>
        <button type="button" class="btn" data-act="match">${icon("search")} ${t("match.btn")}</button>
        <button type="button" class="btn" data-act="edit">${icon("edit")} ${t("common.edit")}</button>
        <button type="button" class="btn btn-danger-ghost" data-act="delete">${icon("trash")} ${t("common.delete")}</button>
      </div>
    </header>
    <div class="dir-cards">
      <section class="card">
        <div class="card-head"><h2>${t("dir.contactInfo")}</h2></div>
        ${dl([
          [t("contact.primary"), p ? html`${p.name}${p.funktion ? html` <span class="muted">· ${p.funktion}</span>` : ""}` : ""],
          [t("f.contact.email"), mail ? mailLink(mail) : ""],
          [t("f.contact.telefon"), p?.telefon ? telLink(p.telefon) : ""],
          [t("f.contact.mobile"), p?.mobile ? telLink(p.mobile) : ""],
          [t("addr.billing"), addressLines(billingAddress(c)).length ? html`<div>${addressLines(billingAddress(c)).map((l, i) => html`${i ? html`<br>` : ""}${l}`)}</div>` : ""],
        ])}
      </section>
      <section class="card">
        <div class="card-head"><h2>${t("dir.details")}</h2></div>
        ${dl([
          [t("f.customers.produkt"), c.produkt],
          [t("f.customers.kategorien"), kategorienOf(c).length ? catChips(c) : ""],
          [t("col.potential"), amt3(c, c.potenzial)],
          [t("col.offer"), amt3(c, c.angebot)],
          [t("col.chance"), fmtPct(normChance(c.chance, c.phase))],
          [t("det.weightedPipeline"), amt3(c, w)],
          [t("f.customers.naechsterSchritt"), c.naechsterSchritt],
          [t("f.customers.termin"), c.termin ? dateCell(c.termin, { done, rel: true }) : ""],
          [t("f.customers.followUp"), c.followUp ? dateCell(c.followUp, { done, rel: true }) : ""],
          [t("f.customers.quelle"), tv("source", c.quelle)],
          [t("f.customers.erstkontakt"), fmtDate(c.erstkontakt)],
          [t("f.customers.letzterKontakt"), fmtDate(c.letzterKontakt)],
        ])}
        <p class="meta">${t("det.created", { at: fmtDateTime(c.createdAt) })}${c.createdBy ? " " + t("det.by", { name: c.createdBy }) : ""}${c.updatedAt && c.updatedAt !== c.createdAt ? html`<br>${t("det.changed", { at: fmtDateTime(c.updatedAt) })}${c.updatedBy ? " " + t("det.by", { name: c.updatedBy }) : ""}` : ""}</p>
      </section>
    </div>
    ${notesHtml(c, false)}
    ${relatedHtml(c)}`;
}

export function render(root, route) {
  const all_ = [...all("customers")].sort(byName);
  const q = st.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const rows = terms.length ? all_.filter((r) => { const h = searchText(r); return terms.every((x) => h.includes(x)); }) : all_;
  const wanted = route.id && byId("customers", route.id) ? route.id : null;
  const missing = route.id && !wanted;
  let cur = wanted || (!route.id ? rows[0]?.id || null : null);
  const companies = new Set(all_.map((c) => (c.firma || "").trim().toLowerCase())).size;
  const locations = all_.reduce((n, c) => n + deliveryAddresses(c).length, 0);
  const pane = route.id ? "detail" : "list";

  root.innerHTML = html`
    <div class="page-head">
      <div><h1>${t("customers.title")}</h1><p class="intro" data-dir-count>${t("dir.count", { n: all_.length, noun: t("ent.customers.count", { n: all_.length }), c: companies, cn: tn("dir.companies", companies), l: locations, ln: tn("dir.locations", locations) })}</p></div>
      <div class="head-actions"><button type="button" class="btn btn-primary" data-new>${icon("plus")} ${t("dir.add")}</button></div>
    </div>
    <div class="dir" data-pane="${pane}">
      <aside class="dir-side" aria-label="${t("dir.listAria")}">
        <div class="dir-tools">
          <label class="search">${icon("search")}<input type="search" id="q-customers" placeholder="${t("dir.searchPh")}" value="${st.q}" autocomplete="off" aria-label="${t("dir.searchPh")}"></label>
          <div class="dir-toggle" role="group" aria-label="${t("dir.modeAria")}">
            <button type="button" class="dir-tog" data-mode="all" aria-pressed="${st.mode === "all"}">${t("dir.modeAll")}</button>
            <button type="button" class="dir-tog" data-mode="company" aria-pressed="${st.mode === "company"}">${t("dir.modeCompany")}</button>
          </div>
        </div>
        <div class="dir-scroll" data-list tabindex="-1" aria-live="polite">${listHtml(rows, cur)}</div>
      </aside>
      <section class="dir-main" aria-labelledby="dir-title">
        <a class="btn btn-sm dir-back" href="#/kunden">${icon("back")} ${t("dir.back")}</a>
        <div class="dir-detail" data-detail>${missing ? html`<div class="card pad"><h2 id="dir-title">${t("customers.notFound")}</h2></div>` : cur ? detailHtml(byId("customers", cur)) : html`<div class="card pad dir-empty"><p class="muted">${t("dir.select")}</p></div>`}</div>
      </section>
    </div>`.toString();

  const $ = (s) => root.querySelector(s);
  const listEl = $("[data-list]");
  const detailEl = $("[data-detail]");
  const dirEl = $(".dir");
  listEl.scrollTop = st.listScroll;
  listEl.addEventListener("scroll", () => { st.listScroll = listEl.scrollTop; }, { passive: true });

  const showDetail = (id, { scrollTo } = {}) => {
    cur = id;
    const c = byId("customers", id);
    if (!c) return;
    detailEl.innerHTML = detailHtml(c).toString();
    bindHistory(detailEl, id);
    listEl.querySelectorAll(".dir-item").forEach((a) => {
      const on = a.dataset.id === id;
      a.classList.toggle("is-sel", on);
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    dirEl.dataset.pane = "detail";
    window.scrollTo(0, 0);
    detailEl.querySelector("#dir-title")?.focus({ preventScroll: true });
    const target = scrollTo && detailEl.querySelector(scrollTo);
    if (target) {
      const mainEl = detailEl.parentElement; // Desktop: nur die rechte Spalte scrollt; Handy: die Seite
      if (mainEl.scrollHeight > mainEl.clientHeight + 1) mainEl.scrollTop = target.getBoundingClientRect().top - mainEl.getBoundingClientRect().top + mainEl.scrollTop - 8;
      else target.scrollIntoView({ block: "start" });
    } else detailEl.parentElement.scrollTop = 0;
  };

  // Auswahl ohne Neuzeichnen der Liste (Bildlaufposition, Suche und Fokus bleiben); die Adresse wird trotzdem nachgeführt
  listEl.addEventListener("click", (e) => {
    const a = e.target.closest("a.dir-item, a.dir-loc");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    history.pushState(null, "", a.getAttribute("href"));
    showDetail(a.dataset.id, { scrollTo: a.dataset.loc ? "#dir-locations" : "" });
  });
  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...listEl.querySelectorAll("a.dir-item")];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))].focus();
  });
  const search = $("#q-customers");
  search.addEventListener("input", () => { st.q = search.value; st.listScroll = 0; refreshList(); });
  search.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { const f = listEl.querySelector("a.dir-item"); if (f) { e.preventDefault(); f.focus(); } } });
  function refreshList() {
    const ts = st.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rs = ts.length ? all_.filter((r) => { const h = searchText(r); return ts.every((x) => h.includes(x)); }) : all_;
    listEl.innerHTML = listHtml(rs, cur).toString();
    listEl.scrollTop = st.listScroll;
  }
  root.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    st.mode = b.dataset.mode;
    root.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    refreshList();
  }));
  $("[data-new]").addEventListener("click", () => F.editRecord("customers"));

  // Aktionen (bestehende Abläufe aus sections.js) – gelten für den jeweils gewählten Kunden
  bindDetailActions(root, { coll: "customers", get id() { return cur; } });
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    switch (el.dataset.act) {
      case "match": return openMatch(cur);
      case "dir-notes-edit": {
        detailEl.querySelector("[data-notes-view]").hidden = true;
        detailEl.querySelector("[data-notes-edit]").hidden = false;
        detailEl.querySelector("[data-notes-btn]").hidden = true;
        const ta = detailEl.querySelector("[data-notes-ta]");
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        return;
      }
      case "dir-notes-cancel": return showDetail(cur);
      case "dir-notes-save": return saveNotes();
    }
  });
  function saveNotes() {
    const ta = detailEl.querySelector("[data-notes-ta]");
    if (!ta) return;
    const text = ta.value.trim();
    const c = byId("customers", cur);
    if (text === (c?.kommentar || "")) return showDetail(cur);
    detailEl.querySelector("[data-notes-edit]").hidden = true; // damit das Neuzeichnen nach dem Speichern nicht blockiert wird
    update("customers", cur, { kommentar: text });
    toast(t("toast.notesSaved"), { type: "ok" });
  }
  root.addEventListener("keydown", (e) => {
    if (!e.target.matches?.("[data-notes-ta]")) return;
    if (e.key === "Escape") { e.preventDefault(); showDetail(cur); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNotes(); }
  });

  if (cur && !missing) bindHistory(detailEl, cur);
}
