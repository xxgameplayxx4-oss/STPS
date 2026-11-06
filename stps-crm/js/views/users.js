// Benutzerverwaltung: Team-Admins verwalten ihr Team, der Superadmin jedes Team (Seite «Plattform → Benutzer»).
// Außerdem: eigenes Passwort ändern, Anzeige des eigenen Kontos in den Einstellungen, Einmalpasswort-Dialog.
import * as store from "../store.js";
import * as api from "../api.js";
import { html, th, fmtDateTime } from "../util.js";
import { t } from "../i18n.js";
import { icon, toast, confirmDialog, openForm } from "../ui.js";
import { roleLabel, relTime } from "./team.js";

// ------------------------------------------------------------ Hilfen

async function copyText(text, within) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback unten */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.className = "sr";
    (within || document.body).appendChild(ta); // innerhalb des modalen Dialogs, sonst ist es «inert»
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Einmalpasswort anzeigen (nur jetzt!) mit «Kopieren». */
export async function showTempPassword({ name, username, password, reset = false }) {
  const done = confirmDialog({
    title: reset ? t("tempPw.titleReset", { name }) : t("tempPw.titleNew", { name }),
    message: html`<p>${th("tempPw.username", { username })}</p><p>${t("tempPw.once")}</p><div class="temp-pw"><code data-temp-pw>${password}</code><button type="button" class="btn btn-sm" data-copy-pw>${icon("copy")} ${t("tempPw.copy")}</button></div><p class="muted">${t("tempPw.must", { name })}</p>`,
    confirmLabel: t("tempPw.done"),
    cancelLabel: "",
  });
  const dlg = document.querySelector("dialog[open]");
  const btn = dlg?.querySelector("[data-copy-pw]");
  btn?.addEventListener("click", async () => {
    const ok = await copyText(password, dlg);
    btn.innerHTML = html`${icon("copy")} ${ok ? t("tempPw.copied") : t("tempPw.copyManual")}`.toString();
  });
  await done;
}

/** Eigenes Passwort ändern (Formular als Seitenpanel) */
export async function changeOwnPassword() {
  await openForm({
    title: t("acct.changePassword"),
    subtitle: store.getMe()?.displayName,
    fields: [
      { key: "cur", label: t("pw.current"), type: "password", required: true, full: true, autocomplete: "current-password" },
      { key: "next", label: t("pw.new"), type: "password", required: true, full: true, help: t("pw.help") },
      { key: "rep", label: t("pw.repeat"), type: "password", required: true, full: true },
    ],
    values: {},
    submitLabel: t("acct.changePassword"),
    validate: (v) => ({
      next: v.next && v.next.length < 10 ? t("pw.min10") : "",
      rep: v.rep && v.next !== v.rep ? t("pw.mismatch") : "",
    }),
    async onSubmit(v) {
      await store.changePassword(v.cur, v.next);
      toast(t("pw.changed"), { type: "ok" });
    },
  });
}

// ------------------------------------------------------------ Einstellungen: Konto + Link

/** Block «Ich bin»/Konto in Einstellungen → Benutzer & Verbindung */
export function identityHtml() {
  const me = store.getMe();
  if (store.S.mode === "local" || !me) {
    return html`<label class="field"><span class="label">${t("auth.iAm")}</span>
      <select data-set="user">${!store.getUser() ? html`<option value="">${t("users.me.pick")}</option>` : ""}${store.ownerNames().map((n) => html`<option ${n === store.getUser() ? "selected" : ""}>${n}</option>`)}</select>
      <span class="help">${t("users.me.iAmHelp")}</span></label>`;
  }
  const team = store.getTeam();
  return html`<dl class="dl flush">
      <div><dt>${t("users.me.signedInAs")}</dt><dd>${me.displayName} <span class="muted">(${me.username})</span></dd></div>
      <div><dt>${t("users.col.role")}</dt><dd>${roleLabel(me.role)}</dd></div>
      ${team ? html`<div><dt>${t("nav.team")}</dt><dd>${team.name}</dd></div>` : ""}
      ${me.role !== "superadmin" ? html`<div><dt>${t("users.col.owner")}</dt><dd>${me.ownerKey || html`<span class="muted">${t("users.me.noOwner")}</span>`}</dd></div>` : ""}
    </dl>`;
}

/** Karte «Benutzer» in den Einstellungen (nur für Admins) */
export function settingsCard() {
  if (store.S.mode !== "server" || !store.isTeamAdmin()) return "";
  const team = store.getTeam();
  return html`<section class="card">
    <div class="card-head"><h2>${t("nav.benutzer")}</h2></div>
    <div class="pad"><p class="help">${t("users.card.help", { team: team ? t("users.card.ofTeam", { team: team.name }) : "" })}</p>
      <a class="btn btn-primary" href="#/benutzer">${icon("team")} ${t("users.card.manage")}</a></div>
  </section>`;
}

// ------------------------------------------------------------ Seite «Benutzer»

const roleOptions = () => [{ value: "admin", label: t("users.role.admin") }, { value: "member", label: roleLabel("member") }];
const roleBadge = (r) => html`<span class="badge ${r === "admin" ? "t-navy" : "t-grey"}">${roleLabel(r)}</span>`;
/** Management-Kennzeichen: Zugang zum Chat-Kanal «Geschäftsleitung» (Team-Admins haben ihn ohnehin) */
const mgmtBadge = (u) => (u.management && u.role !== "admin" ? html` <span class="badge t-amber" title="${t("users.mgmt.title")}">${t("users.mgmt.badge")}</span>` : "");

/**
 * Benutzerliste eines Teams. opts: {teamId (nur Superadmin), teamName, back: {href, label}}
 * Team-Admin: immer das eigene Team (der Server ignoriert teamId).
 */
export function renderTeamUsers(root, opts = {}) {
  const me = store.getMe();
  const st = { users: null, error: "" };

  const paint = () => {
    const users = st.users;
    root.innerHTML = html`
      ${opts.back ? html`<a href="${opts.back.href}" class="back">${icon("back")} ${opts.back.label}</a>` : ""}
      <div class="page-head">
        <div><h1>${t("nav.benutzer")}${opts.teamName ? html` <span class="muted">· ${opts.teamName}</span>` : ""}</h1>
          <p class="intro">${t("users.intro")}</p></div>
        <button type="button" class="btn btn-primary" data-user-act="add">${icon("plus")} ${t("users.add")}</button>
      </div>
      <div class="card table-card">
        ${users === null
          ? html`<p class="muted pad">${st.error ? t("users.loadFailed", { err: st.error }) : t("common.loading")}</p>`
          : html`<div class="table-wrap"><table class="tbl">
            <thead><tr><th>${t("users.col.name")}</th><th>${t("users.col.role")}</th><th>${t("users.col.owner")}</th><th>${t("users.col.status")}</th><th>${t("users.col.lastLogin")}</th><th></th></tr></thead>
            <tbody>${users.map((u) => {
              const self = u.id === me?.id;
              return html`<tr class="${u.active ? "" : "is-done"}">
                <td data-label="${t("users.col.name")}" class="c-first"><div>${u.displayName}${self ? html` <span class="muted">${t("team.you")}</span>` : ""}<small class="muted block">@${u.username}${u.email ? ` · ${u.email}` : ""}</small></div></td>
                <td data-label="${t("users.col.role")}">${roleBadge(u.role)}${mgmtBadge(u)}</td>
                <td data-label="${t("users.col.owner")}">${u.ownerKey || html`<span class="muted">–</span>`}</td>
                <td data-label="${t("users.col.status")}">${u.active ? html`<span class="badge t-green">${t("team.active")}</span>` : html`<span class="badge t-grey">${t("users.inactive")}</span>`}${u.mustChangePassword ? html` <span class="badge t-amber" title="${t("users.oneTimePwTitle")}">${t("users.oneTimePw")}</span>` : ""}</td>
                <td data-label="${t("users.col.lastLogin")}">${u.lastLoginAt ? html`<span title="${fmtDateTime(u.lastLoginAt)}">${relTime(u.lastLoginAt)}</span>` : html`<span class="muted">${t("users.never")}</span>`}</td>
                <td class="act"><div class="row-actions">
                  <button type="button" class="btn btn-sm" data-user-act="edit" data-id="${u.id}">${icon("edit")} ${t("common.edit")}</button>
                  <button type="button" class="btn btn-sm" data-user-act="reset" data-id="${u.id}" ${self ? html`disabled title="${t("users.ownPwHint")}"` : ""}>${icon("key")} ${t("users.pw")}</button>
                  <button type="button" class="btn btn-sm ${u.active ? "btn-danger-ghost" : ""}" data-user-act="toggle" data-id="${u.id}" ${self ? html`disabled title="${t("users.noSelfDeactivate")}"` : ""}>${u.active ? t("users.deactivate") : t("users.activate")}</button>
                </div></td></tr>`;
            })}</tbody></table></div>`}
      </div>`.toString();
  };

  async function load() {
    try {
      st.users = (await api.listUsers(opts.teamId)).users.filter((u) => u.role !== "superadmin");
      st.error = "";
    } catch (e) {
      if (store.handleAuthError(e)) return;
      st.error = e.message || t("common.error");
    }
    if (root.isConnected) paint();
  }

  const find = (id) => st.users?.find((u) => u.id === id);
  const fail = (e) => { if (!store.handleAuthError(e)) toast(e.message || t("toast.actionFailed"), { type: "error", ms: 8000 }); };

  async function addUser() {
    let created = null;
    await openForm({
      title: t("users.new.title"),
      subtitle: opts.teamName || store.getTeam()?.name,
      fields: [
        { key: "username", label: t("users.f.username"), type: "text", required: true, full: true, placeholder: t("users.f.usernamePh"), help: t("users.f.usernameHelp") },
        { key: "displayName", label: t("users.f.displayName"), type: "text", required: true, full: true, placeholder: t("users.f.displayNamePh") },
        { key: "role", label: t("users.col.role"), type: "select", options: roleOptions(), required: true, full: true },
        { key: "management", label: t("users.f.management"), type: "checkbox", help: t("users.f.managementHelp") },
        { key: "email", label: t("users.f.email"), type: "email", full: true, help: t("users.f.emailHelp") },
        { key: "ownerKey", label: t("users.f.ownerKey"), type: "text", full: true, help: t("users.f.ownerKeyHelpNew") },
      ],
      values: { role: "member", management: false },
      submitLabel: t("users.new.submit"),
      async onSubmit(v) {
        created = await api.createUser({ ...v, ...(opts.teamId ? { teamId: opts.teamId } : {}), ownerKey: v.ownerKey || undefined, email: v.email || undefined, management: Boolean(v.management) });
      },
    });
    if (!created) return;
    await load();
    await showTempPassword({ name: created.user.displayName, username: created.user.username, password: created.temporaryPassword });
  }

  async function editUser(u) {
    const self = u.id === me?.id;
    await openForm({
      title: t("users.edit.title"),
      subtitle: `@${u.username}`,
      fields: [
        { key: "displayName", label: t("users.f.displayName"), type: "text", required: true, full: true },
        ...(self ? [] : [{ key: "role", label: t("users.col.role"), type: "select", options: roleOptions(), required: true, full: true }]),
        { key: "management", label: t("users.f.management"), type: "checkbox", help: t("users.f.managementHelp") },
        { key: "email", label: t("users.f.email"), type: "email", full: true, help: t("users.f.emailHelp") },
        { key: "ownerKey", label: t("users.f.ownerKey"), type: "text", full: true, help: t("users.f.ownerKeyHelpEdit") },
      ],
      values: { displayName: u.displayName, role: u.role, ownerKey: u.ownerKey, email: u.email || "", management: Boolean(u.management) },
      async onSubmit(v) {
        const patch = {};
        for (const k of ["displayName", "role", "ownerKey", "email"]) if (k in v && v[k] !== (u[k] ?? "")) patch[k] = v[k];
        if ("management" in v && Boolean(v.management) !== Boolean(u.management)) patch.management = Boolean(v.management);
        if (!Object.keys(patch).length) return;
        await api.updateUser(u.id, patch);
        toast(t("users.edit.saved"), { type: "ok" });
      },
    });
    await load();
  }

  async function resetPassword(u) {
    const ok = await confirmDialog({
      title: t("users.reset.title"),
      message: html`<p>${th("users.reset.msg", { name: u.displayName })}</p>`,
      confirmLabel: t("users.reset.confirm"), danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.updateUser(u.id, { resetPassword: true });
      await load();
      await showTempPassword({ name: u.displayName, username: u.username, password: r.temporaryPassword, reset: true });
    } catch (e) { fail(e); }
  }

  async function toggleActive(u) {
    if (u.active) {
      const ok = await confirmDialog({
        title: t("users.deact.title"),
        message: html`<p>${th("users.deact.msg", { name: u.displayName })}</p>`,
        confirmLabel: t("users.deactivate"), danger: true,
      });
      if (!ok) return;
    }
    try {
      await api.updateUser(u.id, { active: !u.active });
      toast(t(u.active ? "users.toast.deactivated" : "users.toast.activated", { name: u.displayName }), { type: "ok" });
      await load();
    } catch (e) { fail(e); }
  }

  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-user-act]");
    if (!b || b.disabled) return;
    try {
      if (b.dataset.userAct === "add") return await addUser();
      const u = find(b.dataset.id);
      if (!u) return;
      if (b.dataset.userAct === "edit") return await editUser(u);
      if (b.dataset.userAct === "reset") return await resetPassword(u);
      if (b.dataset.userAct === "toggle") return await toggleActive(u);
    } catch (err) { fail(err); }
  });

  paint();
  load();
}

/** Route #/benutzer: Team-Admin → eigenes Team; Superadmin (mit betretenem Team) → dieses Team */
export function render(root) {
  if (store.S.mode !== "server" || !store.isTeamAdmin()) {
    root.innerHTML = html`<div class="page-head"><h1>${t("nav.benutzer")}</h1></div><p class="muted">${t("users.onlyAdmin")}</p><p><a class="btn" href="#/uebersicht">${t("app.toOverview")}</a></p>`.toString();
    return;
  }
  renderTeamUsers(root, { teamId: store.isSuper() ? store.getTeam()?.id : undefined, teamName: store.getTeam()?.name, back: { href: "#/einstellungen", label: t("nav.einstellungen") } });
}
