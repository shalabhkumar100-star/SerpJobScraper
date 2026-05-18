import runWeeklyHandler from "../nemoclaw/run-weekly.js";

export const config = {
  maxDuration: 300,
};

function headerValue(req, name) {
  const value = req.headers[name] || req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || "";
}

function isVercelCron(req) {
  const cronHeader = headerValue(req, "x-vercel-cron").toLowerCase();
  const authHeader = headerValue(req, "authorization");

  if (cronHeader === "1" || cronHeader === "true") return true;
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!isVercelCron(req)) return res.status(401).json({ error: "Unauthorized cron request" });

  const cronReq = {
    ...req,
    query: {
      ...req.query,
      source: req.query.source || process.env.WEEKLY_SOURCE_MODE || "both",
    },
    headers: {
      ...req.headers,
      authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
    },
  };

  return runWeeklyHandler(cronReq, res);
}
