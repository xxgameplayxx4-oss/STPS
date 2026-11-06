// Seitenpanel (Slide-over) für Erfassen/Bearbeiten: Verhalten rund um das native <dialog> (modal, oberste Ebene).
// Das Formular selbst baut ui.js openForm(); hier steckt nur, was ein Panel ausmacht:
//  - Esc und Klick auf den Hintergrund fragen über requestClose() an (Schutz vor ungespeicherten Änderungen liegt beim Aufrufer)
//  - Ctrl/Cmd+Enter speichert, Tab bleibt im Panel (Fokusfalle), beim Schliessen geht der Fokus zurück an den Auslöser
//  - gestapelte Panels (z. B. Kontakt-Formular aus dem Kunden-Formular): das untere rückt zur Seite und bleibt unbedienbar,
//    Esc/Hintergrund wirken nur auf das oberste Panel. Bestätigungsdialoge bleiben zentrierte Modale (ui.js confirmDialog).
// Es gibt nur ein Panel-System: dialog.drawer (Grösse/Aussehen in app.css, Stapel/Handy-Blatt in slideover.css).
// Selektoren für Tests: dialog.drawer[open], [data-close], button[type=submit].

const stack = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

function relayer() {
  const max = stack.length - 1;
  stack.forEach((p, i) => {
    p.dataset.depth = String(max - i);          // 0 = oberstes Panel
    p.classList.toggle("so-under", i < max);
  });
}

/**
 * Zeigt ein bereits aufgebautes <dialog> als Seitenpanel.
 * @param {HTMLDialogElement} d
 * @param {{requestClose:()=>void, submit?:()=>void}} o requestClose: Anfrage zum Schliessen (Esc, Hintergrund); submit: Ctrl+Enter
 */
export function openSlideOver(d, { requestClose, submit } = {}) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let downOnBackdrop = false;
  d.addEventListener("pointerdown", (e) => { downOnBackdrop = e.target === d; });
  d.addEventListener("click", (e) => {
    if (e.target === d && downOnBackdrop) requestClose?.();
    downOnBackdrop = false;
  });

  // Ctrl/Cmd+Enter im Capture-Durchgang: gilt auch in Feldern, die Enter selbst behandeln (z. B. Artikelsuche der Positionen)
  d.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && submit) { e.preventDefault(); e.stopPropagation(); submit(); }
  }, true);

  d.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (e.key === "Escape") { e.preventDefault(); requestClose?.(); return; }
    if (e.key !== "Tab") return;
    const items = [...d.querySelectorAll(FOCUSABLE)].filter(visible);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const act = document.activeElement;
    if (e.shiftKey && (act === first || !d.contains(act))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (act === last || !d.contains(act))) { e.preventDefault(); first.focus(); }
  });

  // Auslöser merken; wurde die Ansicht inzwischen neu gezeichnet, wird ein gleichartiges Element gesucht
  const sel = opener ? ["data-act", "data-new", "data-id", "id"].filter((a) => opener.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(opener.getAttribute(a))}"]`).join("") : "";
  const sameTag = opener ? opener.tagName.toLowerCase() : "";

  d.addEventListener("close", () => {
    const i = stack.indexOf(d);
    if (i >= 0) stack.splice(i, 1);
    relayer();
    // Fokus zurück an den Auslöser; die Ansicht zeichnet sich nach dem Schliessen oft neu, daher auch kurz danach noch einmal
    const restore = () => {
      const a = document.activeElement;
      if (a && a !== document.body && document.contains(a)) return;
      const target = opener && opener.isConnected ? opener : sel ? document.querySelector(sameTag + sel) : null;
      if (target && !target.closest("[hidden]")) { try { target.focus({ preventScroll: true }); } catch { /* ignorieren */ } }
    };
    restore();
    setTimeout(restore, 60);
    setTimeout(restore, 250);
  });

  stack.push(d);
  relayer();
  d.showModal();
}

export const slideOverDepth = () => stack.length;
