import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { list, put } from "@vercel/blob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(__dirname, "..");
const FILE_SETTINGS = path.join(ROOT_DIR, ".osu-script-ui-settings.json");
const BLOB_PATHNAME = "osu-scripts/ui-settings.json";

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
}

export async function persistLoad() {
  const token = blobToken();

  if (token) {
    try {
      const { blobs } = await list({
        token,
        prefix: "osu-scripts/",
        limit: 20,
      });

      const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);

      if (!match) {
        return null;
      }

      const response = await fetch(match.downloadUrl || match.url, {
        cache: "no-store",
      });

      if (!response.ok) {
        console.error("Blob settings fetch failed:", response.status, response.statusText);
        return null;
      }

      return response.json();
    } catch (error) {
      console.error("Failed to load settings from Vercel Blob:", error);
      return null;
    }
  }

  try {
    const raw = await readFile(FILE_SETTINGS, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function persistSave(data) {
  const token = blobToken();
  const body = `${JSON.stringify(data, null, 2)}\n`;

  if (token) {
    await put(BLOB_PATHNAME, body, {
      access: "private",
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }

  await writeFile(FILE_SETTINGS, body, "utf8");
}