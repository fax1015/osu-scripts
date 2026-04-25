import { handleShutdown } from "../lib/server-handlers.mjs";

export default async function handler(req, res) {
  await handleShutdown(req, res);
}
