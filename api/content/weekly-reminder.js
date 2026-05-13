import { cleanText, getRunKey, isAuthorized, sendContentReminder } from "../../lib/jobAutomation.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body || {};
  const runKey = cleanText(req.query.runKey || body.runKey || getRunKey());

  try {
    const notifications = await sendContentReminder({ runKey });
    return res.status(200).json({ runKey, notifications });
  } catch (error) {
    return res.status(500).json({ error: "Content reminder failed", message: error.message, runKey });
  }
}
