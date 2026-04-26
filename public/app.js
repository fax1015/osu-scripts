const guestForm = document.querySelector("#guest-form");
const oldestForm = document.querySelector("#oldest-form");
const tokenStatus = document.querySelector("#token-status");
const oauthPanel = document.querySelector("#oauth-panel");
const clientIdInput = document.querySelector("#oauth-client-id");
const clientSecretInput = document.querySelector("#oauth-client-secret");
const callbackUrlInput = document.querySelector("#oauth-callback-url");
const saveAccountButton = document.querySelector("#save-settings-account");
const saveMenuButton = document.querySelector("#save-settings-menu");
const loginButton = document.querySelector("#login-osu");
const logoutButton = document.querySelector("#logout-osu");
const closeAppButton = document.querySelector("#close-app");
const accountAvatar = document.querySelector("#account-avatar");
const accountLabel = document.querySelector("#account-label");
const navAuthGuest = document.querySelector("#nav-auth-guest");
const navAuthUser = document.querySelector("#nav-auth-user");
const profileMenuTrigger = document.querySelector("#profile-menu-trigger");
const profileMenuPanel = document.querySelector("#profile-menu-panel");
const accountFeedback = document.querySelector("#account-feedback");
const copyCallbackButton = document.querySelector("#copy-callback");
const showOauthSetup = document.querySelector("#show-oauth-setup");
const footerRepo = document.querySelector("#footer-repo");
const navBurger = document.querySelector("#nav-burger");
const navAnchors = document.querySelector("#nav-anchors");

const runResultsBody = document.querySelector("#run-results-body");
const runResultsLog = document.querySelector("#run-results-log");
const guestUnifiedTemplate = document.querySelector("#guest-unified-template");
const guestTemplatePreview = document.querySelector("#guest-template-preview");
const resetGuestTemplate = document.querySelector("#reset-guest-template");

const GUEST_NOTICE_INTRO_DEFAULT = "most recently updated maps are at the top";
const GUEST_YEAR_SECTION_DEFAULT = "{year_header}\n{entries}";
const GUEST_BOX_TITLE_FALLBACK = "giant list of gds";
const GUEST_MARKER_LINE = /^#\s*osu-guest-line\s*$/i;

/** Exact default shown in the textarea (plain intro + spacing). Must stay in sync with defaultGuestParts(). */
const GUEST_UNIFIED_VISUAL_DEFAULT =
  "[box=giant list of gds - {total}]\n[notice]\nmost recently updated maps are at the top\n[b]{year} - {count}[/b]\n\n# osu-guest-line\n[url={url}]{artist} - {title} ({version})[/url][size=85][color={status_color}]({status_label})[/color][/size]\n\n[/notice]\n[/box]";

function defaultGuestParts() {
  return {
    noticeIntro: GUEST_NOTICE_INTRO_DEFAULT,
    wrapperTemplate:
      "[box=giant list of gds - {total}]\n[notice]\n{intro}\n{sections}\n\n[/notice]\n[/box]",
    yearSectionTemplate: GUEST_YEAR_SECTION_DEFAULT,
    yearTemplate: "[b]{year} - {count}[/b]",
    lineTemplate:
      "[url={url}]{artist} - {title} ({version})[/url][size=85][color={status_color}]({status_label})[/color][/size]",
    statusTemplate: " [size=85][color={color}]({label})[/color][/size]",
  };
}

function canonGuestTemplateText(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trimEnd() : "";
}

/** Match server migrateLegacyGuestSettings — fixes stale saved factory defaults in the browser. */
function migrateLegacyGuestParts(g) {
  const d = defaultGuestParts();
  const w = canonGuestTemplateText(g.wrapperTemplate);
  const line = canonGuestTemplateText(g.lineTemplate);
  const legacyWrappers = new Set([
    "[box={title} - {total}]\n[notice]\n{intro}\n\n{sections}\n\n[/notice]\n[/box]",
    "[box={title} - {total}]\n[notice]\n{intro}\n{sections}\n\n[/notice]\n[/box]",
  ]);
  const legacyLine = "[url={url}]{artist} - {title} ({version})[/url]{status}";
  const out = { ...g };
  if (legacyWrappers.has(w)) {
    out.wrapperTemplate = d.wrapperTemplate;
  }
  if (line === legacyLine) {
    out.lineTemplate = d.lineTemplate;
  }
  return out;
}

function settingsWithMigratedGuest(settings) {
  if (!settings?.guest) {
    return settings;
  }
  return {
    ...settings,
    guest: migrateLegacyGuestParts(settings.guest),
  };
}

function guestTemplateFieldsMatchDefaults(p) {
  const d = defaultGuestParts();
  return (
    (p.wrapperTemplate || d.wrapperTemplate) === d.wrapperTemplate &&
    (p.noticeIntro ?? d.noticeIntro) === d.noticeIntro &&
    (p.yearTemplate || d.yearTemplate) === d.yearTemplate &&
    (p.lineTemplate || d.lineTemplate) === d.lineTemplate &&
    (p.yearSectionTemplate || d.yearSectionTemplate) === d.yearSectionTemplate &&
    (p.statusTemplate || d.statusTemplate) === d.statusTemplate
  );
}

function guestPartsFromSavedSettings() {
  const g = migrateLegacyGuestParts(latestSettings?.guest || {});
  const d = defaultGuestParts();
  return {
    noticeIntro: typeof g.noticeIntro === "string" ? g.noticeIntro : d.noticeIntro,
    wrapperTemplate: g.wrapperTemplate || d.wrapperTemplate,
    yearSectionTemplate: g.yearSectionTemplate || d.yearSectionTemplate,
    yearTemplate: g.yearTemplate || d.yearTemplate,
    lineTemplate: g.lineTemplate || d.lineTemplate,
    statusTemplate: g.statusTemplate || d.statusTemplate,
  };
}

/** BBCode-style editor: one # osu-guest-line marker; line after = repeated beatmap row. */
function buildGuestVisualEditor(parts) {
  const p = { ...defaultGuestParts(), ...parts };
  if (guestTemplateFieldsMatchDefaults(p)) {
    return GUEST_UNIFIED_VISUAL_DEFAULT;
  }
  const w = p.wrapperTemplate || defaultGuestParts().wrapperTemplate;
  const marker = "{sections}";
  const i = w.indexOf(marker);
  const before = i < 0 ? w : w.slice(0, i);
  const after = i < 0 ? "\n\n[/notice]\n[/box]" : w.slice(i + marker.length);
  const ni = p.noticeIntro ?? GUEST_NOTICE_INTRO_DEFAULT;
  const headShown = before.replace(/{intro}/g, ni);
  return `${headShown.trimEnd()}\n${p.yearTemplate}\n\n# osu-guest-line\n${p.lineTemplate}${after}`;
}

function parseGuestVisualEditor(text) {
  const lines = String(text).split(/\r?\n/);
  const idxGuest = lines.findIndex((l) => GUEST_MARKER_LINE.test(l.trim()));
  if (idxGuest < 0) {
    return { ok: false, reason: "missing-marker", parts: null };
  }

  const lineTemplate = (lines[idxGuest + 1] ?? "").trim();
  if (!lineTemplate) {
    return { ok: false, reason: "missing-line", parts: null };
  }

  let j = idxGuest - 1;
  while (j >= 0 && !lines[j].trim()) {
    j -= 1;
  }
  if (j < 0) {
    return { ok: false, reason: "missing-year", parts: null };
  }
  const yearTemplate = lines[j].trim();

  let idxNotice = -1;
  for (let k = 0; k < j; k += 1) {
    if (/^\[notice\]/i.test(lines[k].trim())) {
      idxNotice = k;
    }
  }
  if (idxNotice < 0) {
    return { ok: false, reason: "missing-notice", parts: null };
  }

  const header = lines.slice(0, idxNotice + 1).join("\n");
  const introRaw = lines.slice(idxNotice + 1, j).join("\n").trimEnd();

  const preservedIntro =
    typeof latestSettings?.guest?.noticeIntro === "string" && latestSettings.guest.noticeIntro.trim()
      ? latestSettings.guest.noticeIntro
      : GUEST_NOTICE_INTRO_DEFAULT;

  let noticeIntro = introRaw;
  if (/^\{intro\}$/.test(introRaw.trim())) {
    noticeIntro = preservedIntro;
  }

  const suffix = lines.slice(idxGuest + 2).join("\n");
  if (!/\[\/notice\]/i.test(suffix) || !/\[\/box\]/i.test(suffix)) {
    return { ok: false, reason: "missing-close-tags", parts: null };
  }

  const glue = suffix.startsWith("\n") ? "" : "\n";
  const wrapperTemplate = `${header}\n{intro}\n{sections}${glue}${suffix}`;

  return {
    ok: true,
    reason: null,
    parts: {
      ...defaultGuestParts(),
      wrapperTemplate,
      yearTemplate,
      lineTemplate,
      noticeIntro,
    },
  };
}

function setGuestTemplateParseHint(parseOk, reason) {
  const el = document.querySelector("#guest-template-parse-hint");
  if (!el) {
    return;
  }
  if (parseOk) {
    el.hidden = true;
    el.textContent = "";
    el.className = "field-hint guest-bbcode-parse-hint";
    return;
  }
  el.hidden = false;
  el.className = "field-hint guest-bbcode-parse-hint is-warn";
  const messages = {
    "missing-marker":
      "Add a line containing only # osu-guest-line, then on the next line your beatmap row template (repeated for every map).",
    "missing-line": "Put one non-empty line immediately after # osu-guest-line (your repeating guest row).",
    "missing-year": "Add a year heading line (with {year}) above # osu-guest-line.",
    "missing-notice": "Include [notice] before the intro and year block.",
    "missing-close-tags": "After the beatmap line, keep [/notice] and [/box] (and any spacing you want).",
  };
  el.textContent = messages[reason] || "Template could not be parsed; using saved or built-in defaults.";
}

function getGuestPartsFromUI() {
  const raw = guestUnifiedTemplate?.value ?? "";
  const parsed = parseGuestVisualEditor(raw);
  if (!parsed.ok) {
    setGuestTemplateParseHint(false, parsed.reason);
    return guestPartsFromSavedSettings();
  }
  setGuestTemplateParseHint(true, null);
  const g = latestSettings?.guest || {};
  const d = defaultGuestParts();
  return {
    ...parsed.parts,
    yearSectionTemplate:
      (typeof g.yearSectionTemplate === "string" && g.yearSectionTemplate.trim()) || GUEST_YEAR_SECTION_DEFAULT,
    statusTemplate: (typeof g.statusTemplate === "string" && g.statusTemplate.trim()) || d.statusTemplate,
  };
}

let latestSettings = null;

function loggedIn(settings) {
  return Boolean(settings?.oauth?.loggedInUser?.username);
}

function setAccountFeedback(text, toneClass = "") {
  if (!accountFeedback) return;
  if (!text) {
    accountFeedback.hidden = true;
    accountFeedback.textContent = "";
    accountFeedback.className = "account-feedback";
    return;
  }
  accountFeedback.textContent = text;
  accountFeedback.className = `account-feedback ${toneClass}`.trim();
  accountFeedback.hidden = false;
}

function setLoginHint(text) {
  if (loginButton) {
    loginButton.title = text || "";
  }
}

function closeProfileMenu() {
  if (!profileMenuPanel || !profileMenuTrigger) return;
  profileMenuPanel.classList.remove("is-open");
  profileMenuPanel.setAttribute("aria-hidden", "true");
  profileMenuTrigger.setAttribute("aria-expanded", "false");
}

function openProfileMenu() {
  if (!profileMenuPanel || !profileMenuTrigger) return;
  closeMobileNav();
  profileMenuPanel.classList.add("is-open");
  profileMenuPanel.setAttribute("aria-hidden", "false");
  profileMenuTrigger.setAttribute("aria-expanded", "true");
}

function toggleProfileMenu() {
  if (!profileMenuPanel.classList.contains("is-open")) {
    openProfileMenu();
  } else {
    closeProfileMenu();
  }
}

function closeMobileNav() {
  if (!navBurger || !navAnchors) return;
  navBurger.setAttribute("aria-expanded", "false");
  navAnchors.classList.remove("is-open");
  if (window.matchMedia("(max-width: 720px)").matches) {
    navAnchors.setAttribute("aria-hidden", "true");
  } else {
    navAnchors.removeAttribute("aria-hidden");
  }
}

function openMobileNav() {
  if (!navBurger || !navAnchors) return;
  closeProfileMenu();
  navBurger.setAttribute("aria-expanded", "true");
  navAnchors.classList.add("is-open");
  navAnchors.setAttribute("aria-hidden", "false");
}

function toggleMobileNav() {
  if (!navAnchors) return;
  if (!navAnchors.classList.contains("is-open")) {
    openMobileNav();
  } else {
    closeMobileNav();
  }
}

/** Avoid .nav-anchors panel animating when mobile/desktop media rules first apply */
function suppressNavAnchorsBreakpointTransition() {
  if (!navAnchors) return;
  navAnchors.style.transition = "none";
  void navAnchors.offsetHeight;
  requestAnimationFrame(() => {
    navAnchors.style.transition = "";
  });
}

function onDocumentClickCloseMenu(event) {
  if (navAuthUser.hidden) return;
  if (!profileMenuPanel.classList.contains("is-open")) return;
  if (!event.target.closest(".nav-account-dropdown")) {
    closeProfileMenu();
  }
}

function onDocumentClickDismissNav(event) {
  if (
    navAnchors?.classList.contains("is-open")
    && !event.target.closest("#nav-burger")
    && !event.target.closest("#nav-anchors")
  ) {
    closeMobileNav();
  }
}

function onDocumentKeydownMenu(event) {
  if (event.key === "Escape") {
    closeProfileMenu();
    closeMobileNav();
  }
}

init().catch((error) => {
  console.error(error);
  setAccountFeedback(`Could not reach the server: ${error.message}`, "is-warn");
  setLoginHint(`Could not reach the server: ${error.message}`);
});

async function init() {
  latestSettings = settingsWithMigratedGuest(await fetchJson("/api/settings"));
  applySettings(latestSettings);
  updateTokenStatus(latestSettings);
  updateCloseAppVisibility(latestSettings);
  showHashMessages();
  setupFooterRepo();

  saveAccountButton.addEventListener("click", saveSettings);
  saveMenuButton.addEventListener("click", () => {
    closeProfileMenu();
    saveSettings();
  });
  loginButton.addEventListener("click", loginWithOsu);
  profileMenuTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleProfileMenu();
  });
  logoutButton.addEventListener("click", logoutFromOsu);
  closeAppButton.addEventListener("click", closeApp);
  document.addEventListener("click", onDocumentClickCloseMenu);
  document.addEventListener("click", onDocumentClickDismissNav);
  document.addEventListener("keydown", onDocumentKeydownMenu);

  navBurger?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMobileNav();
  });
  navAnchors?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      closeMobileNav();
    });
  });

  const mqMobileNav = window.matchMedia("(max-width: 720px)");
  mqMobileNav.addEventListener("change", () => {
    if (!mqMobileNav.matches) {
      closeMobileNav();
    }
    suppressNavAnchorsBreakpointTransition();
  });

  if (navAnchors && window.matchMedia("(max-width: 720px)").matches) {
    navAnchors.setAttribute(
      "aria-hidden",
      navAnchors.classList.contains("is-open") ? "false" : "true",
    );
  }

  copyCallbackButton.addEventListener("click", copyCallbackUrl);
  showOauthSetup.addEventListener("click", () => {
    oauthPanel.hidden = false;
    window.location.hash = "setup";
    clientIdInput.focus();
  });
  guestForm.addEventListener("submit", (event) => runScript(event, "guest"));
  oldestForm.addEventListener("submit", (event) => runScript(event, "oldest"));

  window.addEventListener("hashchange", showHashMessages);

  guestUnifiedTemplate?.addEventListener("input", updateGuestTemplatePreview);

  resetGuestTemplate?.addEventListener("click", () => {
    if (confirm("Reset BBCode template to defaults?")) {
      guestUnifiedTemplate.value = GUEST_UNIFIED_VISUAL_DEFAULT;
      setGuestTemplateParseHint(true, null);
      updateGuestTemplatePreview();
    }
  });
}

function previewGuestUsername() {
  const u = latestSettings?.oauth?.loggedInUser;
  if (u?.username) {
    return u.username;
  }
  return "your_username";
}

function previewGuestUserId() {
  const id = latestSettings?.oauth?.loggedInUser?.id;
  return id != null ? String(id) : "000000";
}

function updateGuestTemplatePreview() {
  if (!guestTemplatePreview) {
    return;
  }

  const {
    lineTemplate: lineTpl,
    yearTemplate: yearTpl,
    yearSectionTemplate: yearSectionTpl,
    wrapperTemplate: wrapperTpl,
    noticeIntro: introForPreview,
  } = getGuestPartsFromUI();

  const sampleLine = lineTpl
    .replace(/{url}/g, "https://osu.ppy.sh/beatmapsets/12345#osu/67890")
    .replace(/{artist}/g, "Artist Name")
    .replace(/{title}/g, "Song Title")
    .replace(/{version}/g, "Extreme")
    .replace(/{status_color}/g, "#b7f36b")
    .replace(/{status_label}/g, "Ranked");

  const sampleYearHeader = yearTpl
    .replace(/{year}/g, "2026")
    .replace(/{count}/g, "1");

  const yearSectionResolved = (yearSectionTpl || "").trim() || GUEST_YEAR_SECTION_DEFAULT;

  const sampleYearBlock = yearSectionResolved
    .replace(/{year_header}/g, sampleYearHeader)
    .replace(/{entries}/g, sampleLine)
    .replace(/{year}/g, "2026")
    .replace(/{count}/g, "1");

  const sections = sampleYearBlock;

  const preview = wrapperTpl
    .replace(/{title}/g, GUEST_BOX_TITLE_FALLBACK)
    .replace(/{total}/g, "1")
    .replace(/{intro}/g, introForPreview)
    .replace(/{sections}/g, sections)
    .replace(/{username}/g, previewGuestUsername())
    .replace(/{user_id}/g, previewGuestUserId());

  guestTemplatePreview.textContent = preview;
}

function setupFooterRepo() {
  const meta = document.querySelector('meta[name="app-repo"]');
  const url = meta?.getAttribute("content")?.trim();
  if (url && /^https?:\/\//i.test(url)) {
    footerRepo.href = url;
  } else {
    footerRepo.removeAttribute("href");
    footerRepo.addEventListener("click", (e) => {
      e.preventDefault();
    });
    footerRepo.textContent = "repository (set meta app-repo)";
  }
}

function parseHashQuery() {
  const raw = window.location.hash.slice(1);
  if (!raw) {
    return { path: "", params: new URLSearchParams() };
  }
  const q = raw.indexOf("?");
  if (q === -1) {
    return { path: raw, params: new URLSearchParams() };
  }
  return { path: raw.slice(0, q), params: new URLSearchParams(raw.slice(q + 1)) };
}

function showHashMessages() {
  const { path, params } = parseHashQuery();
  if (params.get("oauthSetup") || path === "setup") {
    oauthPanel.hidden = false;
  }
  if (params.get("oauthError") === "invalid_client") {
    const msg =
      "osu! rejected the saved Client ID / Secret. Update them under Account and save, then try Log in again.";
    if (loggedIn(latestSettings)) {
      tokenStatus.textContent = msg;
      tokenStatus.className = "token-status profile-menu-status is-warn";
    } else {
      setAccountFeedback(msg, "is-warn");
      setLoginHint(msg);
    }
  }
}

function updateCloseAppVisibility(settings) {
  if (settings.runtime?.localServer) {
    closeAppButton.hidden = false;
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Unexpected response (${res.status})`);
    }
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || res.statusText;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data;
}

function applySettings(settings) {
  const g = settings.guest || {};
  const o = settings.oldest;
  const oauth = settings.oauth;

  guestForm.querySelector("#guest-target").value = g.target || "";
  guestForm.querySelector("#guest-sort").value = g.sort || "beatmap-id";
  guestForm.querySelector("#guest-page-size").value = String(g.pageSize ?? "");
  guestForm.querySelector("#guest-concurrency").value = String(g.concurrency ?? "");
  guestForm.querySelector("#guest-max-pages").value = String(g.maxPages ?? "");

  guestForm.querySelectorAll('input[name="modes"]').forEach((input) => {
    input.checked = Array.isArray(g.modes) && g.modes.includes(input.value);
  });

  oldestForm.querySelector("#oldest-target").value = o.target || "";
  oldestForm.querySelector("#oldest-beatmap").value = o.beatmapId || "";
  oldestForm.querySelector("#oldest-save-index").value = o.saveIndex || "";
  oldestForm.querySelector("#oldest-page-size").value = String(o.pageSize ?? "");
  oldestForm.querySelector("#oldest-max-pages").value = String(o.maxPages ?? "");

  oldestForm.querySelectorAll('input[name="modes"]').forEach((input) => {
    input.checked = Array.isArray(o.modes) && o.modes.includes(input.value);
  });
  oldestForm.querySelectorAll('input[name="feeds"]').forEach((input) => {
    input.checked = Array.isArray(o.feeds) && o.feeds.includes(input.value);
  });

  clientIdInput.value = oauth.clientId || "";
  clientSecretInput.value = "";
  clientSecretInput.placeholder = oauth.hasClientSecret
    ? "Leave blank to keep saved secret"
    : "Paste client secret from osu!";
  callbackUrlInput.value = oauth.callbackUrl || "";

  if (guestUnifiedTemplate) {
    const d = defaultGuestParts();
    guestUnifiedTemplate.value = buildGuestVisualEditor({
      noticeIntro: typeof g.noticeIntro === "string" ? g.noticeIntro : d.noticeIntro,
      wrapperTemplate: g.wrapperTemplate || d.wrapperTemplate,
      yearSectionTemplate: g.yearSectionTemplate || d.yearSectionTemplate,
      yearTemplate: g.yearTemplate || d.yearTemplate,
      lineTemplate: g.lineTemplate || d.lineTemplate,
      statusTemplate: g.statusTemplate || d.statusTemplate,
    });
  }
  setGuestTemplateParseHint(true, null);
  updateGuestTemplatePreview();
}

function readGuestPayload() {
  const g = latestSettings?.guest || {};
  const form = guestForm;
  const maxPagesRaw = Number.parseInt(form.querySelector("#guest-max-pages").value, 10);
  return {
    target: form.querySelector("#guest-target").value.trim(),
    output: "-",
    modes: [...form.querySelectorAll('input[name="modes"]:checked')].map((el) => el.value),
    sort: form.querySelector("#guest-sort").value,
    pageSize: Number.parseInt(form.querySelector("#guest-page-size").value, 10) || g.pageSize,
    concurrency: Number.parseInt(form.querySelector("#guest-concurrency").value, 10) || g.concurrency,
    maxPages: Number.isFinite(maxPagesRaw) ? maxPagesRaw : g.maxPages,
    dryRun: false,
    verbose: false,
    ...getGuestPartsFromUI(),
  };
}

function readOldestPayload() {
  const o = latestSettings?.oldest || {};
  const form = oldestForm;
  const maxPagesRaw = Number.parseInt(form.querySelector("#oldest-max-pages").value, 10);
  return {
    target: form.querySelector("#oldest-target").value.trim(),
    beatmapId: form.querySelector("#oldest-beatmap").value.trim(),
    saveIndex: form.querySelector("#oldest-save-index").value.trim(),
    modes: [...form.querySelectorAll('input[name="modes"]:checked')].map((el) => el.value),
    feeds: [...form.querySelectorAll('input[name="feeds"]:checked')].map((el) => el.value),
    pageSize: Number.parseInt(form.querySelector("#oldest-page-size").value, 10) || o.pageSize,
    maxPages: Number.isFinite(maxPagesRaw) ? maxPagesRaw : o.maxPages,
    verbose: false,
  };
}

function buildSaveBody() {
  const guest = readGuestPayload();
  const oldest = readOldestPayload();
  const oauth = {
    clientId: clientIdInput.value.trim(),
  };
  const secret = clientSecretInput.value.trim();
  if (secret) {
    oauth.clientSecret = secret;
  }
  return { guest, oldest, oauth };
}

async function saveSettings() {
  const wasLoggedIn = loggedIn(latestSettings);
  saveAccountButton.disabled = true;
  saveMenuButton.disabled = true;
  try {
    latestSettings = settingsWithMigratedGuest(
      await fetchJson("/api/settings", {
        method: "POST",
        body: JSON.stringify(buildSaveBody()),
      }),
    );
    applySettings(latestSettings);
    updateTokenStatus(latestSettings);
    if (loggedIn(latestSettings)) {
      tokenStatus.textContent = "Settings saved.";
      tokenStatus.className = "token-status profile-menu-status is-ok";
    } else {
      setAccountFeedback("Settings saved.", "is-ok");
    }
    setLoginHint("");
  } catch (error) {
    if (wasLoggedIn) {
      tokenStatus.textContent = error.message;
      tokenStatus.className = "token-status profile-menu-status is-warn";
    } else {
      setAccountFeedback(error.message, "is-warn");
    }
  } finally {
    saveAccountButton.disabled = false;
    saveMenuButton.disabled = false;
  }
}

function updateTokenStatus(settings) {
  const { oauth, hasEnvAccessToken, hasUsableAccessToken } = settings;
  const user = oauth.loggedInUser;
  const signedIn = loggedIn(settings);

  navAuthGuest.hidden = signedIn;
  navAuthUser.hidden = !signedIn;
  if (!signedIn) {
    closeProfileMenu();
  }

  accountAvatar.hidden = true;

  if (signedIn && user?.username) {
    accountLabel.textContent = user.username;
    if (user.avatarUrl) {
      accountAvatar.src = user.avatarUrl;
      accountAvatar.hidden = false;
    }
    const exp = oauth.tokenExpiresAt ? new Date(oauth.tokenExpiresAt).toLocaleString() : "";
    tokenStatus.textContent = exp
      ? `Signed in as ${user.username}. Token refresh window until ${exp}.`
      : `Signed in as ${user.username}.`;
    tokenStatus.className = "token-status profile-menu-status is-ok";
    setAccountFeedback("");
    setLoginHint("");
    return;
  }

  if (hasEnvAccessToken) {
    setAccountFeedback(
      "This server uses OSU_ACCESS_TOKEN from the environment for script runs (no profile login required).",
      "is-ok",
    );
    setLoginHint("");
    return;
  }

  if (oauth.hasSavedAccessToken && oauth.isExpired && !oauth.canRefresh) {
    setAccountFeedback(
      "Saved osu! login expired. Add Client Secret under Account, save, or log in again.",
      "is-warn",
    );
    setLoginHint("Saved login expired — update Client Secret in Account, then Save.");
    return;
  }

  if (oauth.hasSavedAccessToken && oauth.isExpired && oauth.canRefresh) {
    setAccountFeedback(
      "Saved token expired — it will refresh on the next script run if the secret is valid.",
      "is-warn",
    );
    setLoginHint("");
    return;
  }

  if (!hasUsableAccessToken) {
    setAccountFeedback(
      "Not logged in — guest export uses public ranked/loved data only. Sign in for full guest search on your maps.",
      "",
    );
    setLoginHint("");
    return;
  }

  setAccountFeedback("Ready — optional: sign in with osu! for authenticated guest scans.", "is-ok");
  setLoginHint("");
}

function loginWithOsu() {
  window.location.href = "/auth/osu/start";
}

async function logoutFromOsu() {
  logoutButton.disabled = true;
  try {
    latestSettings = settingsWithMigratedGuest(
      await fetchJson("/api/auth/logout", { method: "POST" }),
    );
    applySettings(latestSettings);
    updateTokenStatus(latestSettings);
    closeProfileMenu();
  } catch (error) {
    tokenStatus.textContent = error.message;
    tokenStatus.className = "token-status profile-menu-status is-warn";
  } finally {
    logoutButton.disabled = false;
  }
}

async function closeApp() {
  closeAppButton.disabled = true;
  try {
    await fetchJson("/api/shutdown", { method: "POST" });
    tokenStatus.textContent = "Server closed.";
    tokenStatus.className = "token-status profile-menu-status is-ok";
    closeProfileMenu();
  } catch (error) {
    tokenStatus.textContent = error.message;
    tokenStatus.className = "token-status profile-menu-status is-warn";
  } finally {
    closeAppButton.disabled = false;
  }
}

async function copyCallbackUrl() {
  const value = callbackUrlInput.value;
  try {
    await navigator.clipboard.writeText(value);
    copyCallbackButton.textContent = "Copied";
    setTimeout(() => {
      copyCallbackButton.textContent = "Copy callback";
    }, 1600);
  } catch {
    callbackUrlInput.select();
    document.execCommand("copy");
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

function bbcodeToHtml(bbcode) {
  let html = escapeHtml(bbcode || "");

  html = html.replace(/\[box=([^\]]+)\]([\s\S]*?)\[\/box\]/gi, (_match, title, body) => {
    return `<section class="bbcode-preview-box"><div class="bbcode-preview-box-title">${title}</div><div>${body}</div></section>`;
  });

  html = html.replace(/\[notice\]([\s\S]*?)\[\/notice\]/gi, '<div class="bbcode-preview-notice">$1</div>');
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  html = html.replace(/\[size=\d+\]([\s\S]*?)\[\/size\]/gi, '<span class="bbcode-preview-small">$1</span>');
  html = html.replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, (_match, color, body) => {
    return `<span style="color:${color}">${body}</span>`;
  });
  html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, url, label) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  return html.replace(/\n/g, '<br>');
}

function renderGuestStatusLine(data) {
  const counts = data.counts || {};
  const pieces = [
    `${counts.guestDifficulties ?? 0} found`,
    `${counts.existingUpdated ?? 0} updated`,
    `${counts.newCount ?? 0} new`,
  ];

  if (data.fileWritten && data.outputPath && data.outputPath !== '-') {
    pieces.push(`saved to ${data.outputPath}`);
  } else if (data.dryRun) {
    pieces.push('dry run');
  }

  return pieces.join(' · ');
}

function renderGuestStructured(data) {
  const parts = [];

  parts.push(`<p class="results-summary-line">${escapeHtml(renderGuestStatusLine(data))}</p>`);

  if (data.outputBbcode) {
    const id = `bbcode-${Math.random().toString(36).slice(2)}`;
    const previewId = `${id}-preview`;
    parts.push(
      `<div class="bbcode-block">
        <div class="bbcode-result-toolbar" role="group" aria-label="BBCode result view">
          <button type="button" class="btn btn-secondary btn-sm is-active" data-bbcode-view="raw" data-raw-id="${id}" data-preview-id="${previewId}">Raw</button>
          <button type="button" class="btn btn-secondary btn-sm" data-bbcode-view="preview" data-raw-id="${id}" data-preview-id="${previewId}">Preview</button>
        </div>
        <textarea id="${id}" class="bbcode-textarea" readonly>${escapeHtml(data.outputBbcode)}</textarea>
        <div id="${previewId}" class="bbcode-rendered-preview" hidden>${bbcodeToHtml(data.outputBbcode)}</div>
        <p class="bbcode-actions"><button type="button" class="btn btn-secondary btn-sm" data-copy-target="${id}">Copy BBCode</button></p>
      </div>`,
    );
  } else {
    parts.push('<p>No BBCode output returned.</p>');
  }

  return parts.join('');
}

function renderOldestStructured(data) {
  if (data.noScores) {
    return `<p>${escapeHtml(data.disclaimer || "No publicly visible scores were returned.")}</p>`;
  }
  const scores = data.oldestScores || [];
  if (!Array.isArray(scores) || scores.length === 0) {
    return `<p>${escapeHtml(data.disclaimer || "No scores returned.")}</p>`;
  }
  const visibleScores = scores.slice(0, 4);
  const items = visibleScores
    .map((score, index) => {
      const title = score.beatmapTitle || [score.artist, score.title].filter(Boolean).join(" - ") || "Beatmap";
      const when = escapeHtml(score.ended_at || "");
      const link = score.score_url
        ? `<a href="${escapeHtml(score.score_url)}" target="_blank" rel="noopener">open score</a>`
        : "";
      return `<li><strong>${index + 1}.</strong> ${when} — ${escapeHtml(title)}${
        score.beatmap_version ? ` [${escapeHtml(score.beatmap_version)}]` : ""
      } — ${link}</li>`;
    })
    .join("");
  return `<ul class="score-list">${items}</ul>`;
}

function wireCopyButtons(container) {
  container.querySelectorAll("[data-copy-target]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-copy-target");
      const ta = document.getElementById(id);
      if (!ta) return;
      try {
        await navigator.clipboard.writeText(ta.value);
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = "Copy BBCode";
        }, 1500);
      } catch {
        ta.select();
        document.execCommand("copy");
      }
    });
  });

  container.querySelectorAll("[data-bbcode-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = document.getElementById(btn.getAttribute("data-raw-id"));
      const preview = document.getElementById(btn.getAttribute("data-preview-id"));
      if (!raw || !preview) return;

      const showPreview = btn.getAttribute("data-bbcode-view") === "preview";
      raw.hidden = showPreview;
      preview.hidden = !showPreview;

      container.querySelectorAll(`[data-raw-id="${btn.getAttribute("data-raw-id")}"]`).forEach((viewBtn) => {
        viewBtn.classList.toggle("is-active", viewBtn === btn);
      });
    });
  });
}

function appendTerminalLog(logEl, text) {
  if (!logEl || !text) return;
  logEl.textContent += text;
  const scroller = logEl.closest(".tool-results-scroll") || logEl.parentElement;
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
  }
}

function normalizeRunLogLine(event) {
  if (!event) return "";
  const text = event.text ?? event.chunk ?? event.data ?? event.message ?? "";
  if (!text) return "";
  return text;
}

async function readStreamingRunResponse(response, logEl) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error("This browser cannot read streaming responses.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        appendTerminalLog(logEl, `${line}\n`);
        continue;
      }

      if (event.type === "log") {
        appendTerminalLog(logEl, normalizeRunLogLine(event));
      } else if (event.type === "result" || event.type === "done") {
        finalResult = event.result || event;
      } else if (event.type === "error") {
        throw new Error(event.message || "Script failed.");
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    try {
      const event = JSON.parse(tail);
      if (event.type === "result" || event.type === "done") {
        finalResult = event.result || event;
      } else if (event.type === "log") {
        appendTerminalLog(logEl, normalizeRunLogLine(event));
      }
    } catch {
      appendTerminalLog(logEl, `${buffer}\n`);
    }
  }

  if (!finalResult) {
    throw new Error("Streaming run finished without a final result.");
  }

  return finalResult;
}

async function fetchRunResult(payload, logEl) {
  const streamResponse = await fetch("/api/run/stream", {
    method: "POST",
    headers: {
      accept: "application/x-ndjson, application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (streamResponse.status !== 404) {
    if (!streamResponse.ok) {
      let message = `Request failed (${streamResponse.status})`;
      try {
        const errorData = await streamResponse.json();
        message = errorData?.error || errorData?.message || message;
      } catch {
        // Keep the generic message. Humanity survives, probably.
      }
      throw new Error(message);
    }
    return readStreamingRunResponse(streamResponse, logEl);
  }

  appendTerminalLog(logEl, "Streaming endpoint missing; falling back to non-live /api/run.\n");
  const result = await fetchJson("/api/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  appendTerminalLog(logEl, `${result.stderr || ""}${result.stdout || ""}`.trim() || "(no log)");
  return result;
}

async function runScript(event, script) {
  event.preventDefault();
  const form = script === "guest" ? guestForm : oldestForm;
  const submit = form.querySelector('button[type="submit"]');
  const target =
    script === "guest" ? readGuestPayload().target : readOldestPayload().target;
  if (!target) {
    setAccountFeedback("Enter a profile URL, username, or user id.", "is-warn");
    const focusSel = script === "guest" ? "#guest-target" : "#oldest-target";
    form.querySelector(focusSel)?.focus();
    return;
  }

  submit.disabled = true;
  const bodyEl = runResultsBody;
  const logEl = runResultsLog;
  bodyEl.innerHTML = "<p>Running…</p>";
  logEl.textContent = "";
  logEl.closest("details")?.setAttribute("open", "");

  try {
    const settings = script === "guest" ? readGuestPayload() : readOldestPayload();
    const payload = { script, target, settings };
    const result = await fetchRunResult(payload, logEl);

    if (!logEl.textContent.trim()) {
      logEl.textContent = "(no log)";
    }

    if (result.structured) {
      bodyEl.innerHTML =
        script === "guest"
          ? renderGuestStructured(result.structured)
          : renderOldestStructured(result.structured);
      wireCopyButtons(bodyEl);
    } else {
      bodyEl.innerHTML = `<pre class="log-pre" style="max-height:none">${escapeHtml(
        result.stdout || result.stderr || "No output",
      )}</pre>`;
    }

    if (!result.ok) {
      bodyEl.insertAdjacentHTML(
        "afterbegin",
        `<p class="token-status is-warn" style="max-width:none">Script exited with code ${escapeHtml(
          String(result.code),
        )}.</p>`,
      );
    }

    latestSettings = settingsWithMigratedGuest(await fetchJson("/api/settings"));
    updateTokenStatus(latestSettings);
  } catch (error) {
    bodyEl.innerHTML = `<p class="token-status is-warn" style="max-width:none">${escapeHtml(
      error.message,
    )}</p>`;
  } finally {
    submit.disabled = false;
  }
}
