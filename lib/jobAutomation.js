import { flattenTargetRoles } from "../config/targetRoles.js";

export const DEFAULT_LOCATION = "London, UK";
export const DEFAULT_APIFY_SOURCE_URL = "https://shalabhkumar100-star-jobscraper.vercel.app/api/search-jobs";
export const DEFAULT_JOBS_DATABASE_ID = "35ee4d9f-8fde-81fe-8ca3-cd98f84eb21c";
export const DEFAULT_RUNS_DATABASE_ID = "35ee4d9f-8fde-813c-ba83-da7ca3c69d7f";

const NOTION_VERSION = "2022-06-28";

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export function getRunKey(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `weekly-run-${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  const auth = req.headers.authorization || "";
  const querySecret = req.query.secret || "";
  return auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET;
}

export function getTargets({ offset = 0, limit = 0, cluster = "", role = "" } = {}) {
  const allTargets = flattenTargetRoles();
  const roleText = cleanText(role).toLowerCase();
  const clusterText = cleanText(cluster).toLowerCase();
  const filtered = allTargets.filter((target) => {
    if (roleText && target.targetRole.toLowerCase() !== roleText && target.query.toLowerCase() !== roleText) return false;
    if (clusterText && target.cluster.toLowerCase() !== clusterText) return false;
    return true;
  });
  return Number(limit) > 0 ? filtered.slice(Number(offset), Number(offset) + Number(limit)) : filtered.slice(Number(offset));
}

export function buildSlicePlan({ sourceMode = "both", location = DEFAULT_LOCATION, runKey = getRunKey(), cluster = "" } = {}) {
  const targets = getTargets({ cluster });
  const sources = sourceMode === "both" ? ["serp", "apify"] : [sourceMode];
  return targets.flatMap((target, offset) =>
    sources.map((source) => ({
      runKey,
      source,
      offset,
      limit: 1,
      location,
      targetRole: target.targetRole,
      roleCluster: target.cluster,
      path: `/api/jobs/run-slice?source=${source}&limit=1&offset=${offset}&runKey=${encodeURIComponent(runKey)}&location=${encodeURIComponent(location)}`,
    })),
  );
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date - today) / 86400000);
}

export function isWithinLast7Days(job) {
  const posted = parseDate(job.postedDate || job.posted);
  if (!posted) return true;
  return posted >= addDays(new Date(), -7);
}

export function actualJobSource(source) {
  const text = cleanText(source).toLowerCase();
  if (text.includes("serp") || text.includes("google")) return "SerpAPI / Google Jobs";
  return "LinkedIn";
}

function jobKey(job) {
  const coreKey = [
    cleanText(job.company).toLowerCase(),
    cleanText(job.role).toLowerCase(),
    cleanText(job.location).toLowerCase(),
  ].join("|");
  if (coreKey !== "||") return coreKey;
  return cleanText(job.applyLink || job.jobLink).toLowerCase();
}

export function dedupeJobs(jobs) {
  const seen = new Map();
  for (const job of jobs) {
    const key = jobKey(job);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...job, jobKey: key });
      continue;
    }
    seen.set(key, {
      ...existing,
      sources: [...new Set([...(existing.sources || []), ...(job.sources || [])])],
      sourceQueries: [...new Set([...(existing.sourceQueries || []), ...(job.sourceQueries || [])])],
      relevanceScore: Math.max(Number(existing.relevanceScore || 0), Number(job.relevanceScore || 0)),
      applyLink: existing.applyLink || job.applyLink,
      jobLink: existing.jobLink || job.jobLink,
      description: existing.description || job.description,
      jobKey: key,
    });
  }
  return Array.from(seen.values());
}

export function scoreJob(job) {
  const text = `${job.role || ""} ${job.company || ""} ${job.description || ""}`.toLowerCase();
  const targetTerms = [job.targetRole, ...(job.targetSearchTerms || []), job.roleCluster]
    .filter(Boolean)
    .flatMap((term) => String(term).toLowerCase().split(/[,/]/))
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
  const alignment = targetTerms.filter((term) => text.includes(term)).length;
  const deadlineDays = daysUntil(job.deadlineDate);
  const deadlineBoost = deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 5 ? 5 - deadlineDays : 0;
  const multiSourceBoost = (job.sources || []).length > 1 ? 2 : 0;
  return Number(job.relevanceScore || 0) + alignment + deadlineBoost + multiSourceBoost;
}

export function sortJobs(jobs) {
  return [...jobs].sort((a, b) => {
    const scoreDiff = scoreJob(b) - scoreJob(a);
    if (scoreDiff) return scoreDiff;
    const aDeadline = daysUntil(a.deadlineDate);
    const bDeadline = daysUntil(b.deadlineDate);
    if (aDeadline !== bDeadline) return (aDeadline ?? 9999) - (bDeadline ?? 9999);
    return cleanText(a.company).localeCompare(cleanText(b.company));
  });
}

function normaliseSourceJob(job, source, target) {
  const jobSource = actualJobSource(job.source || source);
  const normalizedJob = {
    ...job,
    source: jobSource,
    sources: [jobSource],
    sourceQuery: cleanText(job.sourceQuery || target.query),
    sourceQueries: [cleanText(job.sourceQuery || target.query)].filter(Boolean),
    targetRole: target.targetRole,
    targetSearchTerms: target.searchTerms,
    roleCluster: target.cluster,
  };

  return {
    role: cleanText(job.role),
    company: cleanText(job.company),
    location: cleanText(job.location),
    source: jobSource,
    sources: [jobSource],
    posted: cleanText(job.posted),
    postedDate: cleanText(job.postedDate),
    deadlineDate: cleanText(job.deadlineDate || job.deadline),
    applyLink: cleanText(job.applyLink),
    jobLink: cleanText(job.jobLink),
    description: cleanText(job.description),
    relevanceScore: scoreJob(normalizedJob),
    sourceQuery: normalizedJob.sourceQuery,
    sourceQueries: normalizedJob.sourceQueries,
    targetRole: target.targetRole,
    targetSearchTerms: target.searchTerms,
    roleCluster: target.cluster,
  };
}

export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SOURCE_TIMEOUT_MS || 45000));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runSerpSearch(req, target, location) {
  const sourceUrl = process.env.SERP_SOURCE_URL || `${getBaseUrl(req)}/api/search-jobs`;
  const url = new URL(sourceUrl);
  url.searchParams.set("role", target.query);
  url.searchParams.set("location", location);
  url.searchParams.set("expand", "0");
  url.searchParams.set("maxQueries", "1");
  const data = await fetchJson(url.toString());
  return {
    source: "SerpAPI / Google Jobs",
    jobs: (data.jobs || []).map((job) => normaliseSourceJob(job, "SerpAPI / Google Jobs", target)),
    meta: data,
  };
}

export async function runApifySearch(target, location) {
  const sourceUrl = process.env.APIFY_SOURCE_URL || DEFAULT_APIFY_SOURCE_URL;
  const data = await fetchJson(sourceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: target.query, location, expand: false, maxQueries: 1, count: 10 }),
  });
  return {
    source: "LinkedIn / Apify",
    jobs: (data.jobs || []).map((job) => normaliseSourceJob(job, "LinkedIn", target)),
    meta: data,
  };
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

async function notionRequest(path, options = {}) {
  if (!process.env.NOTION_TOKEN) return { skipped: true, reason: "Missing NOTION_TOKEN" };
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: { ...notionHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Notion HTTP ${response.status}`);
  return data;
}

function dateProperty(value) {
  return value ? { date: { start: value } } : undefined;
}

function richText(value) {
  return { rich_text: [{ type: "text", text: { content: String(value || "").slice(0, 1900) } }] };
}

function title(value) {
  return { title: [{ type: "text", text: { content: String(value || "Untitled role").slice(0, 1900) } }] };
}

function urlProperty(value) {
  return value ? { url: value } : undefined;
}

function cleanProperties(properties) {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined && value !== ""));
}

async function queryDatabase(databaseId, filter) {
  return notionRequest(`/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({ filter, page_size: 10 }),
  });
}

function jobProperties(job, { runKey, existingSources = [] } = {}) {
  const sources = [...new Set([...existingSources, ...(job.sources || [job.source]).filter(Boolean).map(actualJobSource)])];
  return cleanProperties({
    Job: title(job.role),
    Company: richText(job.company),
    Location: richText(job.location),
    Source: { multi_select: sources.map((name) => ({ name })) },
    "Posted Date": dateProperty(job.postedDate),
    "Deadline Date": dateProperty(job.deadlineDate),
    "Last Seen": { date: { start: new Date().toISOString() } },
    "Apply Link": urlProperty(job.applyLink),
    "Job Link": urlProperty(job.jobLink),
    "Job Key": richText(job.jobKey || jobKey(job)),
    "Run Key": richText(runKey),
    "Source Query": richText((job.sourceQueries || [job.sourceQuery]).filter(Boolean).join(", ")),
    "Target Role": richText(job.targetRole),
    "Role Cluster": job.roleCluster ? { select: { name: job.roleCluster } } : undefined,
    "Relevance Score": { number: scoreJob(job) },
    Status: { select: { name: "New" } },
  });
}

export async function writeJobsToNotion(jobs, { runKey }) {
  if (!process.env.NOTION_TOKEN) return { skipped: true, reason: "Missing NOTION_TOKEN", jobRowsCreated: 0, jobRowsUpdated: 0, jobRowsTouched: 0 };
  const databaseId = process.env.NOTION_JOBS_DATABASE_ID || DEFAULT_JOBS_DATABASE_ID;
  let jobRowsCreated = 0;
  let jobRowsUpdated = 0;
  const touched = [];

  for (const job of dedupeJobs(jobs).filter(isWithinLast7Days)) {
    const key = job.jobKey || jobKey(job);
    const existing = await queryDatabase(databaseId, {
      property: "Job Key",
      rich_text: { equals: key },
    });
    const existingPage = existing.results?.[0];
    const existingSources = existingPage?.properties?.Source?.multi_select?.map((source) => source.name) || [];
    const properties = jobProperties({ ...job, jobKey: key }, { runKey, existingSources });

    if (existingPage) {
      const updated = await notionRequest(`/pages/${existingPage.id}`, {
        method: "PATCH",
        body: JSON.stringify({ properties }),
      });
      jobRowsUpdated += 1;
      touched.push({ id: updated.id, url: updated.url, action: "updated", job: job.role, company: job.company, sources: properties.Source.multi_select.map((source) => source.name) });
      continue;
    }

    const created = await notionRequest("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        icon: { type: "emoji", emoji: "💼" },
        properties,
      }),
    });
    jobRowsCreated += 1;
    touched.push({ id: created.id, url: created.url, action: "created", job: job.role, company: job.company, sources: properties.Source.multi_select.map((source) => source.name) });
  }

  return {
    jobsDatabaseId: databaseId,
    jobRowsCreated,
    jobRowsUpdated,
    jobRowsTouched: jobRowsCreated + jobRowsUpdated,
    touched,
  };
}

export async function runSlice(req, { sourceMode, offset, limit, location, runKey }) {
  const targets = getTargets({ offset, limit });
  const errors = [];
  const jobs = [];
  const sources = sourceMode === "both" ? ["serp", "apify"] : [sourceMode];

  for (const target of targets) {
    const results = await Promise.allSettled(sources.map((source) => {
      if (source === "serp") return runSerpSearch(req, target, location);
      if (source === "apify") return runApifySearch(target, location);
      throw new Error(`Unsupported source: ${source}`);
    }));
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        jobs.push(...result.value.jobs);
      } else {
        errors.push({ source: sources[index], targetRole: target.targetRole, message: result.reason?.message || "Unknown error" });
      }
    }
  }

  const uniqueJobs = dedupeJobs(jobs).filter(isWithinLast7Days);
  const notion = await writeJobsToNotion(uniqueJobs, { runKey });
  const actualJobSources = [...new Set(uniqueJobs.flatMap((job) => job.sources || []).map(actualJobSource))];

  return {
    runKey,
    sourceMode,
    location,
    targetRolesSearched: targets.length,
    targets,
    totalReturned: jobs.length,
    totalUniqueLast7Days: uniqueJobs.length,
    actualJobSources,
    errors,
    notion,
    topJobs: sortJobs(uniqueJobs).slice(0, 10),
  };
}

export async function fetchLatestJobsFromNotion({ limit = 100, runKey = "" } = {}) {
  if (!process.env.NOTION_TOKEN) return [];
  const databaseId = process.env.NOTION_JOBS_DATABASE_ID || DEFAULT_JOBS_DATABASE_ID;
  const filter = runKey
    ? { property: "Run Key", rich_text: { equals: runKey } }
    : { property: "Last Seen", date: { on_or_after: addDays(new Date(), -7).toISOString() } };
  const data = await notionRequest(`/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter,
      sorts: [{ property: "Last Seen", direction: "descending" }],
      page_size: Math.min(Number(limit), 100),
    }),
  });
  return (data.results || []).map((page) => {
    const prop = page.properties || {};
    return {
      id: page.id,
      url: page.url,
      role: prop.Job?.title?.map((item) => item.plain_text).join("") || "",
      company: prop.Company?.rich_text?.map((item) => item.plain_text).join("") || "",
      location: prop.Location?.rich_text?.map((item) => item.plain_text).join("") || "",
      sources: prop.Source?.multi_select?.map((source) => source.name) || [],
      targetRole: prop["Target Role"]?.rich_text?.map((item) => item.plain_text).join("") || "",
      roleCluster: prop["Role Cluster"]?.select?.name || "",
      deadlineDate: prop["Deadline Date"]?.date?.start || "",
      postedDate: prop["Posted Date"]?.date?.start || "",
      relevanceScore: prop["Relevance Score"]?.number || 0,
      applyLink: prop["Apply Link"]?.url || "",
      jobLink: prop["Job Link"]?.url || "",
    };
  });
}

export function buildJobDigest(jobs, { runKey }) {
  const sorted = sortJobs(jobs);
  const highPriorityScore = Number(process.env.HIGH_PRIORITY_JOB_SCORE || 5);
  const urgentDeadlineDays = Number(process.env.URGENT_DEADLINE_DAYS || 5);
  const highPriority = sorted.filter((job) => scoreJob(job) >= highPriorityScore);
  const urgentDeadlineJobs = sorted.filter((job) => {
    const deadline = daysUntil(job.deadlineDate);
    return deadline !== null && deadline >= 0 && deadline <= urgentDeadlineDays;
  });
  const sourceCounts = sorted.reduce((counts, job) => {
    for (const source of job.sources || []) counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});
  const marketThemes = [...new Set(sorted.map((job) => job.roleCluster || job.targetRole).filter(Boolean))].slice(0, 5);
  return {
    runKey,
    totalJobs: sorted.length,
    highPriorityJobs: highPriority.length,
    urgentJobs: urgentDeadlineJobs.length,
    urgentDeadlineJobs: urgentDeadlineJobs.slice(0, Number(process.env.NOTIFICATION_URGENT_JOBS || 5)),
    highPriority: highPriority.slice(0, Number(process.env.NOTIFICATION_TOP_JOBS || 10)),
    sourceCounts,
    marketThemes,
    topJobs: sorted.slice(0, Number(process.env.NOTIFICATION_TOP_JOBS || 10)),
    urgent: urgentDeadlineJobs.slice(0, Number(process.env.NOTIFICATION_URGENT_JOBS || 5)),
    thresholds: {
      highPriorityScore,
      urgentDeadlineDays,
    },
  };
}

function digestText(digest) {
  const topJobs = digest.topJobs.length
    ? digest.topJobs.map((job) => `- ${job.role} @ ${job.company} (${(job.sources || []).join(", ") || job.source || "Unknown source"})${job.url ? `\n  ${job.url}` : ""}`)
    : ["- No jobs found for this run key."];
  const urgentJobs = (digest.urgentDeadlineJobs || digest.urgent || []).length
    ? (digest.urgentDeadlineJobs || digest.urgent).map((job) => `- ${job.role} @ ${job.company} - deadline in ${daysUntil(job.deadlineDate)} days`)
    : ["- No urgent deadlines found."];
  const sources = Object.entries(digest.sourceCounts).length
    ? Object.entries(digest.sourceCounts).map(([source, count]) => `- ${source}: ${count}`)
    : ["- none"];
  const lines = [
    "Weekly Job Search Digest",
    "",
    `Run Key: ${digest.runKey}`,
    `Total Jobs: ${digest.totalJobs}`,
    `High Priority: ${digest.highPriorityJobs || 0}`,
    `Urgent Deadlines: ${digest.urgentJobs || 0}`,
    "",
    "Top Roles:",
    ...topJobs,
    "",
    "Urgent:",
    ...urgentJobs,
    "",
    "Sources:",
    ...sources,
  ];
  return lines.join("\n").slice(0, 3500);
}

function contentReminderText({ runKey, digest }) {
  const themes = (digest?.marketThemes || []).length ? digest.marketThemes : ["strategy shifts", "delivery leadership", "AI governance"];
  const topRoles = (digest?.topJobs || []).slice(0, 3).map((job) => job.role).filter(Boolean);
  const suggestedTopics = [
    `What this week's ${themes[0] || "job-market"} roles signal about hiring demand`,
    topRoles.length ? `Lessons from target roles: ${topRoles.join(", ")}` : "How target-role demand is changing this week",
    "Practical career positioning notes from the latest market scan",
  ];
  return [
    "LinkedIn Content Reminder:",
    `- Run key: ${runKey}`,
    "- Market themes:",
    ...themes.map((theme) => `  - ${theme}`),
    "- Suggested content topics:",
    ...suggestedTopics.map((topic) => `  - ${topic}`),
  ].join("\n");
}

async function notifyTelegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return { skipped: true, channel: "telegram" };
  const data = await fetchJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  return { channel: "telegram", ok: data.ok };
}

async function notifyEmail(subject, text) {
  if (!process.env.RESEND_API_KEY || !process.env.NOTIFY_EMAIL_TO || !process.env.NOTIFY_EMAIL_FROM) return { skipped: true, channel: "email" };
  await fetchJson("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.NOTIFY_EMAIL_FROM,
      to: process.env.NOTIFY_EMAIL_TO.split(",").map((email) => email.trim()).filter(Boolean),
      subject,
      text,
    }),
  });
  return { channel: "email", ok: true };
}

async function notifyWebhook(payload) {
  if (!process.env.NEMOCLAW_WEBHOOK_URL) return { skipped: true, channel: "nemoclawWebhook" };
  await fetchJson(process.env.NEMOCLAW_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { channel: "nemoclawWebhook", ok: true };
}

export async function sendJobNotifications(digest) {
  const text = digestText(digest);
  const subject = `Weekly job search: ${digest.highPriorityJobs || 0} priority roles, ${digest.totalJobs} total`;
  const results = await Promise.allSettled([
    notifyTelegram(text),
    notifyEmail(subject, text),
    notifyWebhook({ type: "job-search-weekly-digest", digest, text }),
  ]);
  return results.map((result) => result.status === "fulfilled" ? result.value : { error: result.reason?.message || "Notification failed" });
}

export async function sendContentReminder({ runKey, digest = null } = {}) {
  const text = contentReminderText({ runKey, digest });
  const results = await Promise.allSettled([
    notifyTelegram(text),
    notifyEmail(`Weekly LinkedIn content reminder: ${runKey}`, text),
    notifyWebhook({ type: "content-generation-reminder", runKey, text }),
  ]);
  return results.map((result) => result.status === "fulfilled" ? result.value : { error: result.reason?.message || "Notification failed" });
}
