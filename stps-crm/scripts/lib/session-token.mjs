// Test-Helfer: Das Sitzungs-Token steht nur noch im Set-Cookie-Header (HttpOnly, __Host-…), nie im JSON-Body.
const NAMES = ["__Host-stps_session", "stps_session"];

/** Token aus den Set-Cookie-Zeilen einer Antwort (handleApi: res.setCookie; fetch: res.headers.getSetCookie()). "" wenn keines gesetzt/gelöscht. */
export function tokenFromCookies(lines) {
  for (const line of lines || []) {
    const [pair] = String(line).split(";");
    const i = pair.indexOf("=");
    if (i > 0 && NAMES.includes(pair.slice(0, i).trim())) return pair.slice(i + 1).trim();
  }
  return "";
}

export const tokenOf = (res) => tokenFromCookies(res?.setCookie ?? res?.headers?.getSetCookie?.());

/** Kopie der Antwort, bei der body.token aus dem Cookie ergänzt ist (nur für Tests, die Sitzungen für Bearer-Aufrufe brauchen). */
export const withSessionToken = (res) => {
  const token = tokenOf(res);
  return token && res.body && typeof res.body === "object" ? { ...res, body: { ...res.body, token } } : res;
};
