import { handleSettings } from "../lib/server-handlers.mjs";

export default async function handler(req, res) {
  await handleSettings(req, res);
}
