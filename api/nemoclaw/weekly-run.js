import {
  DEFAULT_LOCATION,
  buildJobDigest,
  buildSlicePlan,
  cleanText,
  fetchLatestJobsFromNotion,
  getRunKey,
  isAuthorized,
  runSlice,
  sendContentReminder,
  sendJobNotifications,
} from "../../lib/jobAutomation.js";

export const config = {
  maxDuration: 300,
};

const DEFAULT_RETRIES = 2;

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

async function runSliceWithRetries(req, slice, { retries }) {
  const attempts = [];

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const result = await runSlice(req, {
        sourceMode: slice.source,
        offset: slice.offset,
        limit: slice.limit,
        location: slice.location,
        runKey: slice.runKey,
      });

      return {
        ok: true,
        attempt,
        slice,
        result,
        attempts,
      };
    } catch (error) {
      attempts.push({ attempt, message: error.message });
      if (attempt > retries) {
        return {
          ok: false,
          attempt,
          slice,
          error: error.message,
          attempts,
        };
      }
    }
  }

  return { ok: false, slice, error: "Unexpected retry state", attempts };
}

async function finalizeRun({ runKey, send, contentReminder }) {
  const jobs = await fetchLatestJobsFromNotion({ runKey, limit: Number(process.env.WEEKLY_FINALIZE_JOB_LIMIT || 100) });
  const digest = buildJobDigest(jobs, { runKey });
  const notifications = send ? await sendJobNotifications(digest) : [];
  const contentNotifications = send && contentReminder ? await sendContentReminder({ runKey }) : [];

  return {
    digest,
    notifications,
    contentNotifications,
  };
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body || {};
  const runKey = cleanText(req.query.runKey || body.runKey || getRunKey());
  const location = cleanText(req.query.location || body.location || process.env.WEEKLY_SEARCH_LOCATION || DEFAULT_LOCATION);
  const sourceMode = cleanText(req.query.source || body.source || process.env.WEEKLY_SOURCE_MODE || "both").toLowerCase();
  const cluster = cleanText(req.query.cluster || body.cluster || "");
  const retries = toPositiveInteger(req.query.retries ?? body.retries ?? process.env.WEEKLY_SLICE_RETRIES, DEFAULT_RETRIES);
  const maxSlices = toPositiveInteger(req.query.maxSlices ?? body.maxSlices ?? process.env.WEEKLY_MAX_SLICES, 0);
  const send = cleanText(req.query.send ?? body.send ?? "1") !== "0";
  const contentReminder = cleanText(req.query.contentReminder ?? body.contentReminder ?? "1") !== "0";
  const dryRun = ["1", "true", "yes"].includes(cleanText(req.query.dryRun ?? body.dryRun).toLowerCase());

  if (!["serp", "apify", "both"].includes(sourceMode)) {
    return res.status(400).json({ error: "source must be serp, apify, or both" });
  }

  const plannedSlices = buildSlicePlan({ sourceMode, location, runKey, cluster });
  const slices = maxSlices > 0 ? plannedSlices.slice(0, maxSlices) : plannedSlices;

  if (dryRun) {
    return res.status(200).json({
      dryRun: true,
      runKey,
      location,
      sourceMode,
      cluster,
      retries,
      totalPlannedSlices: plannedSlices.length,
      totalSlices: slices.length,
      finalizePath: `/api/jobs/finalize-weekly?runKey=${encodeURIComponent(runKey)}`,
      slices,
    });
  }

  const startedAt = new Date().toISOString();
  const sliceResults = [];

  for (const slice of slices) {
    const result = await runSliceWithRetries(req, slice, { retries });
    sliceResults.push(result);
  }

  const failures = sliceResults.filter((result) => !result.ok);
  let finalize = null;

  try {
    finalize = await finalizeRun({ runKey, send, contentReminder });
  } catch (error) {
    finalize = { error: error.message };
  }

  const finishedAt = new Date().toISOString();

  return res.status(failures.length ? 207 : 200).json({
    runKey,
    location,
    sourceMode,
    cluster,
    startedAt,
    finishedAt,
    totalPlannedSlices: plannedSlices.length,
    totalSlices: slices.length,
    successfulSlices: sliceResults.length - failures.length,
    failedSlices: failures.length,
    failures,
    sliceSummary: sliceResults.map((result) => ({
      ok: result.ok,
      source: result.slice.source,
      offset: result.slice.offset,
      targetRole: result.slice.targetRole,
      roleCluster: result.slice.roleCluster,
      attempts: result.attempt,
      totalUniqueLast7Days: result.result?.totalUniqueLast7Days ?? 0,
      jobRowsTouched: result.result?.notion?.jobRowsTouched ?? 0,
      error: result.error || "",
    })),
    finalize,
  });
}
