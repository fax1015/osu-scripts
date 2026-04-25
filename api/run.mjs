import { handleRun } from "../lib/server-handlers.mjs";

export default async function handler(req, res) {
  await handleRun(req, res);
}
