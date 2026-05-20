import { handleRunStream, withApiErrorBoundary } from "../../lib/server-handlers.mjs";

async function handler(req, res) {
  await handleRunStream(req, res);
}

export default withApiErrorBoundary(handler);
