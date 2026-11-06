// Übersicht / Shopfloor (Blätter "Shopfloor" und "CRM Übersicht" der Excel-Vorlage)
import { all, byId, getUser, getList } from "../store.js";
import { html, th, fmtDate, todayISO, addDays, isoWeek, weekday, relDay, isOverdue } from "../util.js";
import { icon, confirmDialog } from "../ui.js";
import { OVERDUE, CUSTOMER_PIPELINE, SUPPLIER_PIPELINE, SHOPFLOOR_AGENDA, MAX_FOCUS } from "../config.js";
import { badge, prio, weightedDeal, sumByCur, curLines, amt, nameOf, isClosedPhase, isTaskOpen, isTaskDone, isActivityDone } from "../model.js";
import { dateCell, ownerCell, dash } from "./common.js";
import * as F from "../forms.js";
import { remove } from "../store.js";
import { invoiceKpis } from "./invoices.js";
import { t, tv } from "../i18n.js";
import * as TL from "../tasklog.js";

// ------------------------------------------------------------ Kennzahlen (wie in der Excel-Vorlage)

export function computeKpis() {
  const customers = all("customers"), deals = all("deals"), tasks = all("tasks"), suppliers = all("suppliers"), rfqs = all("rfqs");
  const sum = (arr, f) => arr.reduce((s, r) => s + (Number(f(r)) || 0), 0);
  const today = todayISO();
  const openTasks = tasks.filter(isTaskOpen);
  const inv = invoiceKpis(today);
  return {
    offeneRechnungen: inv.open,
    ueberfaelligeRechnungen: inv.over,
    kunden: customers.length,
    offeneDeals: deals.filter((d) => !isClosedPhase(d.phase)).length,
    angeboteGesendet: deals.filter((d) => d.phase === "Angebot gesendet").length,
    verhandlungen: deals.filter((d) => d.phase === "Verhandlung Angebot").length,
    gewonnen: deals.filter((d) => d.phase === "Abschluss Ja").length,
    offeneAufgaben: openTasks.length,
    ueberfaelligeAufgaben: openTasks.filter((t) => isOverdue(t.faellig, today)).length,
    // je Währung getrennt: [[«CHF», n], [«EUR», n]] (nie über Währungen summiert)
    pipelinePotenzial: sumByCur(customers, (c) => c.potenzial),
    angebotswert: sumByCur(deals, (d) => d.wert),
    gewichtet: sumByCur(deals, weightedDeal),
    lieferantenAktiv: suppliers.filter((s) => s.status === "Aktiv").length,
    lieferantenTotal: suppliers.length,
    lieferantenangeboteErhalten: rfqs.filter((r) => r.phase === "Angebot erhalten").length,
    supplierWins: rfqs.filter((r) => r.phase === "Abschluss Ja").length,
    kundenPhasen: Object.fromEntries(CUSTOMER_PIPELINE.map((p) => [p.phase, { n: customers.filter((c) => c.phase === p.phase).length, potenzial: sumByCur(customers.filter((c) => c.phase === p.phase), (c) => c.potenzial) }])),
    lieferantenPhasen: Object.fromEntries(SUPPLIER_PIPELINE.map((p) => [p.phase, rfqs.filter((r) => r.phase === p.phase).length])),
    offeneZuordnungen: rfqs.filter((r) => !isClosedPhase(r.phase)).length,
  };
}

// ------------------------------------------------------------ "Meine Woche"

const q = (obj) => "?" + Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export function weekItems(owner, today = todayISO(), horizon = 7) {
  const end = addDays(today, horizon);
  const items = [];
  const push = (date, kind, title, href, extra = "") => date && date <= end && items.push({ date, kind, title, href, extra });
  for (const tk of all("tasks")) {
    if (tk.owner === owner && !isTaskDone(tk)) push(tk.faellig, "task", tk.aufgabe, tk.customerId ? `#/kunden/${tk.customerId}` : tk.supplierId ? `#/lieferanten/${tk.supplierId}` : TL.href({ tab: "open", typ: TL.TODO }), nameOf("customers", tk.customerId) || nameOf("suppliers", tk.supplierId));
  }
  for (const c of all("customers")) {
    if (c.owner !== owner || isClosedPhase(c.phase)) continue;
    push(c.followUp, "followUp", c.naechsterSchritt || t("week.kind.followUp"), `#/kunden/${c.id}`, c.firma);
    push(c.termin, "meeting", c.naechsterSchritt || t("week.kind.meeting"), `#/kunden/${c.id}`, c.firma);
  }
  for (const s of all("suppliers")) {
    if (s.owner !== owner || s.status === "Gesperrt" || s.status === "Inaktiv") continue;
    push(s.followUp, "supplierFollowUp", t("week.kind.followUp"), `#/lieferanten/${s.id}`, s.firma);
  }
  for (const a of all("activities")) {
    if (a.owner !== owner || isActivityDone(a)) continue;
    push(a.faellig, "nextStep", a.naechsterSchritt || tv("actType", a.typ), a.customerId ? `#/kunden/${a.customerId}` : `#/lieferanten/${a.supplierId}`, nameOf("customers", a.customerId) || nameOf("suppliers", a.supplierId));
  }
  for (const d of all("deals")) {
    if (d.owner !== owner || isClosedPhase(d.phase)) continue;
    push(d.erwarteterAbschluss, "closeExpected", d.produkt, `#/kunden/${d.customerId}`, nameOf("customers", d.customerId));
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

function weekCard(o, me) {
  const today = todayISO();
  const items = weekItems(o.name, today);
  const over = items.filter((i) => i.date < today);
  const soon = items.filter((i) => i.date >= today);
  const row = (i) => html`<li><a href="${i.href}"><span class="wi-date ${i.date < today ? "overdue" : i.date === today ? "today" : ""}">${fmtDate(i.date)} <small>${relDay(i.date, today)}</small></span><span class="wi-kind">${t("week.kind." + i.kind)}</span><span class="wi-title">${i.title}${i.extra ? html` <span class="muted">· ${i.extra}</span>` : ""}</span></a></li>`;
  const list = (arr) => html`<ul class="wi">${arr.slice(0, 12).map(row)}${arr.length > 12 ? html`<li class="muted more">${t("week.andMore", { n: arr.length - 12 })}</li>` : ""}</ul>`;
  return html`<section class="card week-card ${o.name === me ? "mine" : ""}">
    <div class="card-head"><h3>${ownerCell(o.name)}${o.name === me ? html` <span class="badge t-navy">${t("week.me")}</span>` : ""}</h3><span class="muted role">${tv("ownerRole", o.role) || ""}</span></div>
    ${items.length
      ? html`${over.length ? html`<h4 class="wi-h over">${t("week.overdue")} <span class="count-pill alert">${over.length}</span></h4>${list(over)}` : ""}
        ${soon.length ? html`<h4 class="wi-h">${t("week.next7")} <span class="count-pill">${soon.length}</span></h4>${list(soon)}` : ""}`
      : html`<p class="muted pad">${t("week.nothingDue")}</p>`}
  </section>`;
}

// ------------------------------------------------------------ Seite

export function render(root, route) {
  const k = computeKpis();
  const today = todayISO();
  const wk = isoWeek(today);
  const me = getUser();
  const owners = [...getList("owners")].sort((a, b) => (a.name === me ? -1 : b.name === me ? 1 : 0));
  const focus = all("focus");
  const approvals = all("approvals");

  const kpi = (label, value, href, hint, def, alert = false) => html`<a class="kpi" href="${href}" title="${def}"><span class="kpi-l">${label}</span><span class="kpi-v">${value}</span>${hint ? html`<span class="kpi-h ${alert ? "alert" : ""}">${hint}</span>` : ""}</a>`;
  const ph = (v) => tv("phase", v);

  root.innerHTML = html`
    <div class="page-head">
      <div><h1>${t("nav.uebersicht")}</h1><p class="intro">${t("dash.intro")}</p></div>
      <div class="weekbox"><strong>${t("dash.week", { n: wk.week })}</strong><span>${weekday(today)}, ${fmtDate(today)}</span></div>
    </div>

    <div class="kpi-grid">
      ${kpi(t("kpi.customers"), k.kunden, "#/kunden", "", t("kpi.def.customers"))}
      ${kpi(t("kpi.openDeals"), k.offeneDeals, `#/angebote${q({ phase: "__open" })}`, "", t("kpi.def.openDeals"))}
      ${kpi(t("kpi.offersSent"), k.angeboteGesendet, `#/angebote${q({ phase: "Angebot gesendet" })}`, "", t("kpi.def.phase", { phase: ph("Angebot gesendet") }))}
      ${kpi(t("kpi.negotiations"), k.verhandlungen, `#/angebote${q({ phase: "Verhandlung Angebot" })}`, "", t("kpi.def.phase", { phase: ph("Verhandlung Angebot") }))}
      ${kpi(t("kpi.won"), k.gewonnen, `#/angebote${q({ phase: "Abschluss Ja" })}`, "", t("kpi.def.phase", { phase: ph("Abschluss Ja") }))}
      ${kpi(t("kpi.openTasks"), k.offeneAufgaben, TL.href({ tab: "open", typ: TL.TODO }), k.ueberfaelligeAufgaben ? t("kpi.overdue", { n: k.ueberfaelligeAufgaben }) : "", t("kpi.def.openTasks"), true)}
      ${kpi(t("kpi.pipelinePotential"), curLines(k.pipelinePotenzial), "#/kunden", "", t("kpi.def.pipelinePotential"))}
      ${kpi(t("kpi.offerValue"), curLines(k.angebotswert), "#/angebote", "", t("kpi.def.offerValue"))}
      ${kpi(t("kpi.weightedPipeline"), curLines(k.gewichtet), "#/angebote", "", t("kpi.def.weightedPipeline"))}
      ${kpi(t("kpi.openInvoices"), k.offeneRechnungen.n, `#/rechnungen${q({ status: "__open" })}`, curLines(k.offeneRechnungen.betrag), t("kpi.def.openInvoices"))}
      ${kpi(t("kpi.overdueInvoices"), k.ueberfaelligeRechnungen.n, `#/rechnungen${q({ status: OVERDUE })}`, curLines(k.ueberfaelligeRechnungen.betrag), t("kpi.def.overdueInvoices"), k.ueberfaelligeRechnungen.n > 0)}
      ${kpi(t("kpi.suppliersActive"), k.lieferantenAktiv, `#/lieferanten${q({ status: "Aktiv" })}`, t("kpi.ofTotal", { n: k.lieferantenTotal }), t("kpi.def.suppliersActive", { status: tv("suppStatus", "Aktiv") }))}
      ${kpi(t("kpi.supplierOffersReceived"), k.lieferantenangeboteErhalten, `#/zuordnung${q({ phase: "Angebot erhalten" })}`, "", t("kpi.def.assignPhase", { phase: ph("Angebot erhalten") }))}
      ${kpi(t("kpi.supplierWins"), k.supplierWins, `#/zuordnung${q({ phase: "Abschluss Ja" })}`, "", t("kpi.def.assignPhase", { phase: ph("Abschluss Ja") }))}
    </div>

    <section class="card" aria-labelledby="h-cp">
      <div class="card-head"><h2 id="h-cp">${t("dash.customerPipeline")} <span class="muted">· Pascal</span></h2><a class="btn btn-sm btn-ghost" href="#/kunden">${t("dash.allCustomers")}</a></div>
      <div class="stages">
        ${CUSTOMER_PIPELINE.map((p) => html`<a class="stage" href="#/kunden${q({ phase: p.phase })}"><span class="stage-n">${k.kundenPhasen[p.phase].n}</span><span class="stage-l">${t("pipe.cust." + p.phase)}</span><span class="stage-s">${curLines(k.kundenPhasen[p.phase].potenzial, { empty: "–" })}</span></a>`)}
      </div>
    </section>

    <section class="card" aria-labelledby="h-sp">
      <div class="card-head"><h2 id="h-sp">${t("dash.supplierPipeline")} <span class="muted">· Liz</span></h2><a class="btn btn-sm btn-ghost" href="#/zuordnung">${t("dash.allAssignments")}</a></div>
      <div class="stages s7">
        ${SUPPLIER_PIPELINE.map((p) => html`<a class="stage" href="#/zuordnung${q({ phase: p.phase })}"><span class="stage-n">${k.lieferantenPhasen[p.phase]}</span><span class="stage-l">${t("pipe.supp." + p.phase)}</span></a>`)}
        <a class="stage open" href="#/zuordnung${q({ phase: "__open" })}"><span class="stage-n">${k.offeneZuordnungen}</span><span class="stage-l">${t("dash.openAssignments")}</span></a>
      </div>
    </section>

    <h2 class="section-h">${t("week.title")} <span class="muted">· ${t("week.subtitle")}</span></h2>
    <div class="week-grid">${owners.map((o) => weekCard(o, me))}</div>

    <section class="card" aria-labelledby="h-focus">
      <div class="card-head"><h2 id="h-focus">${t("focus.title")} <span class="count-pill">${focus.length} / ${MAX_FOCUS}</span></h2>
        <button type="button" class="btn btn-sm" data-act="add-focus" ${focus.length >= MAX_FOCUS ? "disabled" : ""}>${icon("plus")} ${t("focus.add")}</button></div>
      ${focus.length
        ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>${t("ent.customers.singular")}</th><th>${t("col.phase")}</th><th>${t("f.customers.produkt")}</th><th class="num">${t("col.potential")}</th><th class="num hide-lg">${t("col.offer")}</th><th>${t("f.customers.naechsterSchritt")}</th><th>${t("f.customers.termin")}</th><th class="hide-lg">${t("col.prio")}</th><th>${t("f.focus.blocker")}</th><th>${t("col.owner")}</th><th>${t("f.focus.diese")}</th><th class="hide-lg">${t("f.focus.kommentar")}</th><th></th></tr></thead>
          <tbody>${focus.map((f, i) => {
            const c = byId("customers", f.customerId);
            return html`<tr class="clickable" data-act="edit-focus" data-id="${f.id}" tabindex="0">
              <td data-label="#">${i + 1}</td>
              <td data-label="${t("ent.customers.singular")}" class="c-first">${c ? html`<a href="#/kunden/${c.id}" class="rowlink">${c.firma}</a><small class="nr">${c.nr}</small>` : dash}</td>
              <td data-label="${t("col.phase")}">${c ? badge(c.phase) : dash}</td><td data-label="${t("sec.product")}">${c?.produkt || dash}</td>
              <td data-label="${t("col.potential")}" class="num">${c ? amt(c, c.potenzial) || dash : dash}</td><td data-label="${t("col.offer")}" class="num hide-lg">${c ? amt(c, c.angebot) || dash : dash}</td>
              <td data-label="${t("f.customers.naechsterSchritt")}">${c?.naechsterSchritt || dash}</td><td data-label="${t("f.customers.termin")}">${c ? dateCell(c.termin, { done: isClosedPhase(c.phase) }) : dash}</td>
              <td data-label="${t("col.prio")}" class="hide-lg">${c ? prio(c.prioritaet) || dash : dash}</td>
              <td data-label="${t("f.focus.blocker")}">${f.blocker || dash}</td><td data-label="${t("col.owner")}">${ownerCell(f.owner || c?.owner)}</td>
              <td data-label="${t("f.focus.diese")}">${f.diese === "Ja" ? badge("Ja", "green") : f.diese ? badge(f.diese, "grey") : dash}</td>
              <td data-label="${t("f.focus.kommentar")}" class="hide-lg">${f.kommentar || dash}</td>
              <td class="act"><button type="button" class="icon-btn" data-act="remove-focus" data-id="${f.id}" aria-label="${t("focus.remove")}" title="${t("focus.remove")}">${icon("x")}</button></td></tr>`;
          })}</tbody></table></div>`
        : html`<p class="muted pad">${t("focus.empty", { n: MAX_FOCUS })}</p>`}
    </section>

    <section class="card" aria-labelledby="h-appr">
      <div class="card-head"><h2 id="h-appr">${t("appr.title")} <span class="count-pill">${approvals.length}</span></h2>
        <button type="button" class="btn btn-sm" data-act="add-approval">${icon("plus")} ${t("appr.add")}</button></div>
      ${approvals.length
        ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>${t("ent.customers.singular")}</th><th>${t("f.approvals.thema")}</th><th>${t("f.approvals.entscheidung")}</th><th>${t("f.approvals.termin")}</th><th>${t("col.status")}</th><th></th></tr></thead>
          <tbody>${approvals.map((a, i) => html`<tr class="clickable" data-act="edit-approval" data-id="${a.id}" tabindex="0">
            <td data-label="#">${i + 1}</td>
            <td data-label="${t("ent.customers.singular")}">${byId("customers", a.customerId) ? html`<a href="#/kunden/${a.customerId}" class="rowlink">${nameOf("customers", a.customerId)}</a><small class="nr">${byId("customers", a.customerId).nr}</small>` : dash}</td>
            <td data-label="${t("f.approvals.thema")}" class="c-first">${a.thema}</td><td data-label="${t("sec.decision")}">${a.entscheidung ? html`<span class="clamp" title="${a.entscheidung}">${a.entscheidung}</span>` : dash}</td>
            <td data-label="${t("f.approvals.termin")}">${dateCell(a.termin, { done: a.status === "Erledigt" })}</td><td data-label="${t("col.status")}">${badge(a.status)}</td>
            <td class="act"><button type="button" class="icon-btn" data-act="remove-approval" data-id="${a.id}" aria-label="${t("appr.remove")}" title="${t("common.delete")}">${icon("trash")}</button></td></tr>`)}</tbody></table></div>`
        : html`<p class="muted pad">${t("appr.empty")}</p>`}
    </section>

    <details class="card agenda">
      <summary><h2>${t("agenda.title")}</h2></summary>
      <ol class="agenda-list">${SHOPFLOOR_AGENDA.map((a) => html`<li><strong>${a.who || t("agenda.everyone")}</strong> ${t("agenda." + a.n)}</li>`)}</ol>
    </details>`.toString();

  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || e.target.closest("a")) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case "add-focus": return F.editRecord("focus");
      case "edit-focus": return F.editRecord("focus", id);
      case "remove-focus": {
        const f = byId("focus", id);
        if (f && (await confirmDialog({ title: t("focus.removeTitle"), message: th("focus.removeMsg", { name: html`<strong>${nameOf("customers", f.customerId)}</strong>` }), confirmLabel: t("common.removeVerb") }))) remove("focus", id);
        return;
      }
      case "add-approval": return F.editRecord("approvals");
      case "edit-approval": return F.editRecord("approvals", id);
      case "remove-approval": return F.deleteRecord("approvals", id);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("tr[data-act]")) e.target.click();
  });
}
