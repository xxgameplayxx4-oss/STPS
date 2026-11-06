// STPS CRM – Lesen-Ändern-Schreiben für kleine JSON-Dokumente im Store (optimistisch, mit Wiederholung).
// Der Store hat das Interface aus core.mjs (read/write mit ifMatch/ifNew, list, remove).

/**
 * @param fn (aktuellerWert|null) => neuerWert | undefined (undefined = nichts schreiben). Darf werfen (dann wird nichts geschrieben).
 *           fn kann mehrfach laufen (bei gleichzeitigem Schreiben) und muss deshalb frei von Nebenwirkungen sein.
 * @returns {{changed:boolean, value:any}}
 */
export async function mutateDoc(store, key, fn, { retries = 8 } = {}) {
  for (let i = 0; i < retries; i++) {
    const cur = await store.read(key);
    const next = await fn(cur ? cur.value : null);
    if (next === undefined) return { changed: false, value: cur ? cur.value : null };
    const ok = await store.write(key, next, cur ? { ifMatch: cur.etag } : { ifNew: true });
    if (ok) return { changed: true, value: next };
  }
  throw new Error(`Konflikt beim Speichern von «${key}» – bitte erneut versuchen`);
}
