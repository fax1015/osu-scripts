import { handleShutdown, withApiErrorBoundary } from "../lib/server-handlers.mjs";

async function handler(req, res) {
  await handleShutdown(req, res);
}

export default withApiErrorBoundary(handler);
