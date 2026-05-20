import { handleOAuthLogout, withApiErrorBoundary } from "../../lib/server-handlers.mjs";

async function handler(req, res) {
  await handleOAuthLogout(req, res);
}

export default withApiErrorBoundary(handler);
