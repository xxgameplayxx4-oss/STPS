// STPS CRM – Laufzeit-Umgebung erkennen: Produktion / bereitgestellte Netlify-Site / lokale Entwicklung.
// Reine Funktionen (testbar). Sie prüfen die übergebene Umgebung UND process.env (fail-closed: ein Produktions-Signal in einer von beiden genügt).

const penv = () => (typeof process !== "undefined" && process.env ? process.env : {});
const flag = (v, want) => String(v ?? "").trim().toLowerCase() === want;

/** NODE_ENV/CRM_ENV=production oder VPS-Betrieb (MySQL-Speicher konfiguriert). */
export function isProductionEnv(env) {
  const vps = (e) => flag(e?.DB_DRIVER, "mysql") || Boolean(String(e?.DB_HOST ?? "").trim());
  return [env?.NODE_ENV, env?.CRM_ENV, penv().NODE_ENV, penv().CRM_ENV].some((v) => flag(v, "production")) || vps(env) || vps(penv());
}

/** `netlify dev` (lokal): die CLI setzt NETLIFY_DEV=true (bzw. NETLIFY_LOCAL=true). */
export const isNetlifyLocalDev = (env) => flag(env?.NETLIFY_DEV, "true") || flag(env?.NETLIFY_LOCAL, "true");

/** Bereitgestellte Netlify-Site (Build/Functions-Laufzeit): NETLIFY/CONTEXT/DEPLOY_ID bzw. Lambda-Laufzeit – und NICHT `netlify dev`. */
export function isDeployedNetlify(env) {
  const hit = (e) =>
    !isNetlifyLocalDev(e) &&
    (flag(e?.NETLIFY, "true") || Boolean(String(e?.CONTEXT ?? "").trim()) || Boolean(String(e?.DEPLOY_ID ?? "").trim()) ||
      Boolean(String(e?.AWS_LAMBDA_FUNCTION_NAME ?? "").trim()) || Boolean(String(e?.LAMBDA_TASK_ROOT ?? "").trim()));
  return hit(env) || (hit(penv()) && !isNetlifyLocalDev(env));
}

/** Produktion oder bereitgestellte Site – überall dort, wo Komfort nie über Sicherheit gehen darf. */
export const isDeployedEnv = (env) => isProductionEnv(env) || isDeployedNetlify(env);
