import {
  buildJobDigest,
  cleanText,
  fetchLatestJobsFromNotion,
  getRunKey,
  isAuthorized,
  sendContentReminder,
  sendJobNotifications,
} from "../../lib/jobAutomation.js";

export const config = {
  maxDuration: 300,
};

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body || {};
  const runKey = cleanText(req.query.runKey || body.runKey || getRunKey());
  const send = cleanText(req.query.send || body.send || "1") !== "0";
  const contentReminder = cleanText(req.query.contentReminder || body.contentReminder || "1") !== "0";

  try {
    const jobs = await fetchLatestJobsFromNotion({ runKey, limit: Number(req.query.limit || body.limit || 100) });
    const digest = buildJobDigest(jobs, { runKey });
    const notifications = send ? await sendJobNotifications(digest) : [];
    const contentNotifications = send && contentReminder ? await sendContentReminder({ runKey, digest }) : [];

    return res.status(200).json({
      runKey,
      digest,
      notifications,
      contentNotifications,
      logs: {
        jobsAggregated: jobs.length,
        telegram: {
          digest: notifications.find((item) => item.channel === "telegram") || null,
          contentReminder: contentNotifications.find((item) => item.channel === "telegram") || null,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "Finalize failed", message: error.message, runKey });
  }
}
