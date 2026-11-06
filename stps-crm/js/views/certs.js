// Lieferanten-Dokumente/Zertifikate: Editor im Lieferanten-Formular (Feldtyp «widget»), Karte in der Detailansicht, Warn-Badge für Listen.
// Gespeichert wird nur ein Verweis (Name, Link, gültig bis) – die Dateien selbst liegen z. B. in SharePoint/OneDrive.
import { html, fmtDate, todayISO, uid } from "../util.js";
import { t } from "../i18n.js";
import { icon } from "../ui.js";
import { certState, docsOf, certSummary, safeUrl } from "../certs.js";

const STATE_TONE = { expired: "red", soon: "amber", ok: "green" };

/** Kleines Zeichen für den Gültigkeits-Status (leer ohne Ablaufdatum) */
export const stateBadge = (state) => (state ? html`<span class="badge t-${STATE_TONE[state]}">${t(`cert.state.${state}`)}</span>` : "");

/** Warn-Badge(s) für Listen/Kopfzeile: abgelaufene und bald ablaufende Dokumente */
export function warnBadges(s) {
  const c = certSummary(s, todayISO());
  return html`${c.expired ? html`<span class="badge t-red" title="${t("cert.warn.expiredTitle")}">${t("cert.warn.expired", { n: c.expired })}</span>` : ""}${c.soon ? html` <span class="badge t-amber" title="${t("cert.warn.soonTitle")}">${t("cert.warn.soon", { n: c.soon })}</span>` : ""}`;
}

/** Karte «Dokumente & Zertifikate» der Lieferanten-Detailansicht */
export function certsCard(s) {
  const docs = docsOf(s);
  const today = todayISO();
  return html`<section class="card" data-certs-card>
    <div class="card-head"><h2>${t("cert.title")} <span class="count">${docs.length}</span></h2></div>
    ${docs.length
      ? html`<ul class="cert-list">${docs.map((d) => {
        const st = certState(d, today);
        const href = safeUrl(d.link);
        return html`<li class="cert ${st === "expired" ? "is-expired" : ""}">
          <div class="cert-main">${href ? html`<a href="${href}" target="_blank" rel="noopener noreferrer" class="rowlink">${icon("link")} ${d.name || href}</a>` : html`<strong>${d.name || "–"}</strong>`}</div>
          <div class="cert-meta">${d.gueltigBis ? html`<span class="muted">${t("cert.validUntil")}: ${fmtDate(d.gueltigBis)}</span>` : html`<span class="muted">${t("cert.noExpiry")}</span>`} ${stateBadge(st)}</div>
        </li>`;
      })}</ul>`
      : html`<p class="muted pad">${t("cert.none")}</p>`}
  </section>`;
}

const blank = () => ({ id: uid(), name: "", link: "", gueltigBis: "" });

/** Feldobjekt für openForm: Liste von Dokumenten (Name, Link, gültig bis). Wert = Array in `dokumente`. */
export function certsField() {
  let el = null;
  let rows = [];
  let ctx = null;

  const rowHtml = (d, i) => html`<div class="cert-row" data-cert="${d.id}">
    <label class="pf cert-name"><span>${t("cert.f.name")}</span><input type="text" data-c="name" autocomplete="off" placeholder="${t("cert.f.namePh")}" value="${d.name}"></label>
    <label class="pf cert-link"><span>${t("cert.f.link")}</span><input type="text" data-c="link" autocomplete="off" inputmode="url" placeholder="https://" value="${d.link}"></label>
    <label class="pf cert-date"><span>${t("cert.f.validUntil")}</span><input type="date" data-c="gueltigBis" value="${d.gueltigBis || ""}"></label>
    <button type="button" class="icon-btn" data-c-del aria-label="${t("cert.remove")}" title="${t("cert.remove")}">${icon("trash")}</button>
  </div>`;
  const paint = () => {
    el.innerHTML = html`<div class="cert-ed">${rows.map(rowHtml)}<button type="button" class="btn btn-sm" data-c-add>${icon("plus")} ${t("cert.add")}</button></div>`.toString();
  };

  const widget = {
    mount(host, vals, c) {
      el = host; ctx = c;
      rows = docsOf(vals).map((d) => ({ id: d.id || uid(), name: d.name || "", link: d.link || "", gueltigBis: d.gueltigBis || "" }));
      paint();
      el.addEventListener("input", (e) => {
        const key = e.target.dataset?.c;
        const row = e.target.closest("[data-cert]");
        if (!key || !row) return;
        rows.find((r) => r.id === row.dataset.cert)[key] = e.target.value;
        ctx.changed();
      });
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-c-add]")) { rows.push(blank()); ctx.changed(); paint(); el.querySelector(".cert-row:last-of-type [data-c=name]")?.focus(); return; }
        const del = e.target.closest("[data-c-del]");
        if (del) { const id = del.closest("[data-cert]").dataset.cert; rows = rows.filter((r) => r.id !== id); ctx.changed(); paint(); }
      });
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) e.preventDefault(); });
    },
    read() {
      const used = rows.filter((r) => r.name.trim() || r.link.trim() || r.gueltigBis);
      for (const r of used) {
        if (!r.name.trim()) return { value: null, error: t("cert.err.name") };
        if (r.link.trim() && !safeUrl(r.link)) return { value: null, error: t("cert.err.link", { name: r.name.trim() }) };
      }
      return { value: used.map((r) => ({ id: r.id, name: r.name.trim(), link: r.link.trim(), gueltigBis: r.gueltigBis || "" })) };
    },
  };
  return { key: "dokumente", type: "widget", get label() { return t("cert.title"); }, full: true, widget };
}
