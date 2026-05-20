import { handleOAuthStart, withApiErrorBoundary } from "../../../lib/server-handlers.mjs";

async function handler(req, res) {
  await handleOAuthStart(req, res);
}

export default withApiErrorBoundary(handler);
