import { handleOAuthLogout } from "../../lib/server-handlers.mjs";

export default async function handler(req, res) {
  await handleOAuthLogout(req, res);
}
