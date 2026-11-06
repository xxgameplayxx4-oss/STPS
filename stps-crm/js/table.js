// Generische Listenansicht: Suche, Filter, Sortierung, Summenzeile, Zeilenklick, Karten-Layout auf dem Handy.
import { html, raw, compareText, debounce } from "./util.js";
import { icon } from "./ui.js";
import { t } from "./i18n.js";

const states = {}; // gemerkt pro Ansicht (nur im Speicher)

/**
 * cfg: {
 *   id, title, intro?, rows(): [], search(r): string, defaultSort: {key, dir},
 *   columns: [{ key, label, cell(r): html, sort?(r), cls?, align?, total?(rows): string }],
 *   filters?: [{ key, label, options(): [string|{value,label}], test(r, value): bool, default?, tab? }],
 *   tabs?: { key (Schlüssel eines Filters mit tab: true), items(): [{ value, label, count? }], sort?: { <Reiter>: {key, dir} } (Sortierung beim Wechsel), empty?: { <Reiter>: Text } }
 *     – Reiterleiste über der Werkzeugleiste; der Filter mit tab: true erscheint nicht als Auswahlfeld, gehört nicht zu «Filter zurücksetzen»
 *   headExtra?: html (Bedienelement links neben dem «Neu»-Knopf, z. B. Umschalter Liste | Board), newButton?: { label, onClick }, rowHref?(r) | onRow?(id), rowClass?(r), empty?: string, noun?: Sammlung (Wörterbuch ent.<noun>.count)
 * }
 * Die Konfiguration wird bei jedem Zeichnen neu aufgebaut (Beschriftungen in der gewählten Sprache); Suche/Filter/Sortierung
 * bleiben je cfg.id im Speicher erhalten.
 */
export function listView(cfg) {
  return {
    render(root, route = {}) {
      const st = (states[cfg.id] ??= { q: "", f: Object.fromEntries((cfg.filters || []).map((f) => [f.key, f.default ?? ""])), sort: { ...cfg.defaultSort } });
      const tabKey = cfg.tabs?.key;
      const tabSort = (v) => cfg.tabs?.sort?.[v];
      const query = route.query || {};
      const defaults = () => Object.fromEntries((cfg.filters || []).map((f) => [f.key, f.default ?? ""]));
      if (route.navigated && Object.keys(query).length) {
        // Absprung z. B. vom Dashboard: Filter zurücksetzen und gewünschte setzen
        st.q = query.q || "";
        st.f = { ...defaults(), ...Object.fromEntries(Object.entries(query).filter(([k]) => k in defaults())) };
        st.fromQuery = true;
        if (tabKey && tabSort(st.f[tabKey])) st.sort = { ...tabSort(st.f[tabKey]) };
      } else if (route.navigated && st.fromQuery) {
        // Vom Dashboard gesetzte Filter nicht in spätere Besuche der Liste mitschleppen
        st.q = "";
        st.f = defaults();
        st.fromQuery = false;
        if (tabKey && tabSort(st.f[tabKey])) st.sort = { ...tabSort(st.f[tabKey]) };
      }
      const columns = cfg.columns;
      const sortable = columns.filter((c) => c.sort);

      const filterHtml = (cfg.filters || []).filter((f) => !f.tab).map((f) => {
        const opts = f.options().map((o) => (typeof o === "object" ? o : { value: o, label: o }));
        return html`<label class="flt"><span>${f.label}</span><select data-flt="${f.key}"><option value="">${t("tbl.all")}</option>${opts.map((o) => html`<option value="${o.value}" ${String(o.value) === String(st.f[f.key]) ? "selected" : ""}>${o.label}</option>`)}</select></label>`;
      });

      root.innerHTML = html`
        <div class="page-head">
          <div><h1>${cfg.title}</h1>${cfg.intro ? html`<p class="intro">${cfg.intro}</p>` : ""}</div>
          ${cfg.headExtra || cfg.newButton ? html`<div class="head-actions">${cfg.headExtra || ""}${cfg.newButton ? html`<button type="button" class="btn btn-primary" data-new>${icon("plus")} ${cfg.newButton.label}</button>` : ""}</div>` : ""}
        </div>
        ${cfg.tabs ? html`<div class="tabs" role="tablist" data-tabs></div>` : ""}
        <div class="toolbar">
          <label class="search">${icon("search")}<input type="search" id="q-${cfg.id}" placeholder="${t("tbl.search")}" value="${st.q}" autocomplete="off" aria-label="${t("tbl.searchLabel")}"></label>
          ${filterHtml}
          <label class="flt only-mobile"><span>${t("tbl.sort")}</span><select data-sortsel>
            ${sortable.flatMap((c) => ["asc", "desc"].map((dir) => html`<option value="${c.key}:${dir}" ${st.sort.key === c.key && st.sort.dir === dir ? "selected" : ""}>${c.label} ${dir === "asc" ? "↑" : "↓"}</option>`))}
          </select></label>
          <button type="button" class="btn btn-sm btn-ghost" data-reset hidden>${t("tbl.resetFilters")}</button>
          <span class="count" data-count aria-live="polite"></span>
        </div>
        <div class="card table-card"><div class="table-wrap" data-tbl></div></div>`.toString();

      const tbl = root.querySelector("[data-tbl]");
      const countEl = root.querySelector("[data-count]");
      const resetBtn = root.querySelector("[data-reset]");
      const tabsEl = root.querySelector("[data-tabs]");

      function filtered() {
        const q = st.q.trim().toLowerCase();
        let rows = cfg.rows();
        const applyFilter = (f) => {
          const v = st.f[f.key];
          if (v !== "" && v !== undefined) rows = rows.filter((r) => f.test(r, v));
        };
        for (const f of (cfg.filters || []).filter((f) => f.tab)) applyFilter(f);
        const total = rows.length; // bei Reitern: Anzahl im gewählten Reiter
        for (const f of (cfg.filters || []).filter((f) => !f.tab)) applyFilter(f);
        if (q) {
          const terms = q.split(/\s+/);
          rows = rows.filter((r) => {
            const hay = cfg.search(r).toLowerCase();
            return terms.every((t) => hay.includes(t));
          });
        }
        const col = columns.find((c) => c.key === st.sort.key) || sortable[0];
        if (col?.sort) {
          const dir = st.sort.dir === "desc" ? -1 : 1;
          rows = [...rows].sort((a, b) => {
            const va = col.sort(a), vb = col.sort(b);
            const ea = va === null || va === undefined || va === "", eb = vb === null || vb === undefined || vb === "";
            if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // Leere immer zuletzt
            if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
            return compareText(va, vb) * dir;
          });
        }
        return { rows, total };
      }

      function update() {
        const { rows, total } = filtered();
        const active = st.q.trim() !== "" || (cfg.filters || []).some((f) => !f.tab && (st.f[f.key] ?? "") !== (f.default ?? ""));
        resetBtn.hidden = !active;
        if (tabsEl) {
          tabsEl.innerHTML = html`${cfg.tabs.items().map((it) => html`<button type="button" role="tab" class="tab ${st.f[tabKey] === it.value ? "on" : ""}" data-tab="${it.value}" aria-selected="${st.f[tabKey] === it.value ? "true" : "false"}">${it.label}${it.count !== undefined ? html` <span class="count-pill">${it.count}</span>` : ""}</button>`)}`.toString();
        }
        const noun = t(`ent.${cfg.noun}.count`, { n: total });
        countEl.textContent = rows.length === total ? t("tbl.countAll", { n: total, noun }) : t("tbl.countOf", { n: rows.length, total, noun });
        if (!rows.length) {
          tbl.innerHTML = html`<div class="empty"><p>${total ? t("tbl.noMatches") : (tabKey && cfg.tabs.empty?.[st.f[tabKey]]) || cfg.empty || t("tbl.noEntries")}</p>${!total && cfg.newButton ? html`<button type="button" class="btn btn-primary" data-new>${icon("plus")} ${cfg.newButton.label}</button>` : ""}</div>`.toString();
          return;
        }
        const hasTotals = columns.some((c) => c.total);
        tbl.innerHTML = html`<table class="tbl">
          <thead><tr>${columns.map((c) => {
            const cls = `${c.cls || ""} ${c.align === "right" ? "num" : ""}`;
            if (!c.sort) return html`<th class="${cls}" scope="col">${c.label}</th>`;
            const on = st.sort.key === c.key;
            return html`<th class="${cls} sortable" scope="col" aria-sort="${on ? (st.sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn ${on ? "on" : ""}" data-sort="${c.key}">${c.label}<span class="arr" aria-hidden="true">${on ? (st.sort.dir === "asc" ? "▲" : "▼") : ""}</span></button></th>`;
          })}</tr></thead>
          <tbody>${rows.map((r) => html`<tr data-id="${r.id}" ${cfg.rowHref ? html`data-href="${cfg.rowHref(r)}" tabindex="0"` : cfg.onRow ? raw('tabindex="0"') : ""} class="${cfg.rowClass ? cfg.rowClass(r) : ""} ${cfg.rowHref || cfg.onRow ? "clickable" : ""}">${columns.map((c, i) => html`<td data-label="${c.label}" class="${c.cls || ""} ${c.align === "right" ? "num" : ""} ${i === 0 ? "c-first" : ""}">${c.cell(r)}</td>`)}</tr>`)}</tbody>
          ${hasTotals ? html`<tfoot><tr>${columns.map((c, i) => html`<td class="${c.cls || ""} ${c.align === "right" ? "num" : ""}" data-label="${c.total ? c.label : ""}">${i === 0 ? html`${t("tbl.total", { n: rows.length })}` : c.total ? c.total(rows) : ""}</td>`)}</tr></tfoot>` : ""}
        </table>`.toString();
      }

      const onSearch = debounce(() => update(), 120);
      root.addEventListener("input", (e) => {
        if (e.target.matches('input[type="search"]')) { st.q = e.target.value; st.fromQuery = false; onSearch(); }
      });
      root.addEventListener("change", (e) => {
        const t = e.target;
        if (t.dataset.flt) { st.f[t.dataset.flt] = t.value; st.fromQuery = false; update(); }
        else if (t.dataset.sortsel !== undefined) {
          const [key, dir] = t.value.split(":");
          st.sort = { key, dir };
          update();
        }
      });
      root.addEventListener("click", (e) => {
        const t = e.target;
        const tabBtn = t.closest("[data-tab]");
        if (tabBtn) {
          st.f[tabKey] = tabBtn.dataset.tab;
          if (tabSort(tabBtn.dataset.tab)) st.sort = { ...tabSort(tabBtn.dataset.tab) };
          st.fromQuery = false;
          const sel = root.querySelector("[data-sortsel]");
          if (sel) sel.value = `${st.sort.key}:${st.sort.dir}`;
          update();
          root.querySelector(`[data-tab="${tabBtn.dataset.tab}"]`)?.focus();
          return;
        }
        const sortBtn = t.closest("[data-sort]");
        if (sortBtn) {
          const key = sortBtn.dataset.sort;
          st.sort = st.sort.key === key ? { key, dir: st.sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
          const sel = root.querySelector("[data-sortsel]");
          if (sel) sel.value = `${st.sort.key}:${st.sort.dir}`;
          update();
          root.querySelector(`[data-sort="${key}"]`)?.focus();
          return;
        }
        if (t.closest("[data-new]")) { cfg.newButton.onClick(); return; }
        if (t.closest("[data-reset]")) {
          st.q = "";
          st.f = { ...defaults(), ...(tabKey ? { [tabKey]: st.f[tabKey] } : {}) };
          st.fromQuery = false;
          root.querySelector('input[type="search"]').value = "";
          root.querySelectorAll("[data-flt]").forEach((s) => { s.value = st.f[s.dataset.flt]; });
          update();
          return;
        }
        const tr = t.closest("tr[data-id]");
        if (tr && !t.closest("a,button,input,select,textarea,label")) openRow(tr);
      });
      root.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches("tr[data-id]")) openRow(e.target);
      });
      function openRow(tr) {
        if (tr.dataset.href) location.hash = tr.dataset.href;
        else if (cfg.onRow) cfg.onRow(tr.dataset.id);
      }

      update();
    },
  };
}
