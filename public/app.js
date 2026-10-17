const guestForm = document.querySelector("#guest-form");
const oldestForm = document.querySelector("#oldest-form");
const mergeForm = document.querySelector("#merge-form");
const timingForm = document.querySelector("#timing-form");
const surgicalForm = document.querySelector("#surgical-form");
const tokenStatus = document.querySelector("#token-status");
const saveMenuButton = document.querySelector("#save-settings-menu");
const loginButton = document.querySelector("#login-osu");
const heroLoginButton = document.querySelector("#hero-login-osu");
const logoutButton = document.querySelector("#logout-osu");
const closeAppButton = document.querySelector("#close-app");
const accountAvatar = document.querySelector("#account-avatar");
const accountLabel = document.querySelector("#account-label");
const navAuthGuest = document.querySelector("#nav-auth-guest");
const navAuthUser = document.querySelector("#nav-auth-user");
const profileMenuTrigger = document.querySelector("#profile-menu-trigger");
const profileMenuPanel = document.querySelector("#profile-menu-panel");
const accountFeedback = document.querySelector("#account-feedback");
const footerRepo = document.querySelector("#footer-repo");
const navBurger = document.querySelector("#nav-burger");
const navAnchors = document.querySelector("#nav-anchors");

const runResultsBody = document.querySelector("#run-results-body");
const runResultsLog = document.querySelector("#run-results-log");
const terminalWindowEl = document.querySelector("#terminal-window");
const terminalBtnClose = document.querySelector("#terminal-btn-close");
const terminalBtnMinimize = document.querySelector("#terminal-btn-minimize");
const terminalBtnZoom = document.querySelector("#terminal-btn-zoom");
const guestUnifiedTemplate = document.querySelector("#guest-unified-template");
const guestTemplatePreview = document.querySelector("#guest-template-preview");
const resetGuestTemplate = document.querySelector("#reset-guest-template");
const downloadPayloads = new Map();
const selectedFilesByInput = new WeakMap();
const renderedFileKeysByInput = new WeakMap();

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
      "add a line containing only # osu-guest-line, then on the next line your beatmap row template (repeated for every map).",
    "missing-line": "put one non-empty line immediately after # osu-guest-line (your repeating guest row).",
    "missing-year": "add a year heading line (with {year}) above # osu-guest-line.",
    "missing-notice": "include [notice] before the intro and year block.",
    "missing-close-tags": "after the beatmap line, keep [/notice] and [/box] (and any spacing you want).",
  };
  el.textContent = messages[reason] || "template could not be parsed; using saved or built-in defaults.";
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

/**
 * Feature flag: hide tools that aren't ready for deployment yet.
 * Covers collab merger, timing editor, and surgical timing fix
 * (nav links, dashboard tiles, and page sections marked with data-wip).
 * Flip to true when they're ready to ship.
 */
const SHOW_WIP_TOOLS = false;

function applyWipToolsFlag() {
  if (SHOW_WIP_TOOLS) {
    return;
  }
  document.querySelectorAll("[data-wip]").forEach((el) => {
    el.hidden = true;
  });
}

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
  const t = text || "";
  for (const btn of [loginButton, heroLoginButton]) {
    if (btn) {
      btn.title = t;
    }
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
  if (!profileMenuPanel) {
    return;
  }
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
  if (!navAuthUser || navAuthUser.hidden) return;
  if (!profileMenuPanel?.classList.contains("is-open")) return;
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
    document.getElementById("guest-sort-panel")?.classList.remove("is-open");
  }
}

init().catch((error) => {
  console.error(error);
  setAccountFeedback(`could not reach the server: ${error.message}`, "is-warn");
  setLoginHint(`could not reach the server: ${error.message}`);
});

async function init() {
  latestSettings = settingsWithMigratedGuest(await fetchJson("/api/settings"));
  applyWipToolsFlag();
  applySettings(latestSettings);
  updateTokenStatus(latestSettings);
  updateCloseAppVisibility(latestSettings);
  showHashMessages();
  setupFooterRepo();

  saveMenuButton?.addEventListener("click", () => {
    closeProfileMenu();
    saveSettings();
  });
  loginButton.addEventListener("click", loginWithOsu);
  heroLoginButton?.addEventListener("click", loginWithOsu);
  profileMenuTrigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleProfileMenu();
  });
  logoutButton.addEventListener("click", logoutFromOsu);
  closeAppButton.addEventListener("click", closeApp);
  document.addEventListener("click", onDocumentClickCloseMenu);
  document.addEventListener("click", onDocumentClickDismissNav);
  document.addEventListener("keydown", onDocumentKeydownMenu);
  document.addEventListener("mousemove", (e) => {
    for (const card of document.querySelectorAll(".btn-run, .file-upload-control")) {
      const rect = card.getBoundingClientRect(),
        x = e.clientX - rect.left,
        y = e.clientY - rect.top;

      card.style.setProperty("--mouse-x", `${x}px`);
      card.style.setProperty("--mouse-y", `${y}px`);
    }
  });

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

  const guestSortTrigger = document.getElementById("guest-sort-trigger");
  const guestSortPanel = document.getElementById("guest-sort-panel");
  const guestSortInput = document.getElementById("guest-sort");
  const guestSortDisplay = document.getElementById("guest-sort-display");

  guestSortTrigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    guestSortPanel.classList.toggle("is-open");
    const isOpen = guestSortPanel.classList.contains("is-open");
    guestSortTrigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    guestSortPanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  });

  document.addEventListener("click", (e) => {
    if (guestSortPanel?.classList.contains("is-open") && !e.target.closest("#guest-sort-dropdown")) {
      guestSortPanel.classList.remove("is-open");
      guestSortTrigger.setAttribute("aria-expanded", "false");
      guestSortPanel.setAttribute("aria-hidden", "true");
    }
  });

  guestSortPanel?.querySelectorAll(".sort-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      guestSortInput.value = opt.dataset.value;
      guestSortDisplay.textContent = opt.textContent;
      guestSortPanel.classList.remove("is-open");
      guestSortTrigger.setAttribute("aria-expanded", "false");
      guestSortPanel.setAttribute("aria-hidden", "true");
      
      guestSortPanel.querySelectorAll(".sort-option").forEach(o => o.setAttribute("aria-selected", "false"));
      opt.setAttribute("aria-selected", "true");
    });
  });

  guestForm?.addEventListener("submit", (event) => runScript(event, "guest"));
  oldestForm?.addEventListener("submit", (event) => runScript(event, "oldest"));
  mergeForm?.addEventListener("submit", (event) => runScript(event, "merge"));
  timingForm?.addEventListener("submit", (event) => runScript(event, "timing"));
  surgicalForm?.addEventListener("submit", (event) => runScript(event, "surgical"));
  setupFileUploadLabels();
  setupTimingEditor();

  terminalBtnClose?.addEventListener("click", () => {
    if (runResultsLog) runResultsLog.textContent = "";
  });

  terminalBtnMinimize?.addEventListener("click", () => {
    if (!terminalWindowEl) return;
    terminalWindowEl.classList.toggle("is-terminal-minimized");
    terminalWindowEl.classList.remove("is-terminal-maximized");
    const collapsed = terminalWindowEl.classList.contains("is-terminal-minimized");
    terminalBtnMinimize?.setAttribute("aria-pressed", collapsed ? "true" : "false");
    terminalBtnZoom?.setAttribute("aria-pressed", "false");
  });

  terminalBtnZoom?.addEventListener("click", () => {
    if (!terminalWindowEl) return;
    if (terminalWindowEl.classList.contains("is-terminal-minimized")) {
      terminalWindowEl.classList.remove("is-terminal-minimized");
      terminalBtnMinimize?.setAttribute("aria-pressed", "false");
    }
    terminalWindowEl.classList.toggle("is-terminal-maximized");
    const expanded = terminalWindowEl.classList.contains("is-terminal-maximized");
    terminalBtnZoom?.setAttribute("aria-pressed", expanded ? "true" : "false");
  });

  runResultsLog?.addEventListener("dblclick", async () => {
    const text = runResultsLog.textContent;
    if (!text?.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(runResultsLog);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("copy");
      sel.removeAllRanges();
    }
  });

  window.addEventListener("hashchange", showHashMessages);

  guestUnifiedTemplate?.addEventListener("input", updateGuestTemplatePreview);

  resetGuestTemplate?.addEventListener("click", () => {
    if (confirm("Reset BBCode template to defaults?")) {
      guestUnifiedTemplate.value = GUEST_UNIFIED_VISUAL_DEFAULT;
      setGuestTemplateParseHint(true, null);
      updateGuestTemplatePreview();
    }
  });

  // Tool card click handlers - Intercept locked tools for guests
  document.querySelectorAll(".tool-tile[data-requires-auth='true'], .nav-tool-link[data-requires-auth='true']").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (!loggedIn(latestSettings)) {
        event.preventDefault();
        const banner = document.getElementById("hero-dashboard-login-banner");
        if (banner) {
          banner.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    });
  });

  // Smooth scroll to target sections
  document.querySelectorAll(".tool-tile, .nav-tool-link, .nav-anchors a:not(.nav-tool-link)").forEach((tile) => {
    tile.addEventListener("click", (event) => {
      const targetId = tile.getAttribute("href");
      if (targetId && targetId.startsWith("#")) {
        // Only run if not intercepted (signed-in)
        if (!tile.dataset.requiresAuth || loggedIn(latestSettings)) {
          const section = document.querySelector(targetId);
          if (section) {
            event.preventDefault();
            section.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      }
    });
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
    footerRepo.textContent = "repository (set meta[name=app-repo])";
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
  const { params } = parseHashQuery();
  if (params.get("oauthError") === "invalid_client") {
    const msg =
      "Sign-in could not be completed. The site operator should verify OSU_OAUTH_CLIENT_ID, OSU_OAUTH_CLIENT_SECRET, and the callback URL on osu.ppy.sh.";
    if (loggedIn(latestSettings)) {
      tokenStatus.textContent = msg;
      tokenStatus.className = "token-status profile-menu-status is-warn";
    } else {
      setAccountFeedback(msg, "is-warn");
      setLoginHint(msg);
    }
  }
  if (params.get("oauthError") === "unconfigured") {
    const msg = "Sign-in is not enabled: the server is missing OSU_OAUTH_CLIENT_ID and OSU_OAUTH_CLIENT_SECRET.";
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
      throw new Error(`unexpected response (${res.status})`);
    }
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || res.statusText;
    throw new Error(msg || `request failed (${res.status})`);
  }
  return data;
}

function applySettings(settings) {
  const g = settings.guest || {};
  const o = settings.oldest;

  if (guestForm) {
    guestForm.querySelector("#guest-target").value = g.target || "";

    const sortVal = g.sort || "last-updated";
    guestForm.querySelector("#guest-sort").value = sortVal;
    const sortOpt = document.querySelector(`.sort-option[data-value="${sortVal}"]`);
    if (sortOpt && document.getElementById("guest-sort-display")) {
      document.getElementById("guest-sort-display").textContent = sortOpt.textContent;
      document.querySelectorAll(".sort-option").forEach((x) => x.setAttribute("aria-selected", "false"));
      sortOpt.setAttribute("aria-selected", "true");
    }

    guestForm.querySelector("#guest-page-size").value = String(g.pageSize ?? "");
    guestForm.querySelector("#guest-concurrency").value = String(g.concurrency ?? "");
    guestForm.querySelector("#guest-max-pages").value = String(g.maxPages ?? "");

    guestForm.querySelectorAll('input[name="modes"]').forEach((input) => {
      input.checked = Array.isArray(g.modes) && g.modes.includes(input.value);
    });
  }

  if (oldestForm) {
    oldestForm.querySelector("#oldest-target").value = o.target || "";
    oldestForm.querySelector("#oldest-beatmap").value = o.beatmapId || "";
    oldestForm.querySelector("#oldest-page-size").value = String(o.pageSize ?? "");
    oldestForm.querySelector("#oldest-max-pages").value = String(o.maxPages ?? "");
    oldestForm.querySelector("#oldest-result-count").value = String(
      o.resultCount != null ? o.resultCount : 5,
    );

    oldestForm.querySelectorAll('input[name="modes"]').forEach((input) => {
      input.checked = Array.isArray(o.modes) && o.modes.includes(input.value);
    });
    oldestForm.querySelectorAll('input[name="feeds"]').forEach((input) => {
      input.checked = Array.isArray(o.feeds) && o.feeds.includes(input.value);
    });
  }

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
  const resultCountRaw = Number.parseInt(form.querySelector("#oldest-result-count").value, 10);
  return {
    target: form.querySelector("#oldest-target").value.trim(),
    beatmapId: form.querySelector("#oldest-beatmap").value.trim(),
    modes: [...form.querySelectorAll('input[name="modes"]:checked')].map((el) => el.value),
    feeds: [...form.querySelectorAll('input[name="feeds"]:checked')].map((el) => el.value),
    pageSize: Number.parseInt(form.querySelector("#oldest-page-size").value, 10) || o.pageSize,
    maxPages: Number.isFinite(maxPagesRaw) ? maxPagesRaw : o.maxPages,
    resultCount: Number.isInteger(resultCountRaw) && resultCountRaw >= 1
      ? Math.min(resultCountRaw, 100)
      : o.resultCount ?? 5,
    verbose: false,
  };
}

function updateFileUploadLabel(input) {
  const list = document.querySelector(`[data-file-list-for="${CSS.escape(input.id)}"]`);
  const control = input.nextElementSibling;
  if (!list) {
    return;
  }
  const files = selectedFilesByInput.get(input) || [...(input.files || [])];
  const nextKeys = files.map(fileKey);
  const previousKeys = renderedFileKeysByInput.get(input) || [];
  const listChanged =
    nextKeys.length !== previousKeys.length ||
    nextKeys.some((key, index) => key !== previousKeys[index]);
  control?.classList.toggle("is-has-file", files.length > 0);
  list.setAttribute("aria-hidden", files.length > 0 ? "false" : "true");
  if (!listChanged) {
    return;
  }

  const previousRects = new Map(
    [...list.querySelectorAll(".file-upload-file")]
      .map((item) => [item.dataset.fileKey, item.getBoundingClientRect()]),
  );

  if (files.length === 0) {
    list.replaceChildren();
    renderedFileKeysByInput.set(input, nextKeys);
    return;
  }
  list.replaceChildren(
    ...files.map((file) => {
      const item = document.createElement("span");
      item.className = "file-upload-file";
      item.dataset.fileKey = fileKey(file);
      const name = document.createElement("span");
      name.className = "file-upload-file-name";
      name.textContent = file.name;
      const size = document.createElement("span");
      size.className = "file-upload-file-size";
      size.textContent = formatFileSize(file.size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "file-upload-file-remove";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">close</span>';
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeSelectedFile(input, file);
      });
      item.append(name, size, remove);
      return item;
    }),
  );
  renderedFileKeysByInput.set(input, nextKeys);
  animateFileListChanges(list, previousRects);
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileKey(file) {
  return [file.name, file.size, file.lastModified].join(":");
}

function mergeFiles(existing, incoming, multiple) {
  if (!multiple) {
    return incoming.slice(0, 1);
  }
  const byKey = new Map(existing.map((file) => [fileKey(file), file]));
  for (const file of incoming) {
    byKey.set(fileKey(file), file);
  }
  return [...byKey.values()];
}

function syncSelectedFiles(input, files) {
  selectedFilesByInput.set(input, files);
  const transfer = new DataTransfer();
  for (const file of files) {
    transfer.items.add(file);
  }
  input.files = transfer.files;
  updateFileUploadLabel(input);
  if (input.closest("#timing-form")) {
    updateTimingSummary();
  }
  if (input.id === "merge-base-file") {
    const outputInput = document.getElementById("merge-output-name");
    if (outputInput) {
      outputInput.value = files[0] ? files[0].name : "";
    }
  } else if (input.id === "surgical-base-file") {
    const outputInput = document.getElementById("surgical-output-name");
    if (outputInput) {
      outputInput.value = files[0] ? files[0].name : "";
    }
  }
}

function removeSelectedFile(input, fileToRemove) {
  const removeKey = fileKey(fileToRemove);
  const next = (selectedFilesByInput.get(input) || [...(input.files || [])])
    .filter((file) => fileKey(file) !== removeKey);
  syncSelectedFiles(input, next);
}

function animateFileListChanges(list, previousRects) {
  requestAnimationFrame(() => {
    for (const item of list.querySelectorAll(".file-upload-file")) {
      const previous = previousRects.get(item.dataset.fileKey);
      if (!previous) {
        item.animate(
          [
            { opacity: 0, transform: "translateY(6px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 180, easing: "cubic-bezier(0.075, 0.82, 0.165, 1)" },
        );
        continue;
      }

      const next = item.getBoundingClientRect();
      const deltaX = previous.left - next.left;
      const deltaY = previous.top - next.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        continue;
      }
      item.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 220, easing: "cubic-bezier(0.075, 0.82, 0.165, 1)" },
      );
    }
  });
}

function setupFileUploadLabels() {
  document.querySelectorAll(".file-input-native").forEach((input) => {
    const initialFiles = [...(input.files || [])];
    selectedFilesByInput.set(input, initialFiles);
    const control = input.nextElementSibling;
    updateFileUploadLabel(input);
    
    if (input.id === "merge-base-file") {
      const outputInput = document.getElementById("merge-output-name");
      if (outputInput) {
        outputInput.value = initialFiles[0] ? initialFiles[0].name : "";
      }
    } else if (input.id === "surgical-base-file") {
      const outputInput = document.getElementById("surgical-output-name");
      if (outputInput) {
        outputInput.value = initialFiles[0] ? initialFiles[0].name : "";
      }
    }

    input.addEventListener("change", () => {
      const existing = selectedFilesByInput.get(input) || [];
      const incoming = [...(input.files || [])];
      syncSelectedFiles(input, mergeFiles(existing, incoming, input.multiple));
    });
    if (!control?.classList.contains("file-upload-control")) {
      return;
    }
    control.addEventListener("dragover", (event) => {
      event.preventDefault();
      control.classList.add("is-drag-over");
    });
    control.addEventListener("dragleave", () => {
      control.classList.remove("is-drag-over");
    });
    control.addEventListener("drop", (event) => {
      event.preventDefault();
      control.classList.remove("is-drag-over");
      const files = [...(event.dataTransfer?.files || [])].filter((file) =>
        file.name.toLowerCase().endsWith(".osu"),
      );
      if (files.length === 0) {
        return;
      }
      const existing = selectedFilesByInput.get(input) || [];
      syncSelectedFiles(input, mergeFiles(existing, files, input.multiple));
    });
  });
}

async function fileToPayload(file) {
  if (!file) {
    return null;
  }
  return {
    name: file.name,
    content: await file.text(),
  };
}

function selectedTimingTransform() {
  return timingForm?.querySelector('input[name="timingTransform"]:checked')?.value || "double";
}

function timingTransformConfig(transform = selectedTimingTransform()) {
  if (transform === "half") {
    return {
      value: "half",
      label: "Halve BPM",
      summary: "Halve BPM on selected maps · inherited SV x2",
      suffix: "half-bpm",
      bpmScale: "0.5",
      svScale: "2",
    };
  }
  return {
    value: "double",
    label: "Double BPM",
    summary: "Double BPM on selected maps · inherited SV x0.5",
    suffix: "double-bpm",
    bpmScale: "2",
    svScale: "0.5",
  };
}

function timingOutputName(inputName, suffix) {
  const name = inputName || "map.osu";
  const withoutExtension = name.toLowerCase().endsWith(".osu")
    ? name.slice(0, -4)
    : name;
  return `${withoutExtension}-${suffix}.osu`;
}

function timingSingleFileSettings(settings, mapFile) {
  return {
    mapFile,
    outputName: timingOutputName(mapFile?.name, settings.outputSuffix),
    svScale: settings.svScale,
    bpmScale: settings.bpmScale,
    dryRun: false,
  };
}

function updateTimingTransformCards() {
  timingForm?.querySelectorAll(".timing-action-card").forEach((card) => {
    const transform = card.dataset.timingTransformCard;
    card.classList.toggle("is-active", transform === selectedTimingTransform());
  });
}

function updateTimingSummary() {
  updateTimingTransformCards();
}

function setupTimingEditor() {
  if (!timingForm) {
    return;
  }

  timingForm.querySelectorAll('input[name="timingTransform"], #timing-map-file').forEach((input) => {
    input.addEventListener("input", updateTimingSummary);
    input.addEventListener("change", updateTimingSummary);
  });

  updateTimingSummary();
}

async function readMergePayload() {
  const form = mergeForm;
  const baseInput = form.querySelector("#merge-base-file");
  const baseFile = baseInput?.files?.[0];
  const guestInput = form.querySelector("#merge-guest-files");
  const guestFiles = [...(guestInput?.files || [])];
  return {
    baseFile: await fileToPayload(baseFile),
    guestFiles: await Promise.all(guestFiles.map((file) => fileToPayload(file))),
    outputName: form.querySelector("#merge-output-name").value.trim() || baseFile?.name || "merged.osu",
    merge: [...form.querySelectorAll('input[name="mergeSections"]:checked')].map((el) => el.value),
    offsets: {},
    sourceLabels: form.querySelector('input[name="sourceLabels"]').checked,
    dedupeTimingPoints: form.querySelector('input[name="dedupeTimingPoints"]').checked,
    dryRun: form.querySelector('input[name="dryRun"]').checked,
  };
}

async function readTimingPayload() {
  const form = timingForm;
  const mapInput = form.querySelector("#timing-map-file");
  const config = timingTransformConfig();
  const mapFiles = await Promise.all([...(mapInput?.files || [])].map((file) => fileToPayload(file)));
  return {
    mapFiles,
    transform: config.value,
    transformLabel: config.label,
    outputSuffix: config.suffix,
    svScale: config.svScale,
    bpmScale: config.bpmScale,
    dryRun: false,
  };
}

async function readSurgicalPayload() {
  const form = surgicalForm;
  const baseInput = form.querySelector("#surgical-base-file");
  const baseFile = baseInput?.files?.[0];
  const targetInput = form.querySelector("#surgical-target-file");
  return {
    baseFile: await fileToPayload(baseFile),
    targetFile: await fileToPayload(targetInput?.files?.[0]),
    outputName: form.querySelector("#surgical-output-name").value.trim() || baseFile?.name || "surgical-fixed.osu",
    dryRun: form.querySelector('input[name="dryRun"]')?.checked || false,
  };
}

function buildSaveBody() {
  const guest = guestForm ? readGuestPayload() : latestSettings?.guest;
  const oldest = oldestForm ? readOldestPayload() : latestSettings?.oldest;
  return { guest, oldest };
}

async function saveSettings() {
  const wasLoggedIn = loggedIn(latestSettings);
  if (saveMenuButton) {
    saveMenuButton.disabled = true;
  }
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
      tokenStatus.textContent = "settings saved.";
      tokenStatus.className = "token-status profile-menu-status is-ok";
    } else {
      setAccountFeedback("settings saved.", "is-ok");
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
    if (saveMenuButton) {
      saveMenuButton.disabled = false;
    }
  }
}

function syncLoginButtonState(settings) {
  if (!loginButton && !heroLoginButton) {
    return;
  }
  if (settings?.oauth?.loginAvailable === false) {
    for (const btn of [loginButton, heroLoginButton]) {
      if (btn) {
        btn.disabled = true;
        btn.title = "Sign-in is not enabled (server needs OSU_OAUTH_CLIENT_ID and OSU_OAUTH_CLIENT_SECRET).";
      }
    }
    return;
  }
  for (const btn of [loginButton, heroLoginButton]) {
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute("title");
    }
  }
}

function updateTokenStatus(settings) {
  const { oauth } = settings;
  const user = oauth.loggedInUser;
  const signedIn = loggedIn(settings);

  document.body.classList.toggle("is-signed-in", signedIn);

  syncLoginButtonState(settings);
  updateAccountPageLead(settings);

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
      ? `signed in as ${user.username} until ${exp}.`
      : `signed in as ${user.username}.`;
    tokenStatus.className = "token-status profile-menu-status is-ok";
    setAccountFeedback("");
    setLoginHint("");
    return;
  }

  setAccountFeedback("");
  setLoginHint("");
}

function updateAccountPageLead(settings) {
  const leadOk = document.getElementById("account-lead-available");
  const leadNo = document.getElementById("account-lead-unavailable");
  const leadIn = document.getElementById("account-lead-signed-in");
  const nameEl = document.getElementById("account-signed-in-name");
  if (!leadOk || !leadNo) {
    return;
  }
  if (loggedIn(settings) && leadIn && nameEl) {
    nameEl.textContent = settings.oauth?.loggedInUser?.username || "";
    leadOk.hidden = true;
    leadNo.hidden = true;
    leadIn.hidden = false;
    return;
  }
  if (leadIn) {
    leadIn.hidden = true;
  }
  const showUnavailable =
    Boolean(settings?.oauth) && "loginAvailable" in settings.oauth && !settings.oauth.loginAvailable;
  leadOk.hidden = showUnavailable;
  leadNo.hidden = !showUnavailable;
}

function loginWithOsu() {
  if (latestSettings?.oauth?.loginAvailable === false) {
    return;
  }
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
    tokenStatus.textContent = "server closed.";
    tokenStatus.className = "token-status profile-menu-status is-ok";
    closeProfileMenu();
  } catch (error) {
    tokenStatus.textContent = error.message;
    tokenStatus.className = "token-status profile-menu-status is-warn";
  } finally {
    closeAppButton.disabled = false;
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
    return `<span style="color:${safeCssColor(color)}">${body}</span>`;
  });
  html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, url, label) => {
    return `<a href="${escapeHtml(safeHref(url))}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  return html.replace(/\n/g, '<br>');
}

function safeHref(raw) {
  const value = String(raw || "").trim();
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function safeCssColor(raw) {
  const value = String(raw || "").trim();
  return /^(#[0-9a-f]{3,8}|[a-z]+|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0|1|0?\.\d+)\s*\))$/i.test(value)
    ? value
    : "inherit";
}

function renderGuestStatusLine(data) {
  const counts = data.counts || {};
  const pieces = [
    `${counts.guestDifficulties ?? 0} guest difficulties found`,
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
        <div class="bbcode-result-toolbar" role="tablist" aria-label="BBCode result view">
          <button type="button" role="tab" aria-selected="true" class="btn btn-secondary btn-sm is-active" data-bbcode-view="raw" data-raw-id="${id}" data-preview-id="${previewId}">raw</button>
          <button type="button" role="tab" aria-selected="false" class="btn btn-secondary btn-sm" data-bbcode-view="preview" data-raw-id="${id}" data-preview-id="${previewId}">preview</button>
        </div>
        <textarea id="${id}" class="bbcode-textarea" readonly>${escapeHtml(data.outputBbcode)}</textarea>
        <div id="${previewId}" class="bbcode-rendered-preview" hidden>${bbcodeToHtml(data.outputBbcode)}</div>
        <p class="bbcode-actions"><button type="button" class="btn btn-secondary btn-sm" data-copy-target="${id}">copy BBCode</button></p>
      </div>`,
    );
  } else {
    parts.push('<p>no BBCode output returned.</p>');
  }

  return parts.join('');
}

function normalizeOldestScoreUrl(raw, score) {
  // Safety net for old/cached results: convert bare legacy links into ruleset links.
  const match = String(raw).match(/^https:\/\/osu\.ppy\.sh\/scores\/(\d+)$/);
  if (match && score.mode) {
    return `https://osu.ppy.sh/scores/${encodeURIComponent(score.mode)}/${match[1]}`;
  }
  return raw;
}

function formatOldestWhen(iso) {
  if (!iso) {
    return "";
  }
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) {
    return String(iso);
  }
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function renderOldestStructured(data) {
  if (data.noScores) {
    return `<p>${escapeHtml(data.disclaimer || "No publicly visible scores were returned.")}</p>`;
  }
  const scores = data.oldestScores || [];
  if (!Array.isArray(scores) || scores.length === 0) {
    return `<p>${escapeHtml(data.disclaimer || "No scores returned.")}</p>`;
  }
  const items = scores
    .map((score, index) => {
      const title =
        score.beatmapTitle || [score.artist, score.title].filter(Boolean).join(" - ").trim() || "Beatmap";
      const whenDisplay = formatOldestWhen(score.ended_at);
      const whenIso = escapeHtml(score.ended_at || "");
      const scoreUrl = score.score_url ? normalizeOldestScoreUrl(score.score_url, score) : "";
      const mapUrl = score.beatmap_url;
      const modLabel =
        score.modsFormatted ||
        (Array.isArray(score.mods) && score.mods.length
          ? `+${score.mods
              .map((m) => (typeof m === "string" ? m : m || ""))
              .filter(Boolean)
              .join("")}`
          : null);
      const accLabel =
        score.accuracyFormatted ||
        (typeof score.accuracy === "number"
          ? `${(score.accuracy * 100).toFixed(2)}%`
          : null);
      const meta = [
        score.rank ? `Rank ${escapeHtml(String(score.rank))}` : null,
        modLabel ? escapeHtml(modLabel) : null,
        score.pp != null && score.pp > 0
          ? `${escapeHtml(String(Math.round(score.pp * 10) / 10))}pp`
          : null,
        accLabel ? escapeHtml(String(accLabel)) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const versionPart = score.beatmap_version ? ` [${escapeHtml(score.beatmap_version)}]` : "";
      return `<li class="oldest-score-card" role="article" aria-label="Score ${index + 1}">
        <div class="oldest-score-mono oldest-score-idx" aria-hidden="true">${index + 1}</div>
        <div class="oldest-score-main">
          <div class="oldest-score-time">
            <time datetime="${whenIso}">${escapeHtml(whenDisplay)}</time>
          </div>
          <div class="oldest-score-title">${escapeHtml(title)}${versionPart}</div>
          ${meta ? `<div class="oldest-score-meta">${meta}</div>` : ""}
          ${mapUrl ? `<a class="oldest-score-subtle-link" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener">view beatmap</a>` : ""}
        </div>
        <div class="oldest-score-action">
          ${
            scoreUrl
              ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(scoreUrl)}" target="_blank" rel="noopener">Open score</a>`
              : ""
          }
        </div>
      </li>`;
    })
    .join("");
  const blurb = data.disclaimer
    ? `<p class="oldest-results-note">${escapeHtml(data.disclaimer)}</p>`
    : "";
  return `${blurb}<ul class="oldest-scores" role="list">${items}</ul>`;
}

function registerOutputDownload(file) {
  if (!file?.content) {
    return "";
  }
  const id = `osu-download-${Math.random().toString(36).slice(2)}`;
  downloadPayloads.set(id, file);
  return `<button type="button" class="btn btn-secondary btn-sm" data-download-osu="${id}">Download</button>`;
}

function renderMergeStructured(data) {
  const outputName = data.outputFile?.name || data.outputPath || "merged.osu";
  const outputText = data.outputFile?.content || "";
  const guestItems = (data.guests || [])
    .map((guest) => {
      const added = guest.added || {};
      const bits = [
        added.hitobjects != null ? `+${added.hitobjects} hitobjects` : null,
        added.timing != null ? `+${added.timing} timing points` : null,
        added.timingDuplicates ? `${added.timingDuplicates} duplicate timing points skipped` : null,
        added.breaks != null ? `+${added.breaks} breaks` : null,
        added.bookmarks != null ? `+${added.bookmarks} bookmarks` : null,
      ].filter(Boolean);
      return `<li class="oldest-score-card" role="article">
        <div class="oldest-score-mono oldest-score-idx" aria-hidden="true">+</div>
        <div class="oldest-score-main">
          <div class="oldest-score-time">${escapeHtml(guest.offset ? `${guest.offset}ms offset` : "merged")}</div>
          <div class="oldest-score-title">${escapeHtml(guest.name || "guest.osu")}</div>
          <div class="oldest-score-meta">${escapeHtml(bits.join(" · ") || "no selected sections")}</div>
        </div>
      </li>`;
    })
    .join("");
  const warnings = (data.warnings || [])
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");
  return [
    `<ul class="oldest-scores" role="list">
      <li class="oldest-score-card" role="article">
        <div class="oldest-score-mono oldest-score-idx" aria-hidden="true">1</div>
        <div class="oldest-score-main">
          <div class="oldest-score-time">${escapeHtml(data.dryRun ? "dry run" : "output ready")}</div>
          <div class="oldest-score-title">${escapeHtml(outputName)}</div>
          <div class="oldest-score-meta">${escapeHtml((data.merge || []).join(" · ") || "hitobjects · timing")}</div>
        </div>
      </li>
    </ul>`,
    outputText
      ? `<pre class="log-pre osu-output-preview">${escapeHtml(outputText)}</pre>`
      : "",
    data.outputFile
      ? `<p class="bbcode-actions">${registerOutputDownload(data.outputFile)}</p>`
      : "",
    guestItems ? `<ul class="oldest-scores" role="list">${guestItems}</ul>` : "",
    warnings ? `<p class="oldest-results-note">warnings</p><ul class="score-list">${warnings}</ul>` : "",
  ].join("");
}

function renderTimingStructured(data) {
  const changed = data.changed || {};
  const outputName = data.outputFile?.name || data.outputPath || "map-edited.osu";
  const items = [
    changed.uninheritedBpmScaled != null ? `${changed.uninheritedBpmScaled} timing point${changed.uninheritedBpmScaled === 1 ? "" : "s"}` : null,
    changed.inheritedScaled != null ? `${changed.inheritedScaled} inherited point${changed.inheritedScaled === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .map((item) => `<div class="oldest-score-meta">${escapeHtml(item)}</div>`)
    .join("");
  return [
    `<ul class="oldest-scores" role="list">
      <li class="oldest-score-card" role="article">
        <div class="oldest-score-mono oldest-score-idx" aria-hidden="true">1</div>
        <div class="oldest-score-main">
          <div class="oldest-score-time">${escapeHtml(data.dryRun ? "dry run" : "output ready")}</div>
          <div class="oldest-score-title">${escapeHtml(outputName)}</div>
          ${items || '<div class="oldest-score-meta">no timing points changed</div>'}
        </div>
        <div class="oldest-score-action">
          ${registerOutputDownload(data.outputFile)}
        </div>
      </li>
    </ul>`,
  ].join("");
}

function renderTimingBatchStructured(data) {
  const files = data.files || [];
  const transformDone = data.transform === "half" ? "bpm halved" : "bpm doubled";
  const items = files
    .map((file, index) => {
      const changed = file.structured?.changed || {};
      const outputFile = file.structured?.outputFile;
      const outputName = outputFile?.name || file.outputName || "map-edited.osu";
      const meta = [
        changed.uninheritedBpmScaled != null ? `${changed.uninheritedBpmScaled} timing point${changed.uninheritedBpmScaled === 1 ? "" : "s"}` : null,
        changed.inheritedScaled != null ? `${changed.inheritedScaled} inherited point${changed.inheritedScaled === 1 ? "" : "s"}` : null,
      ].filter(Boolean).join(" · ");
      return `<li class="oldest-score-card" role="article">
        <div class="oldest-score-mono oldest-score-idx" aria-hidden="true">${index + 1}</div>
        <div class="oldest-score-main">
          <div class="oldest-score-time">${escapeHtml(file.ok ? "output ready" : "failed")}</div>
          <div class="oldest-score-title">${escapeHtml(outputName)}</div>
          <div class="oldest-score-meta">${escapeHtml(meta || "no timing points changed")}</div>
        </div>
        <div class="oldest-score-action">
          ${registerOutputDownload(outputFile)}
        </div>
      </li>`;
    })
    .join("");

  return [
    `<p class="oldest-results-note">${escapeHtml(transformDone)} for ${files.length} file${files.length === 1 ? "" : "s"}.</p>`,
    `<ul class="oldest-scores" role="list">${items}</ul>`,
  ].join("");
}

function renderSurgicalStructured(data) {
  const changed = data.changed || {};
  const outputName = data.outputFile?.name || data.outputPath || "surgical-fixed.osu";
  const meta = [
    changed.copiedUninherited != null ? `${changed.copiedUninherited} BPM timing point${changed.copiedUninherited === 1 ? "" : "s"} copied` : null,
    changed.inheritedAdjusted != null ? `${changed.inheritedAdjusted} inherited point${changed.inheritedAdjusted === 1 ? "" : "s"} adjusted` : null,
    changed.inheritedSkipped ? `${changed.inheritedSkipped} inherited point${changed.inheritedSkipped === 1 ? "" : "s"} unchanged` : null,
  ].filter(Boolean);
  return `<ul class="oldest-scores" role="list">
    <li class="oldest-score-card" role="article">
      <div class="oldest-score-mono oldest-score-idx" aria-hidden="true">1</div>
      <div class="oldest-score-main">
        <div class="oldest-score-time">${escapeHtml(data.dryRun ? "dry run" : "output ready")}</div>
        <div class="oldest-score-title">${escapeHtml(outputName)}</div>
        <div class="oldest-score-meta">${escapeHtml(meta.join(" · ") || "no timing points changed")}</div>
      </div>
      <div class="oldest-score-action">
        ${registerOutputDownload(data.outputFile)}
      </div>
    </li>
  </ul>`;
}

function renderStructuredResult(script, data) {
  if (script === "guest") return renderGuestStructured(data);
  if (script === "oldest") return renderOldestStructured(data);
  if (script === "merge") return renderMergeStructured(data);
  if (data?.type === "timing-batch") return renderTimingBatchStructured(data);
  if (script === "timing") return renderTimingStructured(data);
  if (script === "surgical") return renderSurgicalStructured(data);
  return `<pre class="log-pre" style="max-height:none">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
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
        const active = viewBtn === btn;
        viewBtn.classList.toggle("is-active", active);
        viewBtn.setAttribute("aria-selected", active ? "true" : "false");
      });
    });
  });

  container.querySelectorAll("[data-download-osu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const file = downloadPayloads.get(btn.getAttribute("data-download-osu"));
      if (!file?.content) return;
      const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name || "output.osu";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
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
    throw new Error("this browser cannot read streaming responses.");
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
        throw new Error(event.message || "script failed.");
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
    throw new Error("streaming run finished without a final result.");
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

  appendTerminalLog(logEl, "streaming endpoint missing; falling back to non-live /api/run.\n");
  const result = await fetchJson("/api/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  appendTerminalLog(logEl, `${result.stderr || ""}${result.stdout || ""}`.trim() || "(no log)");
  return result;
}

async function runScript(event, script) {
  event.preventDefault();
  if ((script === "guest" || script === "oldest") && !loggedIn(latestSettings)) {
    return;
  }
  const form =
    script === "guest" ? guestForm :
    script === "oldest" ? oldestForm :
    script === "merge" ? mergeForm :
    script === "timing" ? timingForm :
    surgicalForm;
  const submit = form.querySelector('button[type="submit"]');

  submit.disabled = true;
  const bodyEl = runResultsBody;
  const logEl = runResultsLog;
  bodyEl.innerHTML = "<p>running…</p>";
  logEl.textContent = "";
  terminalWindowEl?.classList.remove("is-terminal-minimized");
  terminalBtnMinimize?.setAttribute("aria-pressed", "false");
  logEl.closest("details")?.setAttribute("open", "");

  try {
    const settings =
      script === "guest" ? readGuestPayload() :
      script === "oldest" ? readOldestPayload() :
      script === "merge" ? await readMergePayload() :
      script === "timing" ? await readTimingPayload() :
      await readSurgicalPayload();
    const target =
      script === "guest" || script === "oldest" ? settings.target : "";

    if ((script === "guest" || script === "oldest") && !target) {
      setAccountFeedback("enter a profile URL, username, or user id.", "is-warn");
      const focusSel = script === "guest" ? "#guest-target" : "#oldest-target";
      form.querySelector(focusSel)?.focus();
      bodyEl.innerHTML = '<p class="tool-results-hint">run some scripts to see output here</p>';
      return;
    }
    if (script === "merge" && !settings.baseFile) {
      form.querySelector("#merge-base-file")?.focus();
      throw new Error("choose a base .osu file.");
    }
    if (script === "merge" && settings.guestFiles.length === 0) {
      form.querySelector("#merge-guest-files")?.focus();
      throw new Error("choose at least one guest .osu file.");
    }
    if (script === "surgical" && !settings.baseFile) {
      form.querySelector("#surgical-base-file")?.focus();
      throw new Error("choose a base .osu file.");
    }
    if (script === "surgical" && !settings.targetFile) {
      form.querySelector("#surgical-target-file")?.focus();
      throw new Error("choose a target .osu file.");
    }
    if (script === "timing" && (!Array.isArray(settings.mapFiles) || settings.mapFiles.length === 0)) {
      form.querySelector("#timing-map-file")?.focus();
      throw new Error("choose at least one map .osu file.");
    }
    if (script === "timing") {
      const files = [];
      for (const [index, mapFile] of settings.mapFiles.entries()) {
        bodyEl.innerHTML = `<p>running ${index + 1}/${settings.mapFiles.length}…</p>`;
        const fileSettings = timingSingleFileSettings(settings, mapFile);
        const result = await fetchRunResult({ script, target, settings: fileSettings }, logEl);
        files.push({
          ok: result.ok,
          code: result.code,
          inputName: mapFile.name,
          outputName: fileSettings.outputName,
          structured: result.structured,
        });
      }

      const structured = {
        type: "timing-batch",
        transform: settings.transform,
        transformLabel: settings.transformLabel,
        files,
      };
      bodyEl.innerHTML = renderStructuredResult(script, structured);
      wireCopyButtons(bodyEl);

      if (files.some((file) => !file.ok)) {
        bodyEl.insertAdjacentHTML(
          "afterbegin",
          '<p class="token-status is-warn" style="max-width:none">one or more files failed.</p>',
        );
      }

      latestSettings = settingsWithMigratedGuest(await fetchJson("/api/settings"));
      updateTokenStatus(latestSettings);
      return;
    }

    const payload = { script, target, settings };
    const result = await fetchRunResult(payload, logEl);

    if (!logEl.textContent.trim()) {
      logEl.textContent = "(no log)";
    }

    if (result.structured) {
      bodyEl.innerHTML = renderStructuredResult(script, result.structured);
      wireCopyButtons(bodyEl);
    } else {
      bodyEl.innerHTML = `<pre class="log-pre" style="max-height:none">${escapeHtml(
        result.stdout || result.stderr || "no output",
      )}</pre>`;
    }

    if (!result.ok) {
      bodyEl.insertAdjacentHTML(
        "afterbegin",
        `<p class="token-status is-warn" style="max-width:none">script exited with code ${escapeHtml(
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
