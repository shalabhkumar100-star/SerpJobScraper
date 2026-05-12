import { flattenTargetRoles } from "../config/targetRoles.js";

export const config = {
  maxDuration: 300,
};

const DEFAULT_LOCATION = "London, UK";
const DEFAULT_NOTION_PAGE_ID = "35be4d9f-8fde-819d-9276-e5794940c9ca";
const DEFAULT_APIFY_SOURCE_URL = "https://shalabhkumar100-star-jobscraper.vercel.app/api/search-jobs";
const NOTION_VERSION = "2022-06-28";
const RUNS_DATABASE_TITLE = "Job Runs";
const JOBS_DATABASE_TITLE = "Job Opportunities";
const SERP_SOURCE_NAME = "SerpAPI / Google Jobs";
const APIFY_SOURCE_NAME = "LinkedIn / Apify";

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function getRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

function dateOnly(value) {
  const date = parseDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function isWithinLast7Days(job) {
  const posted = parseDate(job.postedDate || job.posted);
  if (!posted) return true;
  return posted >= addDays(new Date(), -7);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, length = 1900) {
  return cleanText(value).slice(0, length);
}

function validUrl(value) {
  const text = cleanText(value);
  if (!/^https?:\/\//i.test(text)) return null;
  return text.slice(0, 2000);
}

function richText(value) {
  const content = truncate(value) || " ";
  return { rich_text: [{ type: "text", text: { content } }] };
}

function titleText(value) {
  const content = truncate(value, 200) || "Untitled";
  return { title: [{ type: "text", text: { content } }] };
}

function dateProperty(value) {
  const start = dateOnly(value);
  return start ? { date: { start } } : null;
}

function jobKey(job) {
  const link = cleanText(job.applyLink || job.jobLink).toLowerCase();
  if (link) return `link:${link}`;
  return [
    cleanText(job.company).toLowerCase(),
    cleanText(job.role).toLowerCase(),
    cleanText(job.location).toLowerCase(),
  ].join("|");
}

function dedupeJobs(jobs) {
  const seen = new Map();
  for (const job of jobs) {
    const key = jobKey(job);
    if (!key || key === "||") continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, job);
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
    });
  }
  return Array.from(seen.values());
}

function getIsoWeek(value) {
  const date = new Date(value);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getRunKey(startedAt) {
  return process.env.NOTION_RUN_KEY || `weekly-run-${getIsoWeek(startedAt)}`;
}

function getSourceMode(req) {
  const value = cleanText(req.query.source || req.body?.source || process.env.WEEKLY_SOURCE_MODE || "both").toLowerCase();
  if (["serp", "serpapi", "google", "google-jobs", "google_jobs"].includes(value)) return "serp";
  if (["apify", "linkedin", "linked-in"].includes(value)) return "apify";
  return "both";
}

function sourceUrls(req, sourceMode) {
  const urls = [];
  if (sourceMode === "both" || sourceMode === "serp") {
    urls.push({ source: SERP_SOURCE_NAME, url: process.env.SERP_SOURCE_URL || `${getBaseUrl(req)}/api/search-jobs` });
  }
  if (sourceMode === "both" || sourceMode === "apify") {
    urls.push({ source: APIFY_SOURCE_NAME, url: process.env.APIFY_SOURCE_URL || DEFAULT_APIFY_SOURCE_URL });
  }
  return urls;
}

function roleAlignmentScore(job) {
  const text = `${job.role || ""} ${job.description || ""}`.toLowerCase();
  const terms = [job.targetRole, ...(job.targetSearchTerms || []), job.roleCluster]
    .filter(Boolean)
    .flatMap((term) => String(term).toLowerCase().split(/[,/]/))
    .map((term) => term.trim())
    .filter((term) => term.length > 2);

  const matched = terms.filter((term) => text.includes(term));
  return matched.length + Number(job.relevanceScore || 0);
}

function sortJobs(jobs) {
  return [...jobs].sort((a, b) => {
    const scoreDiff = roleAlignmentScore(b) - roleAlignmentScore(a);
    if (scoreDiff) return scoreDiff;
    return cleanText(a.company).localeCompare(cleanText(b.company));
  });
}

function normaliseSourceJob(job, source, target) {
  return {
    role: cleanText(job.role),
    company: cleanText(job.company),
    location: cleanText(job.location),
    source: cleanText(job.source || source),
    sources: [cleanText(job.source || source)].filter(Boolean),
    posted: cleanText(job.posted),
    postedDate: cleanText(job.postedDate),
    deadlineDate: cleanText(job.deadlineDate || job.deadline),
    applyLink: cleanText(job.applyLink),
    jobLink: cleanText(job.jobLink),
    description: cleanText(job.description),
    relevanceScore: Number(job.relevanceScore || 0),
    sourceQuery: cleanText(job.sourceQuery),
    sourceQueries: [cleanText(job.sourceQuery || target.query)].filter(Boolean),
    targetRole: target.targetRole,
    targetSearchTerms: target.searchTerms,
    roleCluster: target.cluster,
  };
}

async function fetchJson(url, options = {}) {
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
    if (!response.ok) {
      throw new Error(data.error || data.raw || `HTTP ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function runSerpSearch(req, target, location) {
  const sourceUrl = process.env.SERP_SOURCE_URL || `${getBaseUrl(req)}/api/search-jobs`;
  const url = new URL(sourceUrl);
  url.searchParams.set("role", target.query);
  url.searchParams.set("location", location);
  url.searchParams.set("expand", "0");
  url.searchParams.set("maxQueries", "1");
  const data = await fetchJson(url.toString());
  return {
    source: SERP_SOURCE_NAME,
    jobs: (data.jobs || []).map((job) => normaliseSourceJob(job, SERP_SOURCE_NAME, target)),
    meta: data,
  };
}

async function runApifySearch(target, location) {
  const sourceUrl = process.env.APIFY_SOURCE_URL || DEFAULT_APIFY_SOURCE_URL;
  const data = await fetchJson(sourceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: target.query, location, expand: false, maxQueries: 1, count: 10 }),
  });
  return {
    source: APIFY_SOURCE_NAME,
    jobs: (data.jobs || []).map((job) => normaliseSourceJob(job, APIFY_SOURCE_NAME, target)),
    meta: data,
  };
}

function plannedSourcesFor(req, target, location, sourceMode) {
  const sources = [];
  if (sourceMode === "both" || sourceMode === "serp") {
    sources.push({ source: SERP_SOURCE_NAME, run: () => runSerpSearch(req, target, location) });
  }
  if (sourceMode === "both" || sourceMode === "apify") {
    sources.push({ source: APIFY_SOURCE_NAME, run: () => runApifySearch(target, location) });
  }
  return sources;
}

async function notionFetch(path, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Notion API error ${response.status}`);
  }
  return data;
}

function notionTitle(database) {
  return (database.title || []).map((item) => item.plain_text || item.text?.content || "").join("");
}

async function findDatabaseByTitle(title) {
  const data = await notionFetch("/search", {
    method: "POST",
    body: JSON.stringify({
      query: title,
      filter: { property: "object", value: "database" },
      page_size: 20,
    }),
  });
  return (data.results || []).find((database) => notionTitle(database) === title);
}

async function findChildDatabaseByTitle(parentPageId, title) {
  const matches = [];
  let cursor = undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const data = await notionFetch(`/blocks/${parentPageId}/children?${query.toString()}`, { method: "GET" });
    matches.push(...(data.results || []).filter((block) => block.type === "child_database" && block.child_database?.title === title));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return matches.sort((a, b) => String(b.created_time || "").localeCompare(String(a.created_time || "")))[0] || null;
}

async function ensureDatabase({ parentPageId, envId, title, properties }) {
  if (process.env[envId]) return process.env[envId];

  const childExisting = await findChildDatabaseByTitle(parentPageId, title);
  if (childExisting) return childExisting.id;

  const existing = await findDatabaseByTitle(title);
  if (existing) return existing.id;

  const created = await notionFetch("/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: title } }],
      properties,
    }),
  });
  return created.id;
}

async function queryDatabase(databaseId, filter) {
  const data = await notionFetch(`/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({ filter, page_size: 1 }),
  });
  return (data.results || [])[0] || null;
}

async function upsertPage({ databaseId, filter, properties, icon }) {
  const existing = await queryDatabase(databaseId, filter);
  if (existing) {
    const updated = await notionFetch(`/pages/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties, icon }),
    });
    return { pageId: updated.id, url: updated.url, action: "updated" };
  }

  const created = await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { database_id: databaseId }, icon, properties }),
  });
  return { pageId: created.id, url: created.url, action: "created" };
}

function runStatus(errors, sourceStats) {
  const totalFailures = sourceStats.reduce((sum, stat) => sum + stat.failures, 0);
  const totalSuccesses = sourceStats.reduce((sum, stat) => sum + stat.successes, 0);
  if (errors.length && !totalSuccesses) return "Failed";
  if (errors.length || totalFailures) return "Partial";
  return "Completed";
}

function sourceSummary(sourceStats, sourceMode) {
  const stats = sourceStats
    .map((stat) => `${stat.source}: ${stat.successes} ok, ${stat.failures} failed, ${stat.jobs} fetched`)
    .join("; ");
  return `Mode: ${sourceMode}; ${stats}`;
}

function errorSummary(errors) {
  if (!errors.length) return "No source errors recorded.";
  return errors
    .slice(0, 20)
    .map((error) => `${error.source} | ${error.targetRole}: ${error.message}`)
    .join("\n");
}

function buildRunProperties({ runKey, startedAt, finishedAt, location, targets, jobs, uniqueJobs, errors, sourceStats, sourceMode }) {
  const runDate = dateProperty(startedAt);
  return {
    "Run Key": titleText(runKey),
    ...(runDate ? { "Run Date": runDate } : {}),
    "Run Week": richText(getIsoWeek(startedAt)),
    Source: richText(sourceSummary(sourceStats, sourceMode)),
    Status: { select: { name: runStatus(errors, sourceStats) } },
    Location: richText(location),
    "Target Roles": { number: targets.length },
    "Total Fetched": { number: jobs.length },
    "Total Unique": { number: uniqueJobs.length },
    Errors: richText(errorSummary(errors)),
    "Started At": { date: { start: startedAt } },
    "Finished At": { date: { start: finishedAt } },
  };
}

function buildJobProperties(job, runKey, finishedAt) {
  const applyLink = validUrl(job.applyLink);
  const jobLink = validUrl(job.jobLink);
  const postedDate = dateProperty(job.postedDate || job.posted);
  const deadlineDate = dateProperty(job.deadlineDate);
  return {
    Job: titleText(job.role || "Untitled role"),
    "Job Key": richText(jobKey(job)),
    Company: richText(job.company || "Unknown company"),
    Location: richText(job.location || "Unknown location"),
    Source: { multi_select: [...new Set(job.sources || [job.source].filter(Boolean))].map((name) => ({ name: truncate(name, 100) })) },
    "Role Cluster": job.roleCluster ? { select: { name: truncate(job.roleCluster, 100) } } : { select: null },
    "Target Role": richText(job.targetRole),
    ...(postedDate ? { "Posted Date": postedDate } : {}),
    ...(deadlineDate ? { "Deadline Date": deadlineDate } : {}),
    "Relevance Score": { number: Number(job.relevanceScore || 0) },
    "Run Key": richText(runKey),
    Status: { select: { name: "New" } },
    ...(applyLink ? { "Apply Link": { url: applyLink } } : {}),
    ...(jobLink ? { "Job Link": { url: jobLink } } : {}),
    "Source Query": richText((job.sourceQueries || []).join(", ")),
    "Last Seen": { date: { start: finishedAt } },
  };
}

async function writeNotionResults({ startedAt, finishedAt, location, targets, jobs, uniqueJobs, errors, sourceStats, sourceMode }) {
  if (!process.env.NOTION_TOKEN) {
    return { skipped: true, reason: "Missing NOTION_TOKEN" };
  }

  const parentPageId = process.env.NOTION_WEEKLY_JOBS_PAGE_ID || DEFAULT_NOTION_PAGE_ID;
  const runKey = getRunKey(startedAt);
  const runsDatabaseId = await ensureDatabase({
    parentPageId,
    envId: "NOTION_RUNS_DATABASE_ID",
    title: RUNS_DATABASE_TITLE,
    properties: {
      "Run Key": { title: {} },
      "Run Date": { date: {} },
      "Run Week": { rich_text: {} },
      Source: { rich_text: {} },
      Status: { select: {} },
      Location: { rich_text: {} },
      "Target Roles": { number: {} },
      "Total Fetched": { number: {} },
      "Total Unique": { number: {} },
      Errors: { rich_text: {} },
      "Started At": { date: {} },
      "Finished At": { date: {} },
    },
  });
  const jobsDatabaseId = await ensureDatabase({
    parentPageId,
    envId: "NOTION_JOBS_DATABASE_ID",
    title: JOBS_DATABASE_TITLE,
    properties: {
      Job: { title: {} },
      "Job Key": { rich_text: {} },
      Company: { rich_text: {} },
      Location: { rich_text: {} },
      Source: { multi_select: {} },
      "Role Cluster": { select: {} },
      "Target Role": { rich_text: {} },
      "Posted Date": { date: {} },
      "Deadline Date": { date: {} },
      "Relevance Score": { number: {} },
      "Run Key": { rich_text: {} },
      Status: { select: {} },
      "Apply Link": { url: {} },
      "Job Link": { url: {} },
      "Source Query": { rich_text: {} },
      "Last Seen": { date: {} },
    },
  });

  const run = await upsertPage({
    databaseId: runsDatabaseId,
    filter: { property: "Run Key", title: { equals: runKey } },
    icon: { type: "emoji", emoji: "🔎" },
    properties: buildRunProperties({ runKey, startedAt, finishedAt, location, targets, jobs, uniqueJobs, errors, sourceStats, sourceMode }),
  });

  const jobResults = [];
  for (const job of sortJobs(uniqueJobs).slice(0, Number(process.env.NOTION_MAX_JOB_ROWS || 100))) {
    const key = jobKey(job);
    const result = await upsertPage({
      databaseId: jobsDatabaseId,
      filter: { property: "Job Key", rich_text: { equals: key } },
      icon: { type: "emoji", emoji: "💼" },
      properties: buildJobProperties(job, runKey, finishedAt),
    });
    jobResults.push(result);
  }

  return {
    runKey,
    sourceMode,
    runsDatabaseId,
    jobsDatabaseId,
    runPageId: run.pageId,
    runUrl: run.url,
    runAction: run.action,
    jobRowsCreated: jobResults.filter((result) => result.action === "created").length,
    jobRowsUpdated: jobResults.filter((result) => result.action === "updated").length,
    jobRowsTouched: jobResults.length,
  };
}

function getSelectedTargets(req) {
  const allTargets = flattenTargetRoles();
  const queryLimit = Number(req.query.limit || process.env.WEEKLY_TARGET_ROLE_LIMIT || 0);
  const offset = Number(req.query.offset || process.env.WEEKLY_TARGET_ROLE_OFFSET || 0);
  const cluster = cleanText(req.query.cluster || process.env.WEEKLY_TARGET_CLUSTER);
  const filtered = cluster
    ? allTargets.filter((target) => target.cluster.toLowerCase() === cluster.toLowerCase())
    : allTargets;
  return queryLimit > 0 ? filtered.slice(offset, offset + queryLimit) : filtered.slice(offset);
}

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  const auth = req.headers.authorization || "";
  const querySecret = req.query.secret || "";
  return auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET;
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const startedAt = new Date().toISOString();
  const runId = getRunId();
  const runKey = getRunKey(startedAt);
  const sourceMode = getSourceMode(req);
  const location = cleanText(req.query.location || req.body?.location || process.env.WEEKLY_SEARCH_LOCATION || DEFAULT_LOCATION);
  const targets = getSelectedTargets(req);
  const selectedSources = sourceUrls(req, sourceMode);

  if (req.query.dryRun === "1" || req.query.dryRun === "true") {
    return res.status(200).json({
      runId,
      runKey,
      sourceMode,
      dryRun: true,
      location,
      targetRolesSearched: targets.length,
      targets,
      sources: selectedSources,
      notionParentPageId: process.env.NOTION_WEEKLY_JOBS_PAGE_ID || DEFAULT_NOTION_PAGE_ID,
      notionDatabases: {
        runs: process.env.NOTION_RUNS_DATABASE_ID || RUNS_DATABASE_TITLE,
        jobs: process.env.NOTION_JOBS_DATABASE_ID || JOBS_DATABASE_TITLE,
      },
      schedule: "0 9 * * 0",
    });
  }

  const errors = [];
  const jobs = [];
  const sourceStats = selectedSources.map((source) => ({ source: source.source, successes: 0, failures: 0, jobs: 0 }));

  for (const target of targets) {
    const plannedSources = plannedSourcesFor(req, target, location, sourceMode);
    const results = await Promise.allSettled(plannedSources.map((source) => source.run()));

    for (const [index, result] of results.entries()) {
      const plannedSource = plannedSources[index].source;
      if (result.status === "fulfilled") {
        const sourceResult = result.value;
        const stat = sourceStats.find((item) => item.source === sourceResult.source);
        stat.successes += 1;
        stat.jobs += sourceResult.jobs.length;
        jobs.push(...sourceResult.jobs);
      } else {
        const message = result.reason?.message || "Unknown error";
        const stat = sourceStats.find((item) => item.source === plannedSource);
        stat.failures += 1;
        errors.push({ source: plannedSource, targetRole: target.targetRole, message });
      }
    }
  }

  const uniqueJobs = dedupeJobs(jobs).filter(isWithinLast7Days);
  const sortedJobs = sortJobs(uniqueJobs);
  const finishedAt = new Date().toISOString();

  let notion = null;
  try {
    notion = await writeNotionResults({
      startedAt,
      finishedAt,
      location,
      targets,
      jobs,
      uniqueJobs: sortedJobs,
      errors,
      sourceStats,
      sourceMode,
    });
  } catch (error) {
    notion = { error: error.message };
  }

  return res.status(200).json({
    runId,
    runKey,
    sourceMode,
    location,
    startedAt,
    finishedAt,
    targetRolesSearched: targets.length,
    totalReturned: jobs.length,
    totalUniqueLast7Days: sortedJobs.length,
    sourceStats,
    errors,
    notion,
    topJobs: sortedJobs.slice(0, 20),
  });
}
