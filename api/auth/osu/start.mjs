import { handleOAuthStart } from "../../../lib/server-handlers.mjs";

export default async function handler(req, res) {
  await handleOAuthStart(req, res);
}
