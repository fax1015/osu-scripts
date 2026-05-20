import { handleRun, withApiErrorBoundary } from "../lib/server-handlers.mjs";

async function handler(req, res) {
  await handleRun(req, res);
}

export default withApiErrorBoundary(handler);
