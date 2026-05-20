#!/usr/bin/env node

import {
  defaultOutputPath,
  formatNumber,
  parseTimingPointLine,
  readOsuFile,
  serializeOsuFile,
  setSectionLines,
  timingPointSort,
  timingPointToLine,
  writeTextFile,
} from "../lib/osu-file.mjs";

function printHelp() {
  console.log(`Usage:
  node cli/edit-timing-points.mjs <map.osu> [options]

Options:
  --output=map-edited.osu   File to write. Default: <input>-edited.osu
  --bpm-scale=2             Multiply uninherited BPM/red lines by this factor
  --sv-scale=0.5            Multiply inherited SV/green lines by this factor
  --dry-run                 Print the summary without writing output
  --json                    Print structured JSON
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const options = {
    output: null,
    bpmScale: null,
    svScale: null,
    dryRun: false,
    json: false,
    help: false,
  };
  let input = null;

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
    if (arg.startsWith("--bpm-scale=")) {
      options.bpmScale = Number.parseFloat(arg.slice("--bpm-scale=".length));
      continue;
    }
    if (arg.startsWith("--sv-scale=")) {
      options.svScale = Number.parseFloat(arg.slice("--sv-scale=".length));
      continue;
    }
    if (!input && !arg.startsWith("-")) {
      input = arg;
      continue;
    }
    throw new Error(`Unrecognized argument: ${arg}`);
  }

  if (!options.help) {
    validateOptions(options);
  }

  return { input, options };
}

function validateScale(name, value) {
  if (value != null && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${name} must be a positive number`);
  }
}

function validateOptions(options) {
  validateScale("--bpm-scale", options.bpmScale);
  validateScale("--sv-scale", options.svScale);

  if (options.bpmScale == null && options.svScale == null) {
    throw new Error("Nothing to do. Pass --bpm-scale, --sv-scale, or both.");
  }
}

function timingSectionLines(file) {
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
    if (inTiming) {
      lines.push(line);
    }
  }

  return lines;
}

function sortedTimingLines(lines) {
  let order = 0;
  const comments = [];
  const points = [];

  for (const line of lines) {
    const point = parseTimingPointLine(line);
    if (!point) {
      comments.push(line);
      continue;
    }
    points.push({ ...point, order: order += 1 });
  }

  points.sort(timingPointSort);
  return [...comments, ...points.map((point) => timingPointToLine(point))];
}

function editTimingPoints(file, options) {
  const lines = [];
  let inheritedScaled = 0;
  let uninheritedBpmScaled = 0;

  for (const line of timingSectionLines(file)) {
    const point = parseTimingPointLine(line);
    if (!point) {
      lines.push(line);
      continue;
    }

    const next = {
      ...point,
      parts: [...point.parts],
    };

    if (next.uninherited && options.bpmScale != null) {
      next.beatLength /= options.bpmScale;
      uninheritedBpmScaled += 1;
    }
    if (!next.uninherited && options.svScale != null) {
      next.beatLength /= options.svScale;
      inheritedScaled += 1;
    }

    lines.push(timingPointToLine(next));
  }

  setSectionLines(file, "TimingPoints", sortedTimingLines(lines));

  return {
    inheritedScaled,
    uninheritedBpmScaled,
  };
}

function printSummary(summary, options, output) {
  const out = options.json ? console.error : console.log;
  const pieces = [];
  if (options.bpmScale != null) {
    pieces.push(`${summary.uninheritedBpmScaled} timing point${summary.uninheritedBpmScaled === 1 ? "" : "s"} x${formatNumber(options.bpmScale)}`);
  }
  if (options.svScale != null) {
    pieces.push(`${summary.inheritedScaled} inherited point${summary.inheritedScaled === 1 ? "" : "s"} x${formatNumber(options.svScale)}`);
  }
  out(`${pieces.join(" · ")} -> ${output}${options.dryRun ? " (dry run)" : ""}`);
}

function buildStructuredResult(input, options, output, summary) {
  return {
    type: "timing-point-editor",
    inputPath: input,
    outputPath: output,
    dryRun: options.dryRun,
    options: {
      bpmScale: options.bpmScale,
      svScale: options.svScale,
    },
    changed: summary,
  };
}

async function main() {
  const { input, options } = parseArgs(process.argv.slice(2));
  if (options.help || !input) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const output = options.output || defaultOutputPath(input, "-edited");
  const file = await readOsuFile(input);
  const summary = editTimingPoints(file, options);
  printSummary(summary, options, output);

  if (!options.dryRun) {
    await writeTextFile(output, serializeOsuFile(file));
  }

  if (options.json) {
    console.log(JSON.stringify(buildStructuredResult(input, options, output, summary)));
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
