import { DEFAULT_LOCATION, cleanText, getRunKey, isAuthorized, runSlice } from "../../lib/jobAutomation.js";

export const config = {
  maxDuration: 300,
};

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body || {};
  const sourceMode = cleanText(req.query.source || body.source || "both").toLowerCase();
  const offset = Number(req.query.offset ?? body.offset ?? 0);
  const limit = Number(req.query.limit ?? body.limit ?? 1);
  const location = cleanText(req.query.location || body.location || process.env.WEEKLY_SEARCH_LOCATION || DEFAULT_LOCATION);
  const runKey = cleanText(req.query.runKey || body.runKey || getRunKey());

  if (!["serp", "apify", "both"].includes(sourceMode)) {
    return res.status(400).json({ error: "source must be serp, apify, or both" });
  }
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(limit) || limit < 1) {
    return res.status(400).json({ error: "offset must be >= 0 and limit must be >= 1" });
  }

  try {
    const result = await runSlice(req, { sourceMode, offset, limit, location, runKey });
    return res.status(200).json({
      ...result,
      slice: { source: sourceMode, offset, limit },
    });
  } catch (error) {
    return res.status(502).json({
      error: "Slice failed",
      message: error.message,
      slice: { source: sourceMode, offset, limit, runKey },
    });
  }
}
