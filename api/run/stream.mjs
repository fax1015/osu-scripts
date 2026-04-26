import { handleRunStream } from "../../lib/server-handlers.mjs";

export default async function handler(req, res) {
  await handleRunStream(req, res);
}
