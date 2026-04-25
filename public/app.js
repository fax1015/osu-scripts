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

const guestResults = document.querySelector("#guest-results");
const guestResultsBody = document.querySelector("#guest-results-body");
const guestResultsLog = document.querySelector("#guest-results-log");
const oldestResults = document.querySelector("#oldest-results");
const oldestResultsBody = document.querySelector("#oldest-results-body");
const oldestResultsLog = document.querySelector("#oldest-results-log");

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
  latestSettings = await fetchJson("/api/settings");
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
    footerRepo.textContent = "Repository (set meta app-repo)";
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
  const g = settings.guest;
  const o = settings.oldest;
  const oauth = settings.oauth;

  guestForm.querySelector("#guest-target").value = g.target || "";
  guestForm.querySelector("#guest-output").value = g.output || "";
  guestForm.querySelector("#guest-sort").value = g.sort || "beatmap-id";
  guestForm.querySelector("#guest-page-size").value = String(g.pageSize ?? "");
  guestForm.querySelector("#guest-concurrency").value = String(g.concurrency ?? "");
  guestForm.querySelector("#guest-max-pages").value = String(g.maxPages ?? "");

  guestForm.querySelectorAll('input[name="modes"]').forEach((input) => {
    input.checked = Array.isArray(g.modes) && g.modes.includes(input.value);
  });
  guestForm.querySelector('input[name="dryRun"]').checked = Boolean(g.dryRun);
  guestForm.querySelector('input[name="verbose"]').checked = Boolean(g.verbose);

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
  oldestForm.querySelector('input[name="verbose"]').checked = Boolean(o.verbose);

  clientIdInput.value = oauth.clientId || "";
  clientSecretInput.value = "";
  clientSecretInput.placeholder = oauth.hasClientSecret
    ? "Leave blank to keep saved secret"
    : "Paste client secret from osu!";
  callbackUrlInput.value = oauth.callbackUrl || "";
}

function readGuestPayload() {
  const g = latestSettings?.guest || {};
  const form = guestForm;
  const maxPagesRaw = Number.parseInt(form.querySelector("#guest-max-pages").value, 10);
  return {
    target: form.querySelector("#guest-target").value.trim(),
    output: form.querySelector("#guest-output").value.trim() || g.output || "",
    modes: [...form.querySelectorAll('input[name="modes"]:checked')].map((el) => el.value),
    sort: form.querySelector("#guest-sort").value,
    pageSize: Number.parseInt(form.querySelector("#guest-page-size").value, 10) || g.pageSize,
    concurrency: Number.parseInt(form.querySelector("#guest-concurrency").value, 10) || g.concurrency,
    maxPages: Number.isFinite(maxPagesRaw) ? maxPagesRaw : g.maxPages,
    dryRun: form.querySelector('input[name="dryRun"]').checked,
    verbose: form.querySelector('input[name="verbose"]').checked,
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
    verbose: form.querySelector('input[name="verbose"]').checked,
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
    latestSettings = await fetchJson("/api/settings", {
      method: "POST",
      body: JSON.stringify(buildSaveBody()),
    });
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
    latestSettings = await fetchJson("/api/auth/logout", { method: "POST" });
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

function renderGuestStructured(data) {
  const parts = [];
  const u = data.user || {};
  parts.push(
    `<p><strong>${escapeHtml(u.username || "user")}</strong> — source <code>${escapeHtml(
      data.scan?.source || "",
    )}</code>, ${data.counts?.guestDifficulties ?? 0} guest difficulties.</p>`,
  );
  if (data.message) {
    parts.push(`<p>${escapeHtml(data.message)}</p>`);
  }
  if (data.outputBbcode) {
    const id = `bbcode-${Math.random().toString(36).slice(2)}`;
    parts.push(
      `<div class="bbcode-block"><label for="${id}">BBCode</label><textarea id="${id}" class="bbcode-textarea" readonly>${escapeHtml(
        data.outputBbcode,
      )}</textarea><p><button type="button" class="btn btn-secondary btn-sm" data-copy-target="${id}">Copy BBCode</button></p></div>`,
    );
  }
  return parts.join("");
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
  return `<ul class="score-list">${items}</ul><p class="section-lead">${escapeHtml(
    data.disclaimer || "",
  )}</p>`;
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
  const resultsPanel = script === "guest" ? guestResults : oldestResults;
  const bodyEl = script === "guest" ? guestResultsBody : oldestResultsBody;
  const logEl = script === "guest" ? guestResultsLog : oldestResultsLog;
  resultsPanel.hidden = false;
  bodyEl.innerHTML = "<p>Running…</p>";
  logEl.textContent = "";

  try {
    const settings = script === "guest" ? readGuestPayload() : readOldestPayload();
    const payload = { script, target, settings };
    const result = await fetchJson("/api/run", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    logEl.textContent = `${result.stderr || ""}${result.stdout || ""}`.trim() || "(no log)";

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

    latestSettings = await fetchJson("/api/settings");
    updateTokenStatus(latestSettings);
  } catch (error) {
    bodyEl.innerHTML = `<p class="token-status is-warn" style="max-width:none">${escapeHtml(
      error.message,
    )}</p>`;
  } finally {
    submit.disabled = false;
  }
}
