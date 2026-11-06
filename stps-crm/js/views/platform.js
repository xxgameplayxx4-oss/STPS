// Plattform (nur Superadmin): Teams anlegen, umbenennen, deaktivieren, betreten; Benutzer und Darstellung (Logo) jedes Teams verwalten.
import * as store from "../store.js";
import * as api from "../api.js";
import { html, fmtDateTime } from "../util.js";
import { t, tn } from "../i18n.js";
import { icon, toast, confirmDialog, openForm } from "../ui.js";
import { relTime } from "./team.js";
import { renderTeamUsers } from "./users.js";
import * as brandingView from "./branding.js";
import * as outlook from "./outlook.js";

const fail = (e) => { if (!store.handleAuthError(e)) toast(e.message || t("toast.actionFailed"), { type: "error", ms: 8000 }); };

function memberCell(tm) {
  const m = tm.members;
  const noAdmin = tm.active && m.total > 0 && m.admins === 0;
  return html`${m.active} ${t("team.active")}<span class="muted"> ${t("plat.ofTotal", { total: m.total })}</span>
    <small class="muted block">${tn("plat.admins", m.admins)}</small>
    ${noAdmin ? html`<span class="badge t-amber" title="${t("plat.noAdminTitle")}">${t("plat.noAdmin")}</span>` : ""}`;
}

function teamsTable(teams, now) {
  if (!teams.length) {
    return html`<div class="empty">${t("plat.empty")}</div>`;
  }
  return html`<div class="table-wrap"><table class="tbl">
    <thead><tr><th>${t("nav.team")}</th><th>${t("users.col.status")}</th><th>${t("plat.col.members")}</th><th>${t("plat.col.lastActivity")}</th><th></th></tr></thead>
    <tbody>${teams.map((tm) => html`<tr class="${tm.active ? "" : "is-done"}">
      <td data-label="${t("nav.team")}" class="c-first"><div><a class="rowlink" href="#/plattform/${tm.id}">${tm.name}</a>
        ${tm.sharepoint ? html` <span class="badge t-sky" title="${t("plat.spTitle")}">SharePoint</span>` : ""}
        <small class="muted block">${t("plat.created", { at: fmtDateTime(tm.createdAt) })}</small></div></td>
      <td data-label="${t("users.col.status")}">${tm.active ? html`<span class="badge t-green">${t("team.active")}</span>` : html`<span class="badge t-grey">${t("users.inactive")}</span>`}</td>
      <td data-label="${t("plat.col.members")}"><div>${memberCell(tm)}</div></td>
      <td data-label="${t("plat.col.lastActivity")}">${tm.lastActivityAt ? html`<span title="${fmtDateTime(tm.lastActivityAt)}">${relTime(tm.lastActivityAt, now)}</span>` : html`<span class="muted">${t("plat.noActivity")}</span>`}</td>
      <td class="act"><div class="row-actions">
        <button type="button" class="btn btn-sm btn-primary" data-team-act="enter" data-id="${tm.id}">${icon("shield")} ${t("plat.enter")}</button>
        <a class="btn btn-sm" href="#/plattform/${tm.id}">${icon("team")} ${t("nav.benutzer")}</a>
        <button type="button" class="btn btn-sm" data-team-act="rename" data-id="${tm.id}">${icon("edit")} ${t("plat.rename")}</button>
        <button type="button" class="btn btn-sm ${tm.active ? "btn-danger-ghost" : ""}" data-team-act="toggle" data-id="${tm.id}">${tm.active ? t("users.deactivate") : t("users.activate")}</button>
      </div></td></tr>`)}</tbody></table></div>`;
}

function renderTeams(root) {
  const st = { teams: null, now: Date.now(), error: "" };

  const paint = () => {
    root.innerHTML = html`
      <div class="page-head">
        <div><h1>${t("nav.plattform")}</h1>
          <p class="intro">${t("plat.intro")}</p></div>
        <button type="button" class="btn btn-primary" data-team-act="add">${icon("plus")} ${t("plat.addTeam")}</button>
      </div>
      <div class="card table-card">
        ${st.teams === null
          ? html`<p class="muted pad">${st.error ? t("plat.loadFailed", { err: st.error }) : t("common.loading")}</p>`
          : teamsTable(st.teams, st.now)}
      </div>
      <p class="help">${t("plat.footnote")}</p>
      ${outlook.cardHtml({ server: true })}`.toString();
    outlook.bind(root, { server: true }); // Outlook: App-ID einmalig eintragen (nur Superadmin)
  };

  async function load() {
    try {
      const r = await api.listTeams();
      st.teams = r.teams;
      st.error = "";
      st.now = Date.now();
      document.dispatchEvent(new CustomEvent("crm:teams", { detail: r.teams })); // Team-Wechsler in der Kopfzeile aktualisieren
    } catch (e) {
      if (store.handleAuthError(e)) return;
      st.error = e.message || t("common.error");
    }
    if (root.isConnected) paint();
  }

  const find = (id) => st.teams?.find((tm) => tm.id === id);

  async function addTeam() {
    let created = null;
    await openForm({
      title: t("plat.addTeam"),
      subtitle: t("plat.add.subtitle"),
      fields: [{ key: "name", label: t("plat.f.name"), type: "text", required: true, full: true, placeholder: t("plat.f.namePh") }],
      values: {},
      submitLabel: t("plat.addTeam"),
      async onSubmit(v) { created = (await api.createTeam(v.name)).team; },
    });
    if (created) { toast(t("plat.toast.created", { name: created.name }), { type: "ok" }); location.hash = `#/plattform/${created.id}`; }
  }

  async function renameTeam(tm) {
    const ok = await openForm({
      title: t("plat.rename.title"),
      fields: [{ key: "name", label: t("plat.f.name"), type: "text", required: true, full: true }],
      values: { name: tm.name },
      submitLabel: t("common.save"),
      async onSubmit(v) { if (v.name !== tm.name) await api.updateTeam(tm.id, { name: v.name }); },
    });
    if (ok) { toast(t("plat.toast.renamed"), { type: "ok" }); await load(); }
  }

  async function toggleTeam(tm) {
    if (tm.active) {
      const ok = await confirmDialog({
        title: t("plat.deact.title", { name: tm.name }),
        message: html`<p>${tn("plat.deact.msg", tm.members.active)}</p>`,
        confirmLabel: t("users.deactivate"), danger: true,
      });
      if (!ok) return;
    }
    await api.updateTeam(tm.id, { active: !tm.active });
    toast(t(tm.active ? "plat.toast.deactivated" : "plat.toast.activated", { name: tm.name }), { type: "ok" });
    await load();
  }

  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-team-act]");
    if (!b || b.disabled) return;
    try {
      if (b.dataset.teamAct === "add") return await addTeam();
      const tm = find(b.dataset.id);
      if (!tm) return;
      if (b.dataset.teamAct === "enter") { b.disabled = true; return await store.enterTeam(tm.id); }
      if (b.dataset.teamAct === "rename") return await renameTeam(tm);
      if (b.dataset.teamAct === "toggle") return await toggleTeam(tm);
    } catch (err) { b.disabled = false; fail(err); }
  });

  paint();
  load();
}

/** Benutzer eines Teams (Superadmin): Teamname zuerst laden, dann dieselbe Verwaltung wie für Team-Admins */
function renderOneTeam(root, teamId) {
  root.innerHTML = html`<p class="muted pad">${t("common.loading")}</p>`.toString();
  api.listTeams().then((r) => {
    if (!root.isConnected) return;
    const tm = r.teams.find((x) => x.id === teamId);
    if (!tm) {
      root.innerHTML = html`<a href="#/plattform" class="back">${icon("back")} ${t("nav.plattform")}</a><div class="page-head"><h1>${t("plat.notFound")}</h1></div>`.toString();
      return;
    }
    root.innerHTML = html`<div data-team-users></div>${brandingView.cardHtml()}`.toString();
    renderTeamUsers(root.querySelector("[data-team-users]"), { teamId: tm.id, teamName: tm.name, back: { href: "#/plattform", label: t("nav.plattform") } });
    brandingView.bind(root, { teamId: tm.id, teamName: tm.name }); // Logo und Anzeigename dieses Teams (ohne das Team zu betreten)
  }).catch((e) => {
    if (store.handleAuthError(e)) return;
    root.innerHTML = html`<a href="#/plattform" class="back">${icon("back")} ${t("nav.plattform")}</a><p class="muted">${t("plat.teamLoadFailed", { err: e.message })}</p>`.toString();
  });
}

export function render(root, route) {
  if (store.S.mode !== "server" || !store.isSuper()) {
    root.innerHTML = html`<div class="page-head"><h1>${t("nav.plattform")}</h1></div><p class="muted">${t("plat.onlySuper")}</p><p><a class="btn" href="#/uebersicht">${t("app.toOverview")}</a></p>`.toString();
    return;
  }
  if (route?.id) renderOneTeam(root, route.id);
  else renderTeams(root);
}
