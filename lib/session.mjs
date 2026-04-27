import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "osu_scripts_session";
const SESSION_RE = /^[0-9a-f]{64}$/i;
const MAX_AGE_SEC = 2592000;

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

/**
 * @param {import("node:http").IncomingMessage} req
 */
export function parseCookies(req) {
  const h = req.headers?.cookie;
  if (!h || typeof h !== "string") {
    return {};
  }
  const out = {};
  for (const part of h.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) {
      const k = part.trim();
      if (k) {
        out[k] = "";
      }
      continue;
    }
    const k = part.slice(0, idx).trim();
    if (!k) {
      continue;
    }
    const v = part.slice(idx + 1);
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

/**
 * 32 random bytes, hex (64 characters).
 * @param {string | undefined} value
 * @returns {value is string}
 */
export function validSessionId(value) {
  return typeof value === "string" && SESSION_RE.test(value);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {string}
 */
export function getOrCreateSessionId(req, res) {
  const cookies = parseCookies(req);
  const existing = cookies[SESSION_COOKIE];
  if (validSessionId(existing)) {
    return existing;
  }

  const sessionId = randomBytes(32).toString("hex");
  const secure = isVercelRuntime() ? " Secure" : "";
  res.setHeader("Set-Cookie", [
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure};`,
  ]);
  return sessionId;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {string | null}
 */
export function getExistingSessionId(req) {
  const v = parseCookies(req)[SESSION_COOKIE];
  return validSessionId(v) ? v : null;
}

/**
 * Expire the session cookie in the browser (logout).
 * @param {import("node:http").ServerResponse} res
 */
export function clearSessionCookie(res) {
  const secure = isVercelRuntime() ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure};`,
  ]);
}
