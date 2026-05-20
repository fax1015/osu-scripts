import { handleSettings, withApiErrorBoundary } from "../lib/server-handlers.mjs";

async function handler(req, res) {
  await handleSettings(req, res);
}

export default withApiErrorBoundary(handler);
