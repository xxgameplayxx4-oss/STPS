// Dateien (Zertifikate, Chat-Anhänge): hochladen, herunterladen, löschen – ein Zugang für beide Betriebsarten.
//  - Servermodus: /api/files (Team-Namensraum, max. 10 MB, PDF/PNG/JPG/WEBP; Berechtigung prüft der Server bei jeder Anfrage).
//  - Lokaler Modus (keine API): kleine Dateien (≤ 2 MB) werden als Data-URL in der lokalen Datenbank abgelegt – mit Warnung (Browser-Speicher
//    ist begrenzt, die Datei steckt in der JSON-Sicherung).
// Ein Verweis auf eine Datei ist {id, name, type, size, scope?} – in Datensätzen wird nur dieser Verweis gespeichert.
// Herunterladen: jedes Element mit data-file-id (und data-file-name) lädt beim Klick; der Handler hängt am Dokument (einmal).
import * as api from "./api.js";
import * as store from "./store.js";
import { uid } from "./util.js";
import { t } from "./i18n.js";
import { toast } from "./ui.js";

export const MAX_BYTES = 10 * 1024 * 1024;
export const LOCAL_MAX_BYTES = 2 * 1024 * 1024;
export const TYPES = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";
const EXT_TYPE = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export const isLocalMode = () => store.S.mode === "local";
export const isLocalId = (id) => typeof id === "string" && id.startsWith("loc_");

/** Dateityp aus Browser-Angabe oder Endung; "" = nicht erlaubt (der Server prüft zusätzlich an den Bytes) */
export function typeOf(file) {
  if (TYPES[file?.type]) return file.type;
  const ext = String(file?.name || "").split(".").pop().toLowerCase();
  return EXT_TYPE[ext] || "";
}

export const sizeLabel = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(/\.0$/, "")} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

const readDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error(t("file.readFailed")));
  r.readAsDataURL(file);
});

/**
 * Datei hochladen. Wirft Error (Text bereits in der Sprache der Oberfläche).
 * @param {File} file
 * @param {{scope?: "team"|"mgmt"}} o
 * @returns {Promise<{id, name, type, size, scope, local?: true}>}
 */
export async function upload(file, { scope = "team" } = {}) {
  const type = typeOf(file);
  if (!type) throw new Error(t("file.err.type"));
  if (!file.size) throw new Error(t("file.err.empty"));
  if (file.size > MAX_BYTES) throw new Error(t("file.err.tooLarge", { max: "10 MB" }));
  if (isLocalMode()) {
    if (file.size > LOCAL_MAX_BYTES) throw new Error(t("file.err.localLarge", { max: "2 MB" }));
    const data = await readDataUrl(file.type === type ? file : new Blob([file], { type }));
    const id = "loc_" + uid().replace(/-/g, "").slice(0, 16);
    const rec = { name: file.name, type, size: file.size, data };
    store.localFilePut(id, rec);
    toast(t("file.localWarn"), { type: "warn", ms: 9000 });
    return { id, name: file.name, type, size: file.size, scope, local: true };
  }
  if (store.S.mode !== "server") throw new Error(t("file.err.offline"));
  const r = await api.fileUpload(file, { name: file.name, scope });
  return r.file;
}

function dataUrlToBlob(dataUrl, type) {
  const bin = atob(String(dataUrl).slice(String(dataUrl).indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Bytes einer Datei (Server oder lokale Datenbank) als Blob */
export async function fetchBlob(ref) {
  if (isLocalId(ref.id)) {
    const rec = store.localFileGet(ref.id);
    if (!rec) throw new Error(t("file.err.gone"));
    return dataUrlToBlob(rec.data, rec.type); // kein fetch(): die CSP (connect-src 'self') erlaubt keine data:-Adressen
  }
  return api.fileDownload(ref.id);
}

/** Datei herunterladen (Browser-Download; bei Fehler Hinweis) */
export async function download(ref) {
  try {
    const blob = await fetchBlob(ref);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ref.name || "datei";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    if (!store.handleAuthError(e)) toast(e.message || t("file.err.download"), { type: "error", ms: 8000 });
  }
}

/** Datei löschen (still: ein Fehler ist unwichtig, übrig bleibt höchstens eine verwaiste Datei) */
export async function discard(ref) {
  if (!ref?.id) return;
  try {
    if (isLocalId(ref.id)) store.localFileDel(ref.id);
    else if (store.S.mode === "server") await api.fileDelete(ref.id);
  } catch { /* ignorieren */ }
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.("[data-file-id]");
    if (!el) return;
    e.preventDefault();
    if (el.disabled || el.dataset.busy) return;
    el.dataset.busy = "1";
    download({ id: el.dataset.fileId, name: el.dataset.fileName || "datei" }).finally(() => { delete el.dataset.busy; });
  });
}
