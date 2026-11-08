// STPS CRM – Auswahl des Speichers. Standard: Netlify Blobs. Mit DB_DRIVER=mysql: MySQL (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL).
// open() ist synchron und billig; der Adapter verbindet sich erst beim ersten Aufruf (Pool wird je Prozess wiederverwendet).
import { createBlobsAdapter } from "./core.mjs";

let pool; // Promise<Pool>, nur MySQL
const getPool = () => (pool ??= import("./kv-mysql.mjs").then((m) => m.createMysqlPool(process.env)));

export function open(env = process.env) {
  if ((env.DB_DRIVER || "").toLowerCase() === "mysql") {
    const lazy = (name) => async (...a) => {
      const { createMysqlAdapter } = await import("./kv-mysql.mjs");
      return createMysqlAdapter(await getPool())[name](...a);
    };
    return { read: lazy("read"), write: lazy("write"), list: lazy("list"), remove: lazy("remove"), readBin: lazy("readBin"), writeBin: lazy("writeBin") };
  }
  // Blobs: getStore() je Aufruf neu (nimmt die Zugangsdaten des laufenden Aufrufs, siehe api.mjs)
  const blobs = () => import("@netlify/blobs").then(({ getStore }) => createBlobsAdapter(getStore({ name: "stps-crm", consistency: "strong" })));
  const lazy = (name) => async (...a) => (await blobs())[name](...a);
  return { read: lazy("read"), write: lazy("write"), list: lazy("list"), remove: lazy("remove"), readBin: lazy("readBin"), writeBin: lazy("writeBin") };
}
