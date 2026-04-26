#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OUTPUT = "-";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CONCURRENCY = 6;
const MAIN_BOX_TITLE = "giant list of gds";
const NOTICE_INTRO = "most recently updated maps are at the top";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const MODES = ["osu", "taiko", "fruits", "mania"];
const STATUS_TAGS = {
  approved: { label: "Ranked", color: "#b7f36b" },
  graveyard: { label: "Graveyard", color: "#808080" },
  loved: { label: "Loved", color: "#ff75b7" },
  pending: { label: "Pending", color: "#ffd166" },
  ranked: { label: "Ranked", color: "#b7f36b" },
  wip: { label: "WIP", color: "#e8c0bc" },
};

function printHelp() {
  console.log(`Usage:
  node find-osu-guest-difficulties.mjs <osu-profile-url-or-user-id> [options]

Options:
  --output=./guest-difficulties.txt   BBCode file to write, or "-" for no file (BBCode only in --json). Default: ${DEFAULT_OUTPUT}
  --modes=osu,taiko,fruits,mania      Only include these modes. Default: all
  --sort=beatmap-id                   Sort: beatmap-id, difficulty-updated, set-date. Default: beatmap-id
  --page-size=100                     Beatmapsets per request. Default: ${DEFAULT_PAGE_SIZE}
  --concurrency=6                     Full detail requests to run at once. Default: ${DEFAULT_CONCURRENCY}
  --max-pages=0                       Stop after N pages. 0 = no limit
  --dry-run                           Print what would be written without changing the file
  --verbose                           Print pagination/detail logs instead of the progress bar
  --json                              Print a single JSON object to stdout (human summary to stderr)
  --line-template="{template}"        Custom BBCode for each difficulty
  --status-template="{template}"      Custom BBCode for the status tag
  --year-template="{template}"        Custom BBCode for year headers
  --wrapper-template="{template}"     Custom BBCode for the main box wrapper
  --notice-intro="text"               Text for {intro}; use empty string for none
  --year-section-template="{tpl}"     One year block: {year_header}, {entries}, {year}, {count}
  --help                              Show this help

Notes:
  For every status, set OSU_ACCESS_TOKEN to an osu! OAuth token for the
  target user. The script will use the authenticated all-status "mine" search.

  Without OSU_ACCESS_TOKEN, osu!'s public guest profile route is used instead.
  That public route currently returns ranked/loved guest beatmapsets only.

  The exporter keeps beatmaps whose mapper user_id matches the profile and
  whose beatmapset creator is someone else, then renders one spoiler box with
  bold year headings inside one notice box. Default --output=- writes no file;
  pass a path to also save BBCode to disk.
`);
}

function parseArgs(argv) {
  const options = {
    output: DEFAULT_OUTPUT,
    pageSize: DEFAULT_PAGE_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    maxPages: 0,
    modes: [...MODES],
    sort: "beatmap-id",
    dryRun: false,
    verbose: false,
    json: false,
    help: false,
    lineTemplate: null,
    statusTemplate: null,
    yearTemplate: null,
    wrapperTemplate: null,
    noticeIntro: null,
    yearSectionTemplate: null,
  };
  let target = null;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
      continue;
    }

    if (arg.startsWith("--page-size=")) {
      options.pageSize = Number.parseInt(arg.slice("--page-size=".length), 10);
      continue;
    }

    if (arg.startsWith("--concurrency=")) {
      options.concurrency = Number.parseInt(arg.slice("--concurrency=".length), 10);
      continue;
    }

    if (arg.startsWith("--max-pages=")) {
      options.maxPages = Number.parseInt(arg.slice("--max-pages=".length), 10);
      continue;
    }

    if (arg.startsWith("--modes=")) {
      options.modes = parseCsv(arg.slice("--modes=".length), MODES);
      continue;
    }

    if (arg.startsWith("--sort=")) {
      options.sort = arg.slice("--sort=".length).trim();
      continue;
    }

    if (arg.startsWith("--line-template=")) {
      options.lineTemplate = arg.slice("--line-template=".length);
      continue;
    }

    if (arg.startsWith("--status-template=")) {
      options.statusTemplate = arg.slice("--status-template=".length);
      continue;
    }

    if (arg.startsWith("--year-template=")) {
      options.yearTemplate = arg.slice("--year-template=".length);
      continue;
    }

    if (arg.startsWith("--wrapper-template=")) {
      options.wrapperTemplate = arg.slice("--wrapper-template=".length);
      continue;
    }

    if (arg.startsWith("--notice-intro=")) {
      options.noticeIntro = arg.slice("--notice-intro=".length);
      continue;
    }

    if (arg.startsWith("--year-section-template=")) {
      options.yearSectionTemplate = arg.slice("--year-section-template=".length);
      continue;
    }

    if (!target) {
      target = arg;
      continue;
    }

    throw new Error(`Unrecognized argument: ${arg}`);
  }

  validateOptions(options);
  return { target, options };
}

function parseCsv(value, allowed) {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.length === 0) {
    throw new Error(`Expected a comma-separated list. Allowed values: ${allowed.join(", ")}`);
  }

  const invalid = items.filter((item) => !allowed.includes(item));
  if (invalid.length > 0) {
    throw new Error(`Invalid values: ${invalid.join(", ")}. Allowed values: ${allowed.join(", ")}`);
  }

  return [...new Set(items)];
}

function validateOptions(options) {
  if (!Number.isInteger(options.pageSize) || options.pageSize <= 0) {
    throw new Error("--page-size must be a positive integer");
  }

  if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
    throw new Error("--concurrency must be a positive integer");
  }

  if (!Number.isInteger(options.maxPages) || options.maxPages < 0) {
    throw new Error("--max-pages must be 0 or a positive integer");
  }

  if (!["beatmap-id", "difficulty-updated", "set-date"].includes(options.sort)) {
    throw new Error("--sort must be one of: beatmap-id, difficulty-updated, set-date");
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": DEFAULT_USER_AGENT,
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status} ${response.statusText}) for ${url}`);
  }

  return {
    url: response.url,
    text: await response.text(),
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": DEFAULT_USER_AGENT,
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      "x-requested-with": "XMLHttpRequest",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status} ${response.statusText}) for ${url}`);
  }

  return response.json();
}

async function fetchApiJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      "user-agent": DEFAULT_USER_AGENT,
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status} ${response.statusText}) for ${url}`);
  }

  return response.json();
}

function extractUserId(value) {
  if (/^\d+$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/(?:users|u)\/(\d+)(?:\/|$)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function profileUrlFor(target) {
  if (/^\d+$/.test(target)) {
    return `https://osu.ppy.sh/users/${target}`;
  }

  try {
    return new URL(target).toString();
  } catch {
    return `https://osu.ppy.sh/users/${encodeURIComponent(target)}`;
  }
}

function extractTitle(html) {
  return decodeHtml(html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || "");
}

function extractUsernameFromTitle(title) {
  return title
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s*[·|].*$/u, "")
    .replace(/\s*osu!\s*$/iu, "")
    .trim() || null;
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
}

async function resolveUser(target) {
  const directId = extractUserId(target);
  const profileUrl = profileUrlFor(target);
  const profile = await fetchText(profileUrl);
  const title = extractTitle(profile.text);
  const resolvedId =
    directId ||
    extractUserId(profile.url) ||
    profile.text.match(/https:\/\/osu\.ppy\.sh\/users\/(\d+)(?:\/|["'<])/i)?.[1] ||
    profile.text.match(/"id":\s*(\d+)\s*,\s*"username"/)?.[1];

  if (!resolvedId) {
    throw new Error("Could not resolve a numeric osu! user id from the provided profile.");
  }

  return {
    id: resolvedId,
    requestedProfile: target,
    resolvedProfileUrl: profile.url,
    username: extractUsernameFromTitle(title),
    profileTitle: title,
  };
}

async function fetchGuestBeatmapsets(userId, options) {
  const beatmapsets = [];
  let offset = 0;
  let pages = 0;

  while (true) {
    if (options.maxPages > 0 && pages >= options.maxPages) {
      break;
    }

    const url = new URL(`https://osu.ppy.sh/users/${userId}/beatmapsets/guest`);
    url.searchParams.set("limit", String(options.pageSize));
    url.searchParams.set("offset", String(offset));

    const batch = await fetchJson(url.toString());
    if (!Array.isArray(batch)) {
      throw new Error(`Unexpected response shape for ${url}`);
    }

    pages += 1;
    if (options.verbose) {
      console.error(`[scan] guest beatmapsets page ${pages} offset ${offset}: ${batch.length} set(s)`);
    }

    beatmapsets.push(...batch);
    if (batch.length < options.pageSize) {
      break;
    }

    offset += options.pageSize;
  }

  return { beatmapsets, pages };
}

async function fetchAllStatusBeatmapsetsFromApi(userId, options, accessToken) {
  const tokenUser = await fetchApiJson("https://osu.ppy.sh/api/v2/me", accessToken);
  const tokenUserId = tokenUser?.id == null ? null : String(tokenUser.id);

  if (tokenUserId !== String(userId)) {
    return {
      beatmapsets: [],
      pages: 0,
      source: "api-mine",
      warnings: [
        `OSU_ACCESS_TOKEN belongs to user #${tokenUserId || "unknown"}, not target #${userId}. Falling back to the public ranked/loved guest route.`,
      ],
    };
  }

  const beatmapsets = [];
  let cursorString = null;
  let pages = 0;

  while (true) {
    if (options.maxPages > 0 && pages >= options.maxPages) {
      break;
    }

    const url = new URL("https://osu.ppy.sh/api/v2/beatmapsets/search");
    url.searchParams.set("s", "mine");
    url.searchParams.set("nsfw", "true");
    if (cursorString) {
      url.searchParams.set("cursor_string", cursorString);
    }

    const data = await fetchApiJson(url.toString(), accessToken);
    const batch = data.beatmapsets;
    if (!Array.isArray(batch)) {
      throw new Error(`Unexpected response shape for ${url}`);
    }

    pages += 1;
    if (options.verbose) {
      console.error(`[scan] authenticated mine search page ${pages}: ${batch.length} set(s)`);
    }

    beatmapsets.push(...batch);
    cursorString = data.cursor_string || null;

    if (batch.length === 0 || !cursorString) {
      break;
    }
  }

  return {
    beatmapsets,
    pages,
    source: "api-mine",
    warnings: [],
  };
}

async function fetchAvailableBeatmapsets(userId, options) {
  const accessToken = process.env.OSU_ACCESS_TOKEN?.trim();

  if (accessToken) {
    let apiScan;
    try {
      apiScan = await fetchAllStatusBeatmapsetsFromApi(userId, options, accessToken);
    } catch (error) {
      const publicScan = await fetchGuestBeatmapsets(userId, options);
      return {
        ...publicScan,
        source: "public-guest",
        warnings: [
          `OSU_ACCESS_TOKEN could not be used (${error.message}). Falling back to the public ranked/loved guest route.`,
          "Public fallback can only see ranked/loved guest beatmapsets.",
        ],
      };
    }

    if (apiScan.beatmapsets.length > 0 || apiScan.warnings.length === 0) {
      return apiScan;
    }

    const publicScan = await fetchGuestBeatmapsets(userId, options);
    return {
      ...publicScan,
      source: "public-guest",
      warnings: [
        ...apiScan.warnings,
        "Public fallback can only see ranked/loved guest beatmapsets.",
      ],
    };
  }

  const publicScan = await fetchGuestBeatmapsets(userId, options);
  return {
    ...publicScan,
    source: "public-guest",
    warnings: [
      "OSU_ACCESS_TOKEN is not set; public osu! guest profiles currently expose ranked/loved guest beatmapsets only.",
    ],
  };
}

async function fetchBeatmapsetDetail(beatmapsetId, accessToken) {
  if (accessToken) {
    return fetchApiJson(`https://osu.ppy.sh/api/v2/beatmapsets/${beatmapsetId}`, accessToken);
  }

  const page = await fetchText(`https://osu.ppy.sh/beatmapsets/${beatmapsetId}`);
  const json = page.text.match(
    /<script\s+id=["']json-beatmapset["']\s+type=["']application\/json["']>\s*([\s\S]*?)\s*<\/script>/i,
  )?.[1];

  if (!json) {
    throw new Error(`Could not find embedded beatmapset JSON for ${beatmapsetId}`);
  }

  return JSON.parse(json.trim());
}

function shouldShowProgress(options, total) {
  return total > 1 && !options.verbose;
}

function renderProgressBar(label, done, total, { force = false } = {}) {
  if (total <= 0) {
    return;
  }

  const width = 24;
  const filled = Math.round((done / total) * width);
  const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
  const message = `${label} [${bar}] ${done}/${total}`;

  if (process.stderr.isTTY) {
    process.stderr.write(`\r${message}`);

    if (done >= total) {
      process.stderr.write("\n");
    }

    return;
  }

  const interval = Math.max(1, Math.ceil(total / 10));
  if (force || done === 0 || done >= total || done % interval === 0) {
    console.error(message);
  }
}

async function enrichBeatmapsetsWithDetails(scan, options) {
  const accessToken = process.env.OSU_ACCESS_TOKEN?.trim();
  const total = scan.beatmapsets.length;
  const enriched = new Array(total);
  const warnings = [...(scan.warnings || [])];
  const progress = shouldShowProgress(options, total);
  let detailsFetched = 0;
  let completed = 0;
  let nextIndex = 0;

  if (progress) {
    renderProgressBar("Fetching details", completed, total, { force: true });
  }

  async function worker() {
    while (nextIndex < total) {
      const index = nextIndex;
      nextIndex += 1;
      const beatmapset = scan.beatmapsets[index];

      try {
        const detailed = await fetchBeatmapsetDetail(beatmapset.id, accessToken);
        enriched[index] = hasUsefulBeatmaps(detailed) ? detailed : beatmapset;
        detailsFetched += 1;

        if (options.verbose) {
          console.error(`[detail] beatmapset ${beatmapset.id}: ok`);
        }
      } catch (error) {
        enriched[index] = beatmapset;
        warnings.push(`Could not fetch full details for beatmapset ${beatmapset.id}: ${error.message}`);

        if (options.verbose) {
          console.error(`[detail] beatmapset ${beatmapset.id}: ${error.message}`);
        }
      }

      completed += 1;

      if (progress) {
        renderProgressBar("Fetching details", completed, total);
      }
    }
  }

  const workerCount = Math.min(options.concurrency, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    ...scan,
    beatmapsets: enriched,
    warnings,
    detailsFetched,
  };
}

function hasUsefulBeatmaps(beatmapset) {
  return Array.isArray(beatmapset?.beatmaps) && beatmapset.beatmaps.length > 0;
}

function collectGuestDifficulties(beatmapsets, user, options) {
  const userId = String(user.id);
  const allowedModes = new Set(options.modes);
  const seenBeatmaps = new Set();
  const difficulties = [];

  for (const beatmapset of beatmapsets) {
    const setOwnerId = beatmapset.user_id == null ? null : String(beatmapset.user_id);

    for (const beatmap of beatmapset.beatmaps || []) {
      const beatmapOwnerIds = ownerIdsForBeatmap(beatmap);
      const isMappedByUser = beatmapOwnerIds.includes(userId);
      const isInOtherUsersSet = !setOwnerId || setOwnerId !== userId;

      if (!isMappedByUser || !isInOtherUsersSet) {
        continue;
      }

      if (!allowedModes.has(beatmap.mode)) {
        continue;
      }

      if (seenBeatmaps.has(String(beatmap.id))) {
        continue;
      }
      seenBeatmaps.add(String(beatmap.id));

      const difficultyUpdatedAt = beatmap.last_updated || null;
      const setDate = beatmapset.ranked_date || beatmapset.submitted_date || beatmapset.last_updated || null;
      difficulties.push({
        artist: beatmapset.artist || beatmapset.artist_unicode || "Unknown Artist",
        title: beatmapset.title || beatmapset.title_unicode || "Unknown Title",
        creator: beatmapset.creator || null,
        beatmapsetId: beatmapset.id,
        beatmapId: beatmap.id,
        mode: beatmap.mode,
        status: beatmapset.status || beatmap.status || null,
        version: beatmap.version || "Unknown difficulty",
        difficultyUpdatedAt,
        setDate,
        date: difficultyUpdatedAt || setDate,
        year: yearForDate(difficultyUpdatedAt || setDate),
        url: `https://osu.ppy.sh/beatmapsets/${beatmapset.id}#${beatmap.mode}/${beatmap.id}`,
      });
    }
  }

  return difficulties.sort((a, b) => compareDifficulties(a, b, options.sort));
}

function ownerIdsForBeatmap(beatmap) {
  const ids = [];

  if (beatmap.user_id != null) {
    ids.push(String(beatmap.user_id));
  }

  if (beatmap.owner_id != null) {
    ids.push(String(beatmap.owner_id));
  }

  for (const owner of beatmap.owners || []) {
    if (owner?.id != null) {
      ids.push(String(owner.id));
    }
  }

  return [...new Set(ids)];
}

function yearForDate(value) {
  if (!value) {
    return String(new Date().getUTCFullYear());
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(new Date().getUTCFullYear());
  }

  return String(date.getUTCFullYear());
}

function compareDifficulties(a, b, sort) {
  if (sort === "beatmap-id") {
    return String(b.beatmapId).localeCompare(String(a.beatmapId), undefined, { numeric: true });
  }

  const dateKey = sort === "set-date" ? "setDate" : "difficultyUpdatedAt";
  const aDate = a[dateKey] || a.date;
  const bDate = b[dateKey] || b.date;
  const aTime = aDate ? new Date(aDate).getTime() : 0;
  const bTime = bDate ? new Date(bDate).getTime() : 0;

  if (aTime !== bTime) {
    return bTime - aTime;
  }

  return String(b.beatmapId).localeCompare(String(a.beatmapId), undefined, { numeric: true });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readExistingOutput(filePath) {
  if (!(await fileExists(filePath))) {
    return "";
  }

  return readFile(filePath, "utf8");
}

function findExistingBeatmapIds(text) {
  const ids = new Set();

  for (const match of text.matchAll(/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/gi)) {
    ids.add(match[1]);
  }

  for (const match of text.matchAll(/beatmaps\/(\d+)/gi)) {
    ids.add(match[1]);
  }

  return ids;
}

function groupByYear(difficulties) {
  const byYear = new Map();

  for (const difficulty of difficulties) {
    if (!byYear.has(difficulty.year)) {
      byYear.set(difficulty.year, []);
    }
    byYear.get(difficulty.year).push(difficulty);
  }

  return [...byYear.entries()].sort(([a], [b]) => Number(b) - Number(a));
}

function formatDifficulty(difficulty, options = {}) {
  const statusTag = formatStatusTag(difficulty.status, options);
  const template =
    options.lineTemplate ||
    "[url={url}]{artist} - {title} ({version})[/url][size=85][color={status_color}]({status_label})[/color][/size]";
  const tag = STATUS_TAGS[String(difficulty.status || "").toLowerCase()];
  
  return template
    .replace(/{url}/g, difficulty.url)
    .replace(/{artist}/g, difficulty.artist)
    .replace(/{title}/g, difficulty.title)
    .replace(/{version}/g, difficulty.version)
    .replace(/{status_color}/g, tag?.color || "#808080")
    .replace(/{status_label}/g, tag?.label || difficulty.status || "Unknown")
    .replace(/{status}/g, statusTag || "");
}

function formatStatusTag(status, options = {}) {
  const tag = STATUS_TAGS[String(status || "").toLowerCase()];
  if (!tag) return null;

  const template = options.statusTemplate || " [size=85][color={color}]({label})[/color][/size]";
  return template
    .replace(/{color}/g, tag.color)
    .replace(/{label}/g, tag.label);
}

function refreshExistingEntries(existingText, difficulties, options) {
  const difficultyByBeatmapId = new Map(
    difficulties.map((difficulty) => [String(difficulty.beatmapId), difficulty]),
  );
  let updated = 0;
  const text = existingText.replace(
    /(?:\[b\])?(\[url=https:\/\/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)\][\s\S]*?\[\/url\](?:\s*(?:-|[|])\s*\[size=85\][\s\S]*?\[\/size\])?)(?:\[\/b\])?/gi,
    (match, _entry, beatmapId) => {
      const difficulty = difficultyByBeatmapId.get(String(beatmapId));
      if (!difficulty) {
        const normalized = normalizeEntryLine(match);
        if (normalized !== match) {
          updated += 1;
        }
        return normalized;
      }

      const replacement = formatDifficulty(difficulty, options);
      if (replacement !== match) {
        updated += 1;
      }
      return replacement;
    },
  );

  return { text, updated };
}

function normalizeItemSpacing(existingText) {
  let updated = 0;
  const text = existingText.replace(
    /\[notice\]([\s\S]*?)\[\/notice\]/g,
    (match, body) => {
      const normalizedBody = body
        .replace(/(\[\/b\])(?:[ \t]*\r?\n){2,}(\[b\]?\[url=)/g, "$1\n$2")
        .replace(/(\[\/size\])(?:[ \t]*\r?\n){2,}(\[b\]?\[url=)/g, "$1\n$2")
        .replace(/(\[\/url\])(?:[ \t]*\r?\n){2,}(\[b\]?\[url=)/g, "$1\n$2");

      if (normalizedBody !== body) {
        updated += 1;
      }

      return `[notice]${normalizedBody}[/notice]`;
    },
  );

  return { text, updated };
}

function renderMergedOutput(existingText, newDifficulties, options, user) {
  const existing = extractExistingOutput(existingText);

  for (const difficulty of newDifficulties) {
    addEntry(existing.entriesByYear, difficulty.year, formatDifficulty(difficulty, options));
  }

  const totalEntries = [...existing.entriesByYear.values()].reduce((sum, entries) => sum + entries.length, 0);
  if (totalEntries === 0) {
    return `${existingText.trimEnd()}\n`;
  }

  const mainBox = renderMainBox(existing.entriesByYear, totalEntries, options, user);
  const preface = existing.preface.trimEnd();
  const suffix = existing.suffix.trim();

  return [
    preface,
    mainBox,
    suffix,
  ].filter(Boolean).join("\n\n") + "\n";
}

function renderFreshOutput(difficulties, options, user) {
  const entriesByYear = new Map();

  for (const difficulty of difficulties) {
    addEntry(entriesByYear, difficulty.year, formatDifficulty(difficulty, options));
  }

  const totalEntries = difficulties.length;
  if (totalEntries === 0) {
    return "";
  }

  return `${renderMainBox(entriesByYear, totalEntries, options, user)}
`;
}

function extractExistingOutput(text) {
  const entriesByYear = new Map();
  const boxMatches = [...text.matchAll(/\[box=([^\]]+)\]([\s\S]*?)\[\/box\]/g)];
  let firstBoxIndex = null;
  let lastBoxEnd = null;

  for (const match of boxMatches) {
    firstBoxIndex ??= match.index;
    lastBoxEnd = match.index + match[0].length;

    const title = match[1].trim();
    const body = match[2];
    const legacyYear = title.match(/^(\d{4})(?:\s*-\s*\d+)?$/)?.[1] ?? null;

    if (legacyYear) {
      for (const entry of extractEntryLines(body)) {
        addEntry(entriesByYear, legacyYear, entry);
      }
      continue;
    }

    parseSingleBoxBody(body, entriesByYear);
  }

  if (boxMatches.length === 0) {
    parseSingleBoxBody(text, entriesByYear);
  }

  return {
    entriesByYear,
    preface: firstBoxIndex == null ? text : text.slice(0, firstBoxIndex),
    suffix: lastBoxEnd == null ? "" : text.slice(lastBoxEnd),
  };
}

function parseSingleBoxBody(body, entriesByYear) {
  const noticeBody = body.match(/\[notice\]([\s\S]*?)\[\/notice\]/i)?.[1] ?? body;
  let currentYear = null;

  for (const rawLine of noticeBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const yearMatch =
      line.match(/^\[b\](\d{4})(?:\s*-\s*\d+)?\[\/b\]$/i) ||
      line.match(/^(\d{4})(?:\s*-\s*\d+)?$/);
    if (yearMatch) {
      currentYear = yearMatch[1];
      continue;
    }

    if (line.includes("[url=https://osu.ppy.sh/beatmapsets/")) {
      addEntry(entriesByYear, currentYear ?? String(new Date().getUTCFullYear()), normalizeEntryLine(line));
    }
  }
}

function extractEntryLines(body) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("[url=https://osu.ppy.sh/beatmapsets/"))
    .map(normalizeEntryLine);
}

function normalizeEntryLine(line) {
  return line
    .replace(/^\[b\]/i, "")
    .replace(/\[\/b\]$/i, "")
    .replace(/\s+[|]\s+(\[size=85\])/i, " - $1");
}

function addEntry(entriesByYear, year, entry) {
  if (!entriesByYear.has(year)) {
    entriesByYear.set(year, []);
  }

  const entries = entriesByYear.get(year);
  if (!entries.includes(entry)) {
    entries.push(entry);
  }
}

function effectiveNoticeIntro(options) {
  if (Object.prototype.hasOwnProperty.call(options, "noticeIntro") && options.noticeIntro != null) {
    return options.noticeIntro;
  }
  return NOTICE_INTRO;
}

function renderMainBox(entriesByYear, totalEntries, options = {}, user = {}) {
  const yearTemplate = options.yearTemplate || "[b]{year} - {count}[/b]";
  const yearSectionTemplate =
    options.yearSectionTemplate || "{year_header}\n{entries}";

  const sections = [...entriesByYear.entries()]
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([year, entries]) => {
      const yearHeader = yearTemplate
        .replace(/{year}/g, year)
        .replace(/{count}/g, String(entries.length));
      const entriesText = entries.join("\n");
      return yearSectionTemplate
        .replace(/{year_header}/g, yearHeader)
        .replace(/{entries}/g, entriesText)
        .replace(/{year}/g, year)
        .replace(/{count}/g, String(entries.length));
    });

  const wrapperTemplate =
    options.wrapperTemplate ||
    "[box=giant list of gds - {total}]\n[notice]\n{intro}\n{sections}\n\n[/notice]\n[/box]";

  const username = user.username || "";
  const userId = user.id != null ? String(user.id) : "";

  return wrapperTemplate
    .replace(/{title}/g, MAIN_BOX_TITLE)
    .replace(/{total}/g, String(totalEntries))
    .replace(/{intro}/g, effectiveNoticeIntro(options))
    .replace(/{sections}/g, sections.join("\n\n"))
    .replace(/{username}/g, username)
    .replace(/{user_id}/g, userId);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function saveOutput(filePath, text) {
  const directory = path.dirname(path.resolve(filePath));
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, text, "utf8");
}

function buildStructuredGuestResult(
  user,
  options,
  scan,
  allDifficulties,
  newDifficulties,
  updatedExistingCount,
  outputChanged,
  fileWritten,
  spacedText,
  summaryMessage,
) {
  return {
    type: "guest-difficulties",
    user: {
      id: user.id,
      username: user.username || null,
      profileUrl: user.resolvedProfileUrl,
    },
    scan: {
      source: scan.source === "api-mine" ? "api-mine" : "public-guest",
      pages: scan.pages,
      detailsFetched: scan.detailsFetched ?? 0,
      warnings: scan.warnings || [],
    },
    counts: {
      guestDifficulties: allDifficulties.length,
      existingUpdated: updatedExistingCount,
      newCount: newDifficulties.length,
      outputLayoutChanged: outputChanged,
    },
    newDifficulties: newDifficulties.map((d) => ({
      year: d.year,
      artist: d.artist,
      title: d.title,
      version: d.version,
      url: d.url,
      beatmapId: d.beatmapId,
    })),
    dryRun: options.dryRun,
    fileWritten,
    outputPath: options.output,
    outputBbcode: spacedText || "",
    message: summaryMessage || null,
  };
}

function printSummary(user, options, scan, allDifficulties, newDifficulties, updatedExistingCount, outputChanged) {
  const out = options.json ? console.error : console.log;

  out(`User: ${user.username || "unknown"} (#${user.id})`);
  out(`Profile: ${user.resolvedProfileUrl}`);
  out(`Source: ${scan.source === "api-mine" ? "authenticated all-status mine search" : "public ranked/loved guest feed"}`);
  out(`Scanned beatmapsets: ${scan.beatmapsets.length} across ${scan.pages} page(s)`);
  out(`Full beatmapset details fetched: ${scan.detailsFetched ?? 0}`);
  out(`Guest difficulties found: ${allDifficulties.length}`);
  out(`Existing entries updated: ${updatedExistingCount}`);
  out(`Output layout changed: ${outputChanged ? "yes" : "no"}`);
  out(`New entries to add: ${newDifficulties.length}`);
  out(`Output: ${options.output}`);

  for (const warning of scan.warnings || []) {
    out(`Warning: ${warning}`);
  }

  if (newDifficulties.length > 0) {
    out("");
    for (const difficulty of newDifficulties) {
      out(`${difficulty.year}: ${difficulty.artist} - ${difficulty.title} (${difficulty.version})`);
      out(`  ${difficulty.url}`);
    }
  }
}

async function main() {
  const { target, options } = parseArgs(process.argv.slice(2));

  if (options.help || !target) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const user = await resolveUser(target);
  const scan = await enrichBeatmapsetsWithDetails(
    await fetchAvailableBeatmapsets(user.id, options),
    options,
  );
  const allDifficulties = collectGuestDifficulties(scan.beatmapsets, user, options);
  const freshText = renderFreshOutput(allDifficulties, options, user);
  const spaced = normalizeItemSpacing(freshText);
  const outputChanged = true;
  const rewrittenDifficulties = allDifficulties;

  printSummary(user, options, scan, allDifficulties, rewrittenDifficulties, 0, outputChanged);

  const out = options.json ? console.error : console.log;
  let fileWritten = false;
  let summaryMessage = "";

  if (options.dryRun) {
    summaryMessage = "Dry run only; fresh output file was not written.";
    out("");
    out(summaryMessage);
  } else if (options.output === "-") {
    summaryMessage = "Output path is "-"; fresh BBCode is included in JSON only (no file written).";
    out("");
    out(summaryMessage);
  } else {
    await saveOutput(options.output, spaced.text);
    fileWritten = true;
    summaryMessage = `Wrote fresh output with ${allDifficulties.length} guest difficult${allDifficulties.length === 1 ? "y" : "ies"} to ${options.output}`;
    out("");
    out(summaryMessage);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        buildStructuredGuestResult(
          user,
          options,
          scan,
          allDifficulties,
          rewrittenDifficulties,
          0,
          outputChanged,
          fileWritten,
          spaced.text,
          summaryMessage,
        ),
      ),
    );
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
