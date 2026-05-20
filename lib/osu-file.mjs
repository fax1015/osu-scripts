import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function readOsuFile(filePath) {
  const text = await readFile(filePath, "utf8");
  return parseOsuText(text, filePath);
}

export async function writeTextFile(filePath, text) {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

export function parseOsuText(text, filePath = "") {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hadFinalNewline = normalized.endsWith("\n");
  const lines = hadFinalNewline ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  if (lines.length === 1 && lines[0] === "" && !text) {
    lines.length = 0;
  }

  return {
    filePath,
    eol,
    lines,
  };
}

export function serializeOsuFile(file) {
  return `${file.lines.join(file.eol)}${file.eol}`;
}

export function sectionBounds(file, sectionName) {
  const wanted = sectionName.toLowerCase();
  let headerIndex = -1;

  for (let i = 0; i < file.lines.length; i += 1) {
    const match = file.lines[i].trim().match(/^\[([^\]]+)\]$/);
    if (match && match[1].trim().toLowerCase() === wanted) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return null;
  }

  let endIndex = file.lines.length;
  for (let i = headerIndex + 1; i < file.lines.length; i += 1) {
    if (/^\[[^\]]+\]$/.test(file.lines[i].trim())) {
      endIndex = i;
      break;
    }
  }

  return {
    headerIndex,
    bodyStart: headerIndex + 1,
    endIndex,
  };
}

export function getSectionLines(file, sectionName) {
  const bounds = sectionBounds(file, sectionName);
  return bounds ? file.lines.slice(bounds.bodyStart, bounds.endIndex) : [];
}

export function setSectionLines(file, sectionName, bodyLines) {
  const bounds = sectionBounds(file, sectionName);
  if (bounds) {
    file.lines.splice(bounds.bodyStart, bounds.endIndex - bounds.bodyStart, ...bodyLines);
    return;
  }

  if (file.lines.length > 0 && file.lines[file.lines.length - 1].trim() !== "") {
    file.lines.push("");
  }
  file.lines.push(`[${sectionName}]`, ...bodyLines);
}

export function getSectionValue(file, sectionName, keyName) {
  const wanted = keyName.toLowerCase();
  for (const line of getSectionLines(file, sectionName)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim().toLowerCase();
    if (key === wanted) {
      return trimmed.slice(separator + 1).trim();
    }
  }
  return null;
}

export function setSectionValue(file, sectionName, keyName, value) {
  const lines = getSectionLines(file, sectionName);
  const wanted = keyName.toLowerCase();
  let changed = false;

  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      return line;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      return line;
    }
    const key = trimmed.slice(0, separator).trim();
    if (key.toLowerCase() !== wanted) {
      return line;
    }
    changed = true;
    return `${key}: ${value}`;
  });

  if (!changed) {
    next.push(`${keyName}: ${value}`);
  }
  setSectionLines(file, sectionName, next);
}

export function parseTimingPointLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//")) {
    return null;
  }

  const parts = trimmed.split(",");
  if (parts.length < 2) {
    return null;
  }

  const time = Number.parseFloat(parts[0]);
  const beatLength = Number.parseFloat(parts[1]);
  if (!Number.isFinite(time) || !Number.isFinite(beatLength)) {
    return null;
  }

  return {
    parts,
    time,
    beatLength,
    uninherited: parts.length > 6 ? parts[6].trim() !== "0" : true,
    raw: line,
  };
}

export function timingPointToLine(point) {
  const parts = [...point.parts];
  parts[0] = formatNumber(point.time);
  parts[1] = formatNumber(point.beatLength);
  return parts.join(",");
}

export function parseTimingPoints(file) {
  return getSectionLines(file, "TimingPoints")
    .map((line, index) => {
      const point = parseTimingPointLine(line);
      return point ? { ...point, index } : null;
    })
    .filter(Boolean);
}

export function parseHitObjectLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//")) {
    return null;
  }

  const parts = trimmed.split(",");
  if (parts.length < 5) {
    return null;
  }

  const time = Number.parseInt(parts[2], 10);
  const type = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(time) || !Number.isFinite(type)) {
    return null;
  }

  return {
    parts,
    time,
    type,
    raw: line,
  };
}

export function shiftHitObjectLine(line, offset) {
  const object = parseHitObjectLine(line);
  if (!object) {
    return line;
  }

  const parts = [...object.parts];
  parts[2] = String(Math.round(object.time + offset));

  const isSpinner = (object.type & 8) !== 0;
  const isHold = (object.type & 128) !== 0;
  if ((isSpinner || isHold) && parts[5] != null) {
    if (isHold) {
      const holdParts = parts[5].split(":");
      const endTime = Number.parseInt(holdParts[0], 10);
      if (Number.isFinite(endTime)) {
        holdParts[0] = String(Math.round(endTime + offset));
        parts[5] = holdParts.join(":");
      }
    } else {
      const endTime = Number.parseInt(parts[5], 10);
      if (Number.isFinite(endTime)) {
        parts[5] = String(Math.round(endTime + offset));
      }
    }
  }

  return parts.join(",");
}

export function parseBreakLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//")) {
    return null;
  }

  const parts = trimmed.split(",");
  if (parts.length < 3) {
    return null;
  }

  const type = parts[0].trim().toLowerCase();
  if (type !== "2" && type !== "break") {
    return null;
  }

  const start = Number.parseInt(parts[1], 10);
  const end = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return {
    parts,
    start,
    end,
    raw: line,
  };
}

export function shiftBreakLine(line, offset) {
  const event = parseBreakLine(line);
  if (!event) {
    return line;
  }

  const parts = [...event.parts];
  parts[1] = String(Math.round(event.start + offset));
  parts[2] = String(Math.round(event.end + offset));
  return parts.join(",");
}

export function parseBookmarks(file) {
  const raw = getSectionValue(file, "Editor", "Bookmarks");
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter(Number.isFinite);
}

export function formatBookmarks(bookmarks) {
  return [...new Set(bookmarks.map((value) => Math.round(value)))]
    .sort((a, b) => a - b)
    .join(",");
}

export function timingPointSort(a, b) {
  if (a.time !== b.time) {
    return a.time - b.time;
  }
  if (a.uninherited !== b.uninherited) {
    return a.uninherited ? -1 : 1;
  }
  return a.order - b.order;
}

export function hitObjectSort(a, b) {
  if (a.time !== b.time) {
    return a.time - b.time;
  }
  return a.order - b.order;
}

export function activeUninheritedPoint(points, time) {
  let active = null;
  for (const point of points) {
    if (!point.uninherited || point.beatLength <= 0) {
      continue;
    }
    if (point.time > time) {
      break;
    }
    active = point;
  }
  return active;
}

export function bpmFromBeatLength(beatLength) {
  return beatLength > 0 ? 60000 / beatLength : 0;
}

export function formatNumber(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return Number(value.toFixed(12)).toString();
}

export function formatTime(ms) {
  const rounded = Math.max(0, Math.round(ms));
  const minutes = Math.floor(rounded / 60000);
  const seconds = Math.floor((rounded % 60000) / 1000);
  const milliseconds = rounded % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(milliseconds).padStart(3, "0")}`;
}

export function defaultOutputPath(inputPath, suffix) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir || ".", `${parsed.name}${suffix}${parsed.ext || ".osu"}`);
}

