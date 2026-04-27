import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { persistLoad, persistSave, ROOT_DIR } from "./persist-settings.mjs";

const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const CLI_DIR = path.join(ROOT_DIR, "cli");
const OAUTH_SCOPE = "public identify";
const STATE_TTL_MS = 15 * 60 * 1000;
const REFRESH_BUFFER_MS = 60 * 1000;

/** App credentials: prefer env (for hosted UIs). Legacy: still read from saved settings if env unset. */
function envOauthAppConfigured() {
  return Boolean(
    process.env.OSU_OAUTH_CLIENT_ID?.trim() && process.env.OSU_OAUTH_CLIENT_SECRET?.trim(),
  );
}

function oauthAppCredentials(settings) {
  if (envOauthAppConfigured()) {
    return {
      clientId: process.env.OSU_OAUTH_CLIENT_ID.trim(),
      clientSecret: process.env.OSU_OAUTH_CLIENT_SECRET.trim(),
    };
  }
  const o = settings?.oauth;
  if (o?.clientId?.trim() && o?.clientSecret?.trim()) {
    return { clientId: o.clientId.trim(), clientSecret: o.clientSecret.trim() };
  }
  return { clientId: "", clientSecret: "" };
}

function stripOauthAppSecretsForPersistIfEnv(settings) {
  if (!envOauthAppConfigured() || !settings?.oauth) {
    return settings;
  }
  return {
    ...settings,
    oauth: { ...settings.oauth, clientId: "", clientSecret: "" },
  };
}

const MODES = ["osu", "taiko", "fruits", "mania"];
const FEEDS = ["firsts", "best", "recent"];
const GUEST_SORTS = ["beatmap-id", "difficulty-updated", "set-date"];
const DEFAULT_SETTINGS = {
  guest: {
    target: "",
    output: "-",
    modes: [...MODES],
    sort: "beatmap-id",
    pageSize: 100,
    concurrency: 6,
    maxPages: 0,
    dryRun: false,
    verbose: false,
    lineTemplate:
      "[url={url}]{artist} - {title} ({version})[/url][size=85][color={status_color}]({status_label})[/color][/size]",
    statusTemplate: " [size=85][color={color}]({label})[/color][/size]",
    yearTemplate: "[b]{year} - {count}[/b]",
    wrapperTemplate:
      "[box=giant list of gds - {total}]\n[notice]\n{intro}\n{sections}\n\n[/notice]\n[/box]",
    noticeIntro: "most recently updated maps are at the top",
    yearSectionTemplate: "{year_header}\n{entries}",
  },
  oldest: {
    target: "",
    modes: [...MODES],
    feeds: [...FEEDS],
    pageSize: 100,
    maxPages: 0,
    saveIndex: "",
    beatmapId: "",
    resultCount: 5,
    verbose: false,
  },
  oauth: {
    clientId: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    tokenType: "",
    expiresAt: 0,
    scopes: OAUTH_SCOPE,
    user: null,
    pendingState: "",
    pendingRedirectUri: "",
    pendingCreatedAt: 0,
  },
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".osu": "text/plain; charset=utf-8",
};

let cachedSettings = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

/** Where the browser should return after OAuth (local UI lives under /public/). */
function uiReturnUrl(fragmentBody = "setup") {
  const frag = fragmentBody.startsWith("#") ? fragmentBody : `#${fragmentBody}`;
  const fromEnv = process.env.OSU_UI_HOME?.trim();
  if (fromEnv) {
    return `${fromEnv.replace(/\/$/, "")}${frag}`;
  }
  if (isVercelRuntime()) {
    return `/account.html${frag}`;
  }
  return `/account.html${frag}`;
}

async function loadSettings() {
  // In Vercel/serverless, module-level memory can outlive one request
  // but not represent the latest saved Redis state.
  // Only use the in-memory cache for the local dev server.
  if (cachedSettings && !isVercelRuntime()) {
    return cachedSettings;
  }

  try {
    const raw = await persistLoad();
    let next = normalizeSettings(raw || {});
    if (envOauthAppConfigured()) {
      next = {
        ...next,
        oauth: { ...next.oauth, clientId: "", clientSecret: "" },
      };
    }
    cachedSettings = next;
  } catch {
    cachedSettings = clone(DEFAULT_SETTINGS);
  }

  return cachedSettings;
}

export async function invalidateSettingsCache() {
  cachedSettings = null;
}

async function saveSettings(nextSettings) {
  cachedSettings = normalizeSettings(stripOauthAppSecretsForPersistIfEnv(nextSettings));
  await persistSave(cachedSettings);
  return cachedSettings;
}

export function publicSettings(settings, request) {
  const envToken = process.env.OSU_ACCESS_TOKEN?.trim() || "";
  const oauth = settings.oauth;
  const hasSavedAccessToken = Boolean(oauth.accessToken?.trim());
  const isExpired = hasSavedAccessToken && oauth.expiresAt > 0 && oauth.expiresAt <= Date.now();
  const creds = oauthAppCredentials(settings);
  const loginAvailable = Boolean(creds.clientId && creds.clientSecret);
  const canRefresh = Boolean(oauth.refreshToken && loginAvailable);

  return {
    guest: settings.guest,
    oldest: settings.oldest,
    oauth: {
      loginAvailable,
      scopes: OAUTH_SCOPE,
      loggedInUser: oauth.user,
      tokenExpiresAt: oauth.expiresAt || null,
      hasSavedAccessToken,
      canRefresh,
      isExpired,
    },
    hasSavedAccessToken,
    hasEnvAccessToken: Boolean(envToken),
    hasUsableAccessToken: Boolean((hasSavedAccessToken && (!isExpired || canRefresh)) || envToken),
    runtime: {
      vercel: isVercelRuntime(),
      localServer: !isVercelRuntime(),
    },
  };
}

function normalizeSettings(input = {}) {
  const oauthInput = input.oauth ?? {};
  const legacyAccessToken = typeof input.accessToken === "string" ? input.accessToken.trim() : "";

  return {
    guest: normalizeGuestSettings(input.guest),
    oldest: normalizeOldestSettings(input.oldest),
    oauth: normalizeOAuthSettings({
      ...oauthInput,
      accessToken: oauthInput.accessToken || legacyAccessToken,
    }),
  };
}

function normalizeOAuthSettings(input = {}) {
  return {
    clientId: stringValue(input.clientId, DEFAULT_SETTINGS.oauth.clientId),
    clientSecret: stringValue(input.clientSecret, DEFAULT_SETTINGS.oauth.clientSecret),
    accessToken: stringValue(input.accessToken, DEFAULT_SETTINGS.oauth.accessToken),
    refreshToken: stringValue(input.refreshToken, DEFAULT_SETTINGS.oauth.refreshToken),
    tokenType: stringValue(input.tokenType, DEFAULT_SETTINGS.oauth.tokenType),
    expiresAt: nonNegativeInteger(input.expiresAt, DEFAULT_SETTINGS.oauth.expiresAt),
    scopes: stringValue(input.scopes, OAUTH_SCOPE) || OAUTH_SCOPE,
    user: normalizeOAuthUser(input.user),
    pendingState: stringValue(input.pendingState, DEFAULT_SETTINGS.oauth.pendingState),
    pendingRedirectUri: stringValue(input.pendingRedirectUri, DEFAULT_SETTINGS.oauth.pendingRedirectUri),
    pendingCreatedAt: nonNegativeInteger(input.pendingCreatedAt, DEFAULT_SETTINGS.oauth.pendingCreatedAt),
  };
}

function normalizeOAuthUser(user) {
  if (!user || typeof user !== "object") {
    return null;
  }

  return {
    id: user.id ?? null,
    username: typeof user.username === "string" ? user.username : null,
    avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : typeof user.avatar_url === "string" ? user.avatar_url : null,
    profileUrl: user.id ? `https://osu.ppy.sh/users/${user.id}` : null,
  };
}

function canonGuestTemplateText(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trimEnd() : "";
}

/** Older UI defaults; migrate to current DEFAULT_SETTINGS.guest templates. */
function migrateLegacyGuestSettings(guest) {
  const d = DEFAULT_SETTINGS.guest;
  const w = canonGuestTemplateText(guest.wrapperTemplate);
  const line = canonGuestTemplateText(guest.lineTemplate);
  const legacyWrappers = new Set([
    "[box={title} - {total}]\n[notice]\n{intro}\n\n{sections}\n\n[/notice]\n[/box]",
    "[box={title} - {total}]\n[notice]\n{intro}\n{sections}\n\n[/notice]\n[/box]",
  ]);
  const legacyLine = "[url={url}]{artist} - {title} ({version})[/url]{status}";
  const out = { ...guest };
  if (legacyWrappers.has(w)) {
    out.wrapperTemplate = d.wrapperTemplate;
  }
  if (line === legacyLine) {
    out.lineTemplate = d.lineTemplate;
  }
  return out;
}

function normalizeGuestSettings(input = {}) {
  const defaults = DEFAULT_SETTINGS.guest;
  const guest = {
    target: stringValue(input.target, defaults.target),
    output: "-",
    modes: normalizeList(input.modes, MODES, defaults.modes),
    sort: GUEST_SORTS.includes(input.sort) ? input.sort : defaults.sort,
    pageSize: positiveInteger(input.pageSize, defaults.pageSize),
    concurrency: positiveInteger(input.concurrency, defaults.concurrency),
    maxPages: nonNegativeInteger(input.maxPages, defaults.maxPages),
    dryRun: Boolean(input.dryRun),
    verbose: Boolean(input.verbose),
    lineTemplate: stringValue(input.lineTemplate, defaults.lineTemplate),
    statusTemplate: stringValue(input.statusTemplate, defaults.statusTemplate),
    yearTemplate: stringValue(input.yearTemplate, defaults.yearTemplate),
    wrapperTemplate: stringValue(input.wrapperTemplate, defaults.wrapperTemplate),
    noticeIntro: typeof input.noticeIntro === "string" ? input.noticeIntro : defaults.noticeIntro,
    yearSectionTemplate:
      stringValue(input.yearSectionTemplate, defaults.yearSectionTemplate) || defaults.yearSectionTemplate,
  };
  return migrateLegacyGuestSettings(guest);
}

function normalizeOldestSettings(input = {}) {
  const defaults = DEFAULT_SETTINGS.oldest;
  return {
    target: stringValue(input.target, defaults.target),
    modes: normalizeList(input.modes, MODES, defaults.modes),
    feeds: normalizeList(input.feeds, FEEDS, defaults.feeds),
    pageSize: positiveInteger(input.pageSize, defaults.pageSize),
    maxPages: nonNegativeInteger(input.maxPages, defaults.maxPages),
    saveIndex: stringValue(input.saveIndex, defaults.saveIndex),
    beatmapId: stringValue(input.beatmapId, defaults.beatmapId),
    resultCount: oldestResultCount(input.resultCount, defaults.resultCount),
    verbose: Boolean(input.verbose),
  };
}

function oldestResultCount(value, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) {
    return fallback;
  }
  return Math.min(n, 100);
}

function stringValue(value, fallback) {
  return typeof value === "string" ? value.trim() : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeList(value, allowed, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value
    .map((item) => String(item).trim())
    .filter((item) => allowed.includes(item));

  return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}

export function originForRequest(request) {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "http";
  const host = request.headers.host || "localhost";
  return `${protocol}://${host}`;
}

function callbackUrlForRequest(request) {
  return `${originForRequest(request)}/auth/osu/callback`;
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(data, null, 2)}\n`);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

export async function handleSettings(request, response) {
  const settings = await loadSettings();

  if (request.method === "GET") {
    sendJson(response, 200, publicSettings(settings, request));
    return;
  }

  if (request.method !== "POST") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const body = await readRequestJson(request);
  const oauth = { ...settings.oauth };

  if (body.clearAccessToken) {
    Object.assign(oauth, clearOAuthToken(oauth));
  }

  const nextSettings = normalizeSettings({
    ...settings,
    guest: body.guest ?? settings.guest,
    oldest: body.oldest ?? settings.oldest,
    oauth,
  });

  sendJson(response, 200, publicSettings(await saveSettings(nextSettings), request));
}

export async function handleOAuthStart(request, response) {
  if (request.method !== "GET") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const settings = await loadSettings();
  const oauth = settings.oauth;
  const creds = oauthAppCredentials(settings);

  if (!creds.clientId || !creds.clientSecret) {
    sendHtml(
      response,
      400,
      authResultPage(
        "Sign-in is not set up. The site needs OSU_OAUTH_CLIENT_ID and OSU_OAUTH_CLIENT_SECRET in the environment (or legacy app credentials in server settings).",
        false,
        uiReturnUrl("setup?oauthError=unconfigured"),
      ),
    );
    return;
  }

  try {
    await validateOAuthClient(creds);
  } catch (error) {
    console.error("OAuth validation failed:", error);
    sendHtml(
      response,
      400,
      authResultPage(
        [
          `osu! did not accept this OAuth app before sign-in: ${error.message}`,
          "Check that the callback URL on the osu! developer page matches " +
          "the URL this server uses for /auth/osu/callback and that OSU_OAUTH_CLIENT_ID/SECRET are correct.",
        ].join(" "),
        false,
        uiReturnUrl("setup?oauthError=invalid_client"),
      ),
    );
    return;
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = callbackUrlForRequest(request);
  await saveSettings({
    ...settings,
    oauth: {
      ...oauth,
      pendingState: state,
      pendingRedirectUri: redirectUri,
      pendingCreatedAt: Date.now(),
    },
  });

  const authorizeUrl = new URL("https://osu.ppy.sh/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", creds.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", OAUTH_SCOPE);
  authorizeUrl.searchParams.set("state", state);

  response.writeHead(302, { location: authorizeUrl.toString() });
  response.end();
}

export async function handleOAuthCallback(request, response, url) {
  if (request.method !== "GET") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const settings = await loadSettings();
  const oauth = settings.oauth;
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    sendHtml(response, 400, authResultPage(`osu! login was cancelled or failed: ${error}`, false));
    return;
  }

  if (!code || !state) {
    sendHtml(response, 400, authResultPage("osu! did not return the expected login code.", false));
    return;
  }

  if (!oauth.pendingState || state !== oauth.pendingState) {
    sendHtml(response, 400, authResultPage("osu! login state did not match. Please try again.", false));
    return;
  }

  if (!oauth.pendingCreatedAt || Date.now() - oauth.pendingCreatedAt > STATE_TTL_MS) {
    sendHtml(response, 400, authResultPage("osu! login took too long. Please try again.", false));
    return;
  }

  const creds = oauthAppCredentials(settings);
  if (!creds.clientId || !creds.clientSecret) {
    sendHtml(
      response,
      400,
      authResultPage("Sign-in is not set up on this server.", false, uiReturnUrl("setup?oauthError=unconfigured")),
    );
    return;
  }

  try {
    const tokenData = await requestOAuthToken({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: oauth.pendingRedirectUri || callbackUrlForRequest(request),
    });
    const nextOauth = applyOAuthToken(oauth, tokenData);
    const me = await fetchOAuthMe(nextOauth.accessToken);
    nextOauth.user = normalizeOAuthUser(me);
    nextOauth.pendingState = "";
    nextOauth.pendingRedirectUri = "";
    nextOauth.pendingCreatedAt = 0;

    await saveSettings({
      ...settings,
      oauth: nextOauth,
    });

    sendHtml(response, 200, authResultPage(`Logged in as ${nextOauth.user?.username || "osu! user"}.`, true));
  } catch (error) {
    console.error("OAuth callback failed:", error);
    sendHtml(
      response,
      400,
      authResultPage(
        [
          `osu! rejected the sign-in request: ${error.message}`,
          "The operator should verify the callback URL registered on osu! matches this server and that OSU_OAUTH_CLIENT_ID/SECRET are valid.",
        ].join(" "),
        false,
        uiReturnUrl("setup?oauthError=invalid_client"),
      ),
    );
  }
}

export async function handleOAuthLogout(request, response) {
  if (request.method !== "POST") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const settings = await loadSettings();
  const nextSettings = await saveSettings({
    ...settings,
    oauth: clearOAuthToken(settings.oauth),
  });
  sendJson(response, 200, publicSettings(nextSettings, request));
}

export async function handleShutdown(request, response) {
  if (isVercelRuntime()) {
    sendJson(response, 404, { ok: false, error: "Close app is only available when running the local server." });
    return;
  }

  if (request.method !== "POST") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  sendJson(response, 200, { ok: true, message: "osu! script UI closed." });
  if (globalThis.__osuShutdown) {
    setTimeout(globalThis.__osuShutdown, 150);
  }
}

function authResultPage(message, ok, returnPath = uiReturnUrl("setup")) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>osu! login</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 32px; background: #0f1014; color: #e8eaef; }
      a { color: #ff66aa; font-weight: 600; }
    </style>
  </head>
  <body>
    <h1>${ok ? "osu! login complete" : "osu! login failed"}</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="${escapeHtml(returnPath)}">Back to the site</a></p>
    <script>setTimeout(() => { window.location.href = ${JSON.stringify(returnPath)}; }, ${ok ? 1200 : 3000});</script>
  </body>
</html>`;
}

function clearOAuthToken(oauth) {
  return {
    ...oauth,
    accessToken: "",
    refreshToken: "",
    tokenType: "",
    expiresAt: 0,
    user: null,
    pendingState: "",
    pendingRedirectUri: "",
    pendingCreatedAt: 0,
  };
}

function applyOAuthToken(oauth, tokenData) {
  const expiresIn = Number.parseInt(tokenData.expires_in, 10);

  return normalizeOAuthSettings({
    ...oauth,
    accessToken: tokenData.access_token || "",
    refreshToken: tokenData.refresh_token || oauth.refreshToken,
    tokenType: tokenData.token_type || "Bearer",
    expiresAt: Number.isInteger(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    scopes: tokenData.scope || oauth.scopes || OAUTH_SCOPE,
  });
}

async function requestOAuthToken(params) {
  const response = await fetch("https://osu.ppy.sh/oauth/token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`osu! token request failed (${response.status} ${response.statusText}): ${text.slice(0, 300)}`);
  }

  return response.json();
}

async function validateOAuthClient(creds) {
  return requestOAuthToken({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "client_credentials",
    scope: "public",
  });
}

async function fetchOAuthMe(accessToken) {
  const response = await fetch("https://osu.ppy.sh/api/v2/me", {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`osu! profile check failed (${response.status} ${response.statusText}): ${text.slice(0, 300)}`);
  }

  return response.json();
}

async function getRunAccessToken(settings) {
  const warnings = [];
  const envToken = process.env.OSU_ACCESS_TOKEN?.trim() || "";
  const oauth = settings.oauth;
  const hasFreshOAuthToken = oauth.accessToken && (!oauth.expiresAt || oauth.expiresAt > Date.now() + REFRESH_BUFFER_MS);

  if (hasFreshOAuthToken) {
    return { accessToken: oauth.accessToken, warnings };
  }

  const appCreds = oauthAppCredentials(settings);
  if (oauth.refreshToken && appCreds.clientId && appCreds.clientSecret) {
    try {
      const tokenData = await requestOAuthToken({
        client_id: appCreds.clientId,
        client_secret: appCreds.clientSecret,
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
        scope: OAUTH_SCOPE,
      });
      const nextSettings = await saveSettings({
        ...settings,
        oauth: applyOAuthToken(oauth, tokenData),
      });
      return { accessToken: nextSettings.oauth.accessToken, warnings };
    } catch (error) {
      warnings.push(`Saved osu! login could not be refreshed: ${error.message}`);
      await saveSettings({
        ...settings,
        oauth: clearOAuthToken(oauth),
      });
    }
  }

  return { accessToken: envToken, warnings };
}

function parseStructuredFromStdout(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseLastJsonLine(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Not JSON. Keep looking.
    }
  }
  return null;
}

function writeNdjson(response, event) {
  response.write(`${JSON.stringify(event)}\n`);
}

export async function handleRun(request, response) {
  if (request.method !== "POST") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const body = await readRequestJson(request);
  const settings = await loadSettings();
  const script = body.script;

  if (!["guest", "oldest"].includes(script)) {
    sendJson(response, 400, { ok: false, error: "Choose a script to run." });
    return;
  }

  const runSettings = script === "guest"
    ? normalizeGuestSettings(body.settings ?? settings.guest)
    : normalizeOldestSettings(body.settings ?? settings.oldest);
  const target = stringValue(body.target ?? runSettings.target, "");

  if (!target) {
    sendJson(response, 400, { ok: false, error: "Enter an osu! profile link, username, or user id." });
    return;
  }

  if (!settings.oauth?.user?.username) {
    sendJson(response, 401, {
      ok: false,
      error: "Log in with osu! to use the tools.",
    });
    return;
  }

  const tokenResult = await getRunAccessToken(settings);

  if (script === "oldest" && !tokenResult.accessToken) {
    sendJson(response, 401, {
      ok: false,
      error: "Find oldest scores needs a valid token. Log in with osu! again if this persists.",
    });
    return;
  }

  const args = script === "guest"
    ? buildGuestArgs(target, runSettings)
    : buildOldestArgs(target, runSettings);
  const result = await runScript(args, tokenResult.accessToken);
  const warningText = tokenResult.warnings.length > 0 ? `${tokenResult.warnings.join("\n")}\n` : "";
  const structured = parseStructuredFromStdout(result.stdout);

  sendJson(response, 200, {
    ok: result.code === 0,
    script,
    command: ["node", ...args].join(" "),
    structured,
    stdout: result.stdout,
    stderr: `${warningText}${result.stderr}`,
    code: result.code,
  });
}

export async function handleRunStream(request, response) {
  if (request.method !== "POST") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const body = await readRequestJson(request);
  const settings = await loadSettings();
  const script = body.script;

  if (!["guest", "oldest"].includes(script)) {
    sendJson(response, 400, { ok: false, error: "Choose a script to run." });
    return;
  }

  const runSettings = script === "guest"
    ? normalizeGuestSettings(body.settings ?? settings.guest)
    : normalizeOldestSettings(body.settings ?? settings.oldest);
  const target = stringValue(body.target ?? runSettings.target, "");

  if (!target) {
    sendJson(response, 400, { ok: false, error: "Enter an osu! profile link, username, or user id." });
    return;
  }

  if (!settings.oauth?.user?.username) {
    response.writeHead(401, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    });
    writeNdjson(response, {
      type: "error",
      message: "Log in with osu! to use the tools.",
    });
    response.end();
    return;
  }

  const tokenResult = await getRunAccessToken(settings);

  if (script === "oldest" && !tokenResult.accessToken) {
    response.writeHead(401, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    });
    writeNdjson(response, {
      type: "error",
      message: "Find oldest scores needs a valid token. Log in with osu! again if this persists.",
    });
    response.end();
    return;
  }

  const args = script === "guest"
    ? buildGuestArgs(target, runSettings)
    : buildOldestArgs(target, runSettings);
  const accessToken = tokenResult.accessToken;
  const warningText = tokenResult.warnings.length > 0 ? `${tokenResult.warnings.join("\n")}\n` : "";

  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  if (warningText) {
    writeNdjson(response, { type: "log", stream: "stderr", text: warningText });
  }

  const child = spawn(process.execPath, args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      OSU_ACCESS_TOKEN: accessToken || "",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    writeNdjson(response, { type: "log", stream: "stdout", text: chunk });
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    writeNdjson(response, { type: "log", stream: "stderr", text: chunk });
  });

  child.on("error", (error) => {
    writeNdjson(response, { type: "error", message: error.message });
    response.end();
  });

  child.on("close", (code) => {
    const structured = parseLastJsonLine(stdout);
    writeNdjson(response, {
      type: "done",
      result: {
        ok: code === 0,
        script,
        command: ["node", ...args].join(" "),
        code,
        stdout,
        stderr: `${warningText}${stderr}`,
        structured,
      },
    });
    response.end();
  });

  request.on("close", () => {
    if (!child.killed) {
      child.kill();
    }
  });
}

function guestOutputPath() {
  return "-";
}

function buildGuestArgs(target, settings) {
  const args = [path.join(CLI_DIR, "find-osu-guest-difficulties.mjs"), target];
  args.push(`--output=${guestOutputPath()}`);
  args.push(`--modes=${settings.modes.join(",")}`);
  args.push(`--sort=${settings.sort}`);
  args.push(`--page-size=${settings.pageSize}`);
  args.push(`--concurrency=${settings.concurrency}`);
  args.push(`--max-pages=${settings.maxPages}`);
  args.push("--json");

  if (settings.dryRun) {
    args.push("--dry-run");
  }

  if (settings.verbose) {
    args.push("--verbose");
  }

  if (settings.lineTemplate) {
    args.push(`--line-template=${settings.lineTemplate}`);
  }
  if (settings.statusTemplate) {
    args.push(`--status-template=${settings.statusTemplate}`);
  }
  if (settings.yearTemplate) {
    args.push(`--year-template=${settings.yearTemplate}`);
  }
  if (settings.wrapperTemplate) {
    args.push(`--wrapper-template=${settings.wrapperTemplate}`);
  }

  if (typeof settings.noticeIntro === "string") {
    args.push(`--notice-intro=${settings.noticeIntro}`);
  }

  const defaultYearSection = "{year_header}\n{entries}";
  if (settings.yearSectionTemplate?.trim() && settings.yearSectionTemplate.trim() !== defaultYearSection) {
    args.push(`--year-section-template=${settings.yearSectionTemplate.trim()}`);
  }

  return args;
}

function buildOldestArgs(target, settings) {
  const args = [path.join(CLI_DIR, "find-oldest-osu-score.mjs"), target];
  args.push(`--modes=${settings.modes.join(",")}`);
  args.push(`--feeds=${settings.feeds.join(",")}`);
  args.push(`--page-size=${settings.pageSize}`);
  args.push(`--max-pages=${settings.maxPages}`);
  args.push("--json");

  if (settings.saveIndex) {
    args.push(`--save-index=${settings.saveIndex}`);
  }

  if (settings.beatmapId) {
    args.push(`--beatmap-id=${settings.beatmapId}`);
  }

  args.push(`--result-count=${settings.resultCount}`);

  if (settings.verbose) {
    args.push("--verbose");
  }

  return args;
}

function runScript(args, accessToken) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        OSU_ACCESS_TOKEN: accessToken || "",
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export async function handleStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodedPath));
  const relativePath = path.relative(PUBLIC_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(content);
  } catch {
    sendText(response, 404, "Not found");
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function dispatchHttp(request, response, url) {
  if (url.pathname === "/api/settings") {
    await handleSettings(request, response);
    return true;
  }

  if (url.pathname === "/api/run/stream") {
    await handleRunStream(request, response);
    return true;
  }

  if (url.pathname === "/api/run") {
    await handleRun(request, response);
    return true;
  }

  if (url.pathname === "/api/auth/logout") {
    await handleOAuthLogout(request, response);
    return true;
  }

  if (url.pathname === "/api/shutdown") {
    await handleShutdown(request, response);
    return true;
  }

  if (url.pathname === "/auth/osu/start") {
    await handleOAuthStart(request, response);
    return true;
  }

  if (url.pathname === "/auth/osu/callback") {
    await handleOAuthCallback(request, response, url);
    return true;
  }

  return false;
}
