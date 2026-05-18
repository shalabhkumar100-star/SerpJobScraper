import runWeeklyHandler from "../nemoclaw/run-weekly.js";

export const config = {
  maxDuration: 300,
};

function headerValue(req, name) {
  const value = req.headers[name] || req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || "";
}

function hasVercelCronHeader(req) {
  const cronHeader = headerValue(req, "x-vercel-cron").toLowerCase();
  return cronHeader === "1" || cronHeader === "true";
}

function isVercelCron(req) {
  const authHeader = headerValue(req, "authorization");

  if (hasVercelCronHeader(req)) return true;
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export default async function handler(req, res) {
  const cronRequestId = `cron-${Date.now()}`;
  console.log("cron wrapper invoked", {
    cronRequestId,
    method: req.method,
    hasVercelCronHeader: hasVercelCronHeader(req),
    hasAuthorization: Boolean(headerValue(req, "authorization")),
  });

  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!isVercelCron(req)) {
    console.log("cron auth failed", { cronRequestId });
    return res.status(401).json({ error: "Unauthorized cron request" });
  }

  const genuineVercelCron = hasVercelCronHeader(req);
  console.log("cron auth passed", { cronRequestId, genuineVercelCron });

  const cronReq = {
    ...req,
    query: {
      ...req.query,
      source: req.query.source || process.env.WEEKLY_SOURCE_MODE || "both",
      test: req.query.test || (genuineVercelCron ? "1" : undefined),
      runKey: req.query.runKey || (genuineVercelCron ? `cron-test-${new Date().toISOString().slice(0, 16)}` : undefined),
    },
    headers: {
      ...req.headers,
      authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
    },
  };

  console.log("runWeekly started", {
    cronRequestId,
    runKey: cronReq.query.runKey || "auto-weekly-run-key",
    test: cronReq.query.test || "0",
    source: cronReq.query.source,
  });

  try {
    await runWeeklyHandler(cronReq, res);
    console.log("runWeekly completed", { cronRequestId });
  } catch (error) {
    console.log("runWeekly failed", { cronRequestId, message: error.message });
    throw error;
  }
}
