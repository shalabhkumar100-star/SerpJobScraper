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

function toNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function firstSlicePerSource(slices) {
  const seen = new Set();
  return slices.filter((slice) => {
    if (seen.has(slice.source)) return false;
    seen.add(slice.source);
    return true;
  });
}

async function runSliceWithRetries(req, slice, retries) {
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
        attempts,
        result,
      };
    } catch (error) {
      attempts.push({ attempt, message: error.message });
      if (attempt > retries) {
        return {
          ok: false,
          attempt,
          slice,
          attempts,
          error: error.message,
        };
      }
    }
  }

  return { ok: false, slice, attempts, error: "Unexpected retry state" };
}

function summarizeSlice(result) {
  return {
    ok: result.ok,
    source: result.slice.source,
    offset: result.slice.offset,
    targetRole: result.slice.targetRole,
    roleCluster: result.slice.roleCluster,
    attempts: result.attempt,
    jobsReturned: result.result?.totalReturned || 0,
    jobsUnique: result.result?.totalUniqueLast7Days || 0,
    jobsCreated: result.result?.notion?.jobRowsCreated || 0,
    jobsUpdated: result.result?.notion?.jobRowsUpdated || 0,
    jobsTouched: result.result?.notion?.jobRowsTouched || 0,
    errors: result.result?.errors || [],
    error: result.error || "",
  };
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body || {};
  const startedAt = new Date().toISOString();
  const runKey = cleanText(req.query.runKey || body.runKey || getRunKey());
  const location = cleanText(req.query.location || body.location || process.env.WEEKLY_SEARCH_LOCATION || DEFAULT_LOCATION);
  const sourceMode = cleanText(req.query.source || body.source || process.env.WEEKLY_SOURCE_MODE || "both").toLowerCase();
  const cluster = cleanText(req.query.cluster || body.cluster || "");
  const retries = toNonNegativeInteger(req.query.retries ?? body.retries ?? process.env.WEEKLY_SLICE_RETRIES, DEFAULT_RETRIES);
  const testMode = ["1", "true", "yes"].includes(cleanText(req.query.test ?? body.test).toLowerCase());
  const dryRun = ["1", "true", "yes"].includes(cleanText(req.query.dryRun ?? body.dryRun).toLowerCase());
  const send = cleanText(req.query.send ?? body.send ?? "1") !== "0";
  const contentReminder = cleanText(req.query.contentReminder ?? body.contentReminder ?? "1") !== "0";

  if (!["serp", "apify", "both"].includes(sourceMode)) {
    return res.status(400).json({ error: "source must be serp, apify, or both" });
  }

  const plannedSlices = buildSlicePlan({ sourceMode, location, runKey, cluster });
  const slices = testMode ? firstSlicePerSource(plannedSlices) : plannedSlices;

  if (dryRun) {
    return res.status(200).json({
      dryRun: true,
      testMode,
      runKey,
      location,
      sourceMode,
      cluster,
      retries,
      totalPlannedSlices: plannedSlices.length,
      totalSlices: slices.length,
      slices,
    });
  }

  const sliceResults = [];
  for (const slice of slices) {
    const result = await runSliceWithRetries(req, slice, retries);
    sliceResults.push(result);
  }

  const sliceSummary = sliceResults.map(summarizeSlice);
  const failedSlices = sliceSummary.filter((slice) => !slice.ok);
  const jobsCreated = sliceSummary.reduce((sum, slice) => sum + slice.jobsCreated, 0);
  const jobsUpdated = sliceSummary.reduce((sum, slice) => sum + slice.jobsUpdated, 0);
  const jobsTouched = sliceSummary.reduce((sum, slice) => sum + slice.jobsTouched, 0);

  let finalize = null;
  try {
    const jobs = await fetchLatestJobsFromNotion({ runKey, limit: Number(process.env.WEEKLY_FINALIZE_JOB_LIMIT || 100) });
    const digest = buildJobDigest(jobs, { runKey });
    const notifications = send ? await sendJobNotifications(digest) : [];
    const contentNotifications = send && contentReminder ? await sendContentReminder({ runKey, digest }) : [];
    finalize = {
      ok: true,
      digest,
      notifications,
      contentNotifications,
      telegram: {
        digest: notifications.find((item) => item.channel === "telegram") || null,
        contentReminder: contentNotifications.find((item) => item.channel === "telegram") || null,
      },
    };
  } catch (error) {
    finalize = { ok: false, error: error.message };
  }

  const finishedAt = new Date().toISOString();

  return res.status(failedSlices.length ? 207 : 200).json({
    runKey,
    testMode,
    location,
    sourceMode,
    cluster,
    startedAt,
    finishedAt,
    totalPlannedSlices: plannedSlices.length,
    totalSlices: slices.length,
    slicesAttempted: sliceSummary.length,
    slicesFailed: failedSlices.length,
    failedSlices,
    jobsCreated,
    jobsUpdated,
    jobsTouched,
    sliceSummary,
    finalize,
    logs: {
      slicesAttempted: sliceSummary.length,
      slicesFailed: failedSlices.length,
      jobsCreated,
      jobsUpdated,
      telegramDigest: finalize?.telegram?.digest || null,
      telegramContentReminder: finalize?.telegram?.contentReminder || null,
    },
  });
}
