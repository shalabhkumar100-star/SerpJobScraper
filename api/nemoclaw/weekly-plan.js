import { DEFAULT_LOCATION, buildSlicePlan, cleanText, getRunKey, isAuthorized } from "../../lib/jobAutomation.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body || {};
  const runKey = cleanText(req.query.runKey || body.runKey || getRunKey());
  const location = cleanText(req.query.location || body.location || process.env.WEEKLY_SEARCH_LOCATION || DEFAULT_LOCATION);
  const sourceMode = cleanText(req.query.source || body.source || "both").toLowerCase();
  const cluster = cleanText(req.query.cluster || body.cluster || "");

  if (!["serp", "apify", "both"].includes(sourceMode)) {
    return res.status(400).json({ error: "source must be serp, apify, or both" });
  }

  const slices = buildSlicePlan({ sourceMode, location, runKey, cluster });
  return res.status(200).json({
    runKey,
    location,
    sourceMode,
    totalSlices: slices.length,
    instructions: [
      "Call each slice path with the same Authorization header.",
      "Retry failed slices up to 2 times.",
      "When all slices are complete, call /api/jobs/finalize-weekly with this runKey.",
    ],
    finalizePath: `/api/jobs/finalize-weekly?runKey=${encodeURIComponent(runKey)}`,
    slices,
  });
}
