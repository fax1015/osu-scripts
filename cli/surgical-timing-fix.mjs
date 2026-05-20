#!/usr/bin/env node

import {
  activeUninheritedPoint,
  defaultOutputPath,
  parseTimingPointLine,
  parseTimingPoints,
  readOsuFile,
  serializeOsuFile,
  setSectionLines,
  timingPointSort,
  timingPointToLine,
  writeTextFile,
} from "../lib/osu-file.mjs";

function printHelp() {
  console.log(`Usage:
  node cli/surgical-timing-fix.mjs <base.osu> <target.osu> [options]

Options:
  --output=fixed.osu        File to write. Default: <target>-surgical.osu
  --dry-run                 Print the summary without writing output
  --json                    Print structured JSON
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const options = {
    output: null,
    dryRun: false,
    json: false,
    help: false,
  };
  const inputs = [];

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
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
    if (arg.startsWith("-")) {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
    inputs.push(arg);
  }

  if (!options.help && inputs.length !== 2) {
    throw new Error("Pass a base .osu file and a target .osu file.");
  }

  return {
    basePath: inputs[0] || null,
    targetPath: inputs[1] || null,
    options,
  };
}

function timingComments(file) {
  const lines = [];
  let inTiming = false;

  for (const line of file.lines) {
    const section = line.trim().match(/^\[([^\]]+)\]$/)?.[1]?.toLowerCase();
    if (section) {
      if (inTiming) {
        break;
      }
      inTiming = section === "timingpoints";
      continue;
    }
    if (inTiming && !parseTimingPointLine(line)) {
      if (line.trim()) {
        lines.push(line);
      }
    }
  }

  return lines;
}

function sortedTimingLines(points, comments = []) {
  return [
    ...comments,
    ...points
      .map((point, order) => ({ ...point, order }))
      .sort(timingPointSort)
      .map((point) => timingPointToLine(point)),
  ];
}

function adjustedInheritedPoint(point, oldUninherited, newUninherited) {
  if (!oldUninherited?.beatLength || !newUninherited?.beatLength) {
    return null;
  }
  if (oldUninherited.beatLength <= 0 || newUninherited.beatLength <= 0) {
    return null;
  }

  const next = {
    ...point,
    parts: [...point.parts],
  };
  next.beatLength = point.beatLength * (oldUninherited.beatLength / newUninherited.beatLength);
  return next;
}

function surgicalTimingFix(baseFile, targetFile) {
  const basePoints = parseTimingPoints(baseFile);
  const targetPoints = parseTimingPoints(targetFile);
  const baseUninherited = basePoints
    .filter((point) => point.uninherited && point.beatLength > 0)
    .sort((a, b) => a.time - b.time);
  const targetUninherited = targetPoints
    .filter((point) => point.uninherited && point.beatLength > 0)
    .sort((a, b) => a.time - b.time);
  const targetInherited = targetPoints.filter((point) => !point.uninherited);

  if (baseUninherited.length === 0) {
    throw new Error("Base map has no uninherited BPM timing points to copy.");
  }
  if (targetUninherited.length === 0) {
    throw new Error("Target map has no uninherited BPM timing points to use as the old timing reference.");
  }

  let inheritedAdjusted = 0;
  let inheritedSkipped = 0;
  const adjustedInherited = [];

  for (const point of targetInherited) {
    const oldUninherited = activeUninheritedPoint(targetUninherited, point.time);
    const newUninherited = activeUninheritedPoint(baseUninherited, point.time);
    const adjusted = adjustedInheritedPoint(point, oldUninherited, newUninherited);
    if (!adjusted) {
      adjustedInherited.push(point);
      inheritedSkipped += 1;
      continue;
    }
    adjustedInherited.push(adjusted);
    inheritedAdjusted += 1;
  }

  const copiedUninherited = baseUninherited.map((point) => ({
    ...point,
    parts: [...point.parts],
  }));

  setSectionLines(
    targetFile,
    "TimingPoints",
    sortedTimingLines([...copiedUninherited, ...adjustedInherited], timingComments(targetFile)),
  );

  return {
    copiedUninherited: copiedUninherited.length,
    inheritedAdjusted,
    inheritedSkipped,
  };
}

function printSummary(summary, output, options) {
  const out = options.json ? console.error : console.log;
  out("changed:");
  out(`- ${summary.copiedUninherited} BPM timing point${summary.copiedUninherited === 1 ? "" : "s"} copied from base`);
  out(`- ${summary.inheritedAdjusted} inherited SV point${summary.inheritedAdjusted === 1 ? "" : "s"} adjusted`);
  if (summary.inheritedSkipped > 0) {
    out(`- ${summary.inheritedSkipped} inherited SV point${summary.inheritedSkipped === 1 ? "" : "s"} left unchanged`);
  }
  out(`- output: ${output}${options.dryRun ? " (dry run, not written)" : ""}`);
}

function buildStructuredResult(basePath, targetPath, outputPath, options, summary) {
  return {
    type: "surgical-timing-fix",
    basePath,
    targetPath,
    outputPath,
    dryRun: options.dryRun,
    changed: summary,
  };
}

async function main() {
  const { basePath, targetPath, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const output = options.output || defaultOutputPath(targetPath, "-surgical");
  const baseFile = await readOsuFile(basePath);
  const targetFile = await readOsuFile(targetPath);
  const summary = surgicalTimingFix(baseFile, targetFile);
  printSummary(summary, output, options);

  if (!options.dryRun) {
    await writeTextFile(output, serializeOsuFile(targetFile));
  }

  if (options.json) {
    console.log(JSON.stringify(buildStructuredResult(basePath, targetPath, output, options, summary)));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
