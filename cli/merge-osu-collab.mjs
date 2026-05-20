#!/usr/bin/env node

import path from "node:path";
import {
  activeUninheritedPoint,
  bpmFromBeatLength,
  defaultOutputPath,
  formatBookmarks,
  formatTime,
  getSectionLines,
  getSectionValue,
  parseBookmarks,
  parseBreakLine,
  parseHitObjectLine,
  parseTimingPointLine,
  parseTimingPoints,
  readOsuFile,
  serializeOsuFile,
  setSectionLines,
  setSectionValue,
  shiftBreakLine,
  shiftHitObjectLine,
  timingPointToLine,
  writeTextFile,
} from "../lib/osu-file.mjs";

const MERGE_SECTIONS = ["hitobjects", "timing", "breaks", "bookmarks"];
const DEFAULT_MERGE_SECTIONS = ["hitobjects", "timing"];

function printHelp() {
  console.log(`Usage:
  node cli/merge-osu-collab.mjs <base.osu> <guest1.osu> [guest2.osu ...] [options]

Options:
  --output=merged.osu                 File to write. Default: <base>-merged.osu
  --merge=hitobjects,timing,breaks    Sections to merge. Default: hitobjects,timing
  --offset-guest1=1200                Shift the first guest by milliseconds
  --offset-<guest-file-stem>=1200     Shift a guest by file name, e.g. --offset-guest1=1200
  --source-labels                     Add comments showing which guest contributed merged lines
  --keep-base-metadata                Keep base metadata. This is the default because base.osu is the output shell
  --dedupe-timing-points              Drop duplicate timing point rows after offsets
  --dry-run                           Print the summary without writing output
  --help                              Show this help
`);
}

function parseArgs(argv) {
  const options = {
    output: null,
    merge: new Set(DEFAULT_MERGE_SECTIONS),
    offsets: new Map(),
    sourceLabels: false,
    keepBaseMetadata: true,
    dedupeTimingPoints: false,
    dryRun: false,
    json: false,
    help: false,
  };
  const files = [];

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--source-labels") {
      options.sourceLabels = true;
      continue;
    }
    if (arg === "--keep-base-metadata") {
      options.keepBaseMetadata = true;
      continue;
    }
    if (arg === "--dedupe-timing-points") {
      options.dedupeTimingPoints = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
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
    if (arg.startsWith("--merge=")) {
      options.merge = parseMergeSections(arg.slice("--merge=".length));
      continue;
    }
    if (arg.startsWith("--offset-")) {
      const separator = arg.indexOf("=");
      if (separator === -1) {
        throw new Error("Offset options must look like --offset-guest1=1200");
      }
      const key = arg.slice("--offset-".length, separator).trim().toLowerCase();
      const value = Number.parseFloat(arg.slice(separator + 1));
      if (!key || !Number.isFinite(value)) {
        throw new Error(`Invalid offset option: ${arg}`);
      }
      options.offsets.set(key, value);
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
    files.push(arg);
  }

  return { files, options };
}

function parseMergeSections(value) {
  const items = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error("--merge must include at least one section");
  }

  const invalid = items.filter((item) => !MERGE_SECTIONS.includes(item));
  if (invalid.length > 0) {
    throw new Error(`Invalid --merge value(s): ${invalid.join(", ")}. Allowed: ${MERGE_SECTIONS.join(", ")}`);
  }

  return new Set(items);
}

function sourceName(filePath) {
  return path.basename(filePath);
}

function sourceStem(filePath) {
  return path.parse(filePath).name.toLowerCase();
}

function offsetForGuest(guest, index, options) {
  const aliases = [
    `guest${index + 1}`,
    sourceStem(guest.filePath),
    sourceName(guest.filePath).toLowerCase(),
  ];

  for (const alias of aliases) {
    if (options.offsets.has(alias)) {
      return options.offsets.get(alias);
    }
  }

  return 0;
}

function appendWithOptionalLabel(lines, label, nextLines, options) {
  if (nextLines.length === 0) {
    return;
  }
  if (options.sourceLabels) {
    lines.push(`// merged from ${label}`);
  }
  lines.push(...nextLines);
}

function mergeHitObjects(baseFile, guests, options, stats) {
  const lines = [...getSectionLines(baseFile, "HitObjects")];

  for (const guest of guests) {
    const label = sourceName(guest.filePath);
    let added = 0;
    const guestLines = [];

    for (const line of getSectionLines(guest, "HitObjects")) {
      const shifted = shiftHitObjectLine(line, guest.offset);
      const object = parseHitObjectLine(shifted);
      if (object) {
        added += 1;
      }
      if (shifted.trim()) {
        guestLines.push(shifted);
      }
    }

    stats.get(guest.filePath).hitobjects = added;
    appendWithOptionalLabel(lines, label, guestLines, options);
  }

  setSectionLines(baseFile, "HitObjects", lines);
}

function timingDedupeKey(line) {
  const point = parseTimingPointLine(line);
  return point ? point.parts.map((part) => part.trim()).join(",") : line.trim();
}

function shiftedTimingPoint(line, offset) {
  const point = parseTimingPointLine(line);
  if (!point) {
    return null;
  }
  const next = {
    ...point,
    parts: [...point.parts],
    time: point.time + offset,
  };
  return {
    ...next,
    line: timingPointToLine(next),
  };
}

function mergeTimingPoints(baseFile, guests, options, stats, warnings) {
  const lines = [...getSectionLines(baseFile, "TimingPoints")];
  const seen = new Set();
  const baseTiming = parseTimingPoints(baseFile).sort((a, b) => a.time - b.time);

  if (options.dedupeTimingPoints) {
    for (const line of lines) {
      seen.add(timingDedupeKey(line));
    }
  }

  for (const guest of guests) {
    const label = sourceName(guest.filePath);
    let added = 0;
    let duplicate = 0;
    const guestLines = [];

    for (const line of getSectionLines(guest, "TimingPoints")) {
      const point = shiftedTimingPoint(line, guest.offset);
      if (!point) {
        if (line.trim()) {
          guestLines.push(line);
        }
        continue;
      }

      if (options.dedupeTimingPoints) {
        const key = timingDedupeKey(point.line);
        if (seen.has(key)) {
          duplicate += 1;
          continue;
        }
        seen.add(key);
      }

      warnForBpmConflict(baseTiming, point, label, warnings);
      added += 1;
      guestLines.push(point.line);
    }

    stats.get(guest.filePath).timing = added;
    stats.get(guest.filePath).timingDuplicates = duplicate;
    appendWithOptionalLabel(lines, label, guestLines, options);
  }

  setSectionLines(baseFile, "TimingPoints", lines);
}

function warnForBpmConflict(baseTiming, point, label, warnings) {
  if (!point.uninherited || point.beatLength <= 0 || warnings.length >= 12) {
    return;
  }

  const active = activeUninheritedPoint(baseTiming, point.time);
  if (!active?.beatLength) {
    return;
  }

  const guestBpm = bpmFromBeatLength(point.beatLength);
  const baseBpm = bpmFromBeatLength(active.beatLength);
  if (Math.abs(guestBpm - baseBpm) > 0.01) {
    warnings.push(
      `${label} has uninherited timing point at ${formatTime(point.time)} (${guestBpm.toFixed(3)} BPM) that conflicts with base BPM ${baseBpm.toFixed(3)}`,
    );
  }
}

function mergeBreaks(baseFile, guests, options, stats) {
  const nextEvents = [...getSectionLines(baseFile, "Events")];

  for (const guest of guests) {
    const label = sourceName(guest.filePath);
    const breakLines = getSectionLines(guest, "Events")
      .map((line) => shiftBreakLine(line, guest.offset))
      .filter((line) => parseBreakLine(line));

    stats.get(guest.filePath).breaks = breakLines.length;
    if (breakLines.length === 0) {
      continue;
    }

    if (options.sourceLabels) {
      nextEvents.push(`// merged breaks from ${label}`);
    }
    nextEvents.push(...breakLines);
  }

  setSectionLines(baseFile, "Events", nextEvents);
}

function mergeBookmarks(baseFile, guests, stats) {
  const bookmarks = [...parseBookmarks(baseFile)];

  for (const guest of guests) {
    const guestBookmarks = parseBookmarks(guest).map((bookmark) => bookmark + guest.offset);
    stats.get(guest.filePath).bookmarks = guestBookmarks.length;
    bookmarks.push(...guestBookmarks);
  }

  setSectionValue(baseFile, "Editor", "Bookmarks", formatBookmarks(bookmarks));
}

function warnForAudioMismatch(baseFile, guests, warnings) {
  const baseAudio = getSectionValue(baseFile, "General", "AudioFilename");
  if (!baseAudio) {
    return;
  }

  for (const guest of guests) {
    const guestAudio = getSectionValue(guest, "General", "AudioFilename");
    if (guestAudio && guestAudio !== baseAudio) {
      warnings.push(`${sourceName(guest.filePath)} has different audio filename (${guestAudio})`);
    }
  }
}

function makeStats(guests) {
  return new Map(
    guests.map((guest) => [
      guest.filePath,
      {
        hitobjects: 0,
        timing: 0,
        timingDuplicates: 0,
        breaks: 0,
        bookmarks: 0,
      },
    ]),
  );
}

function printSummary(guests, stats, warnings, options, output) {
  const out = options.json ? console.error : console.log;
  for (const guest of guests) {
    const item = stats.get(guest.filePath);
    const parts = [];
    if (options.merge.has("hitobjects")) {
      parts.push(`+${item.hitobjects} hitobjects`);
    }
    if (options.merge.has("timing")) {
      parts.push(`+${item.timing} timing points`);
      if (item.timingDuplicates > 0) {
        parts.push(`${item.timingDuplicates} duplicate timing point${item.timingDuplicates === 1 ? "" : "s"} skipped`);
      }
    }
    if (options.merge.has("breaks")) {
      parts.push(`+${item.breaks} breaks`);
    }
    if (options.merge.has("bookmarks")) {
      parts.push(`+${item.bookmarks} bookmarks`);
    }
    const offset = guest.offset ? ` (offset ${guest.offset}ms)` : "";
    out(`${sourceName(guest.filePath)}:${offset} ${parts.join(", ") || "no selected sections"}`);
  }

  if (warnings.length > 0) {
    out("warnings:");
    for (const warning of warnings) {
      out(`- ${warning}`);
    }
  }

  out(`output: ${output}${options.dryRun ? " (dry run, not written)" : ""}`);
}

function buildStructuredResult(basePath, guests, stats, warnings, options, output) {
  return {
    type: "osu-collab-merge",
    basePath,
    outputPath: output,
    dryRun: options.dryRun,
    merge: [...options.merge],
    sourceLabels: options.sourceLabels,
    dedupeTimingPoints: options.dedupeTimingPoints,
    guests: guests.map((guest) => ({
      path: guest.filePath,
      name: sourceName(guest.filePath),
      offset: guest.offset,
      added: stats.get(guest.filePath),
    })),
    warnings,
  };
}

async function main() {
  const { files, options } = parseArgs(process.argv.slice(2));
  if (options.help || files.length < 2) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const [basePath, ...guestPaths] = files;
  const output = options.output || defaultOutputPath(basePath, "-merged");
  const baseFile = await readOsuFile(basePath);
  const guests = await Promise.all(guestPaths.map((guestPath) => readOsuFile(guestPath)));

  guests.forEach((guest, index) => {
    guest.offset = offsetForGuest(guest, index, options);
  });

  const stats = makeStats(guests);
  const warnings = [];
  warnForAudioMismatch(baseFile, guests, warnings);

  if (options.merge.has("hitobjects")) {
    mergeHitObjects(baseFile, guests, options, stats);
  }
  if (options.merge.has("timing")) {
    mergeTimingPoints(baseFile, guests, options, stats, warnings);
  }
  if (options.merge.has("breaks")) {
    mergeBreaks(baseFile, guests, options, stats);
  }
  if (options.merge.has("bookmarks")) {
    mergeBookmarks(baseFile, guests, stats);
  }

  printSummary(guests, stats, warnings, options, output);

  if (!options.dryRun) {
    await writeTextFile(output, serializeOsuFile(baseFile));
  }

  if (options.json) {
    console.log(JSON.stringify(buildStructuredResult(basePath, guests, stats, warnings, options, output)));
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
