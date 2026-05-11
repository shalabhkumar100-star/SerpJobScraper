import { flattenTargetRoles, TARGET_ROLE_CLUSTERS } from "../config/targetRoles.js";

export const config = {
  maxDuration: 300,
};

const DEFAULT_LOCATION = "London, UK";
const DEFAULT_NOTION_PAGE_ID = "35be4d9f-8fde-819d-9276-e5794940c9ca";
const DEFAULT_APIFY_SOURCE_URL = "https://shalabhkumar100-star-jobscraper.vercel.app/api/search-jobs";

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

function isWithinLast7Days(job) {
  const posted = parseDate(job.postedDate || job.posted);
  if (!posted) return true;
  return posted >= addDays(new Date(), -7);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function jobKey(job) {
  const link = cleanText(job.applyLink || job.jobLink).toLowerCase();
  if (link) return `link:${link}`;
  return [
    cleanText(job.role).toLowerCase(),
    cleanText(job.company).toLowerCase(),
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

function roleAlignmentScore(job) {
  const text = `${job.role || ""} ${job.description || ""}`.toLowerCase();
  const terms = [
    job.targetRole,
    ...(job.targetSearchTerms || []),
    job.roleCluster,
  ]
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
    sources: [cleanText(job.source || source)],
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
      throw new Error(data.error || `HTTP ${response.status}`);
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
    source: "SerpAPI / Google Jobs",
    jobs: (data.jobs || []).map((job) => normaliseSourceJob(job, "SerpAPI / Google Jobs", target)),
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
    source: "LinkedIn / Apify",
    jobs: (data.jobs || []).map((job) => normaliseSourceJob(job, "LinkedIn / Apify", target)),
    meta: data,
  };
}

function notionText(text, link) {
  const content = String(text || "").slice(0, 1900) || " ";
  return {
    type: "text",
    text: link ? { content, link: { url: link } } : { content },
  };
}

function paragraph(text) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: [notionText(text)] } };
}

function heading(text, level = 2) {
  const type = level === 3 ? "heading_3" : "heading_2";
  return { object: "block", type, [type]: { rich_text: [notionText(text)] } };
}

function bullet(text) {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: [notionText(text)] } };
}

function jobBlock(job, index) {
  const title = `${index}. ${job.role || "Untitled role"} - ${job.company || "Unknown company"}`;
  const link = job.applyLink || job.jobLink || undefined;
  const details = [
    job.location && `Location: ${job.location}`,
    job.postedDate && `Posted: ${job.postedDate}`,
    job.deadlineDate && `Deadline: ${job.deadlineDate}`,
    job.roleCluster && `Cluster: ${job.roleCluster}`,
    job.targetRole && `Target role: ${job.targetRole}`,
    job.sources?.length && `Sources: ${job.sources.join(", ")}`,
    job.sourceQueries?.length && `Queries: ${job.sourceQueries.join(", ")}`,
    Number.isFinite(job.relevanceScore) && `Relevance score: ${job.relevanceScore}`,
  ].filter(Boolean).join(" | ");

  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [notionText(title, link), notionText(details ? `\n${details}` : "")],
    },
  };
}

function buildNotionBlocks({ startedAt, finishedAt, location, targets, jobs, errors, sourceStats }) {
  const topJobs = sortJobs(jobs).slice(0, Number(process.env.NOTION_TOP_JOBS || 20));
  const clusterCounts = TARGET_ROLE_CLUSTERS.map((cluster) => {
    const count = jobs.filter((job) => job.roleCluster === cluster.cluster).length;
    return `${cluster.cluster}: ${count}`;
  });

  return [
    paragraph(`Run window: last 7 days. Location: ${location}. Started: ${startedAt}. Finished: ${finishedAt}.`),
    heading("Summary"),
    bullet(`Target roles searched: ${targets.length}`),
    bullet(`Unique opportunities found: ${jobs.length}`),
    bullet(`Top jobs shown: ${topJobs.length}`),
    ...clusterCounts.map(bullet),
    heading("Source Health"),
    ...sourceStats.map((stat) => bullet(`${stat.source}: ${stat.successes} successful role searches, ${stat.failures} failed role searches, ${stat.jobs} jobs returned before final dedupe.`)),
    ...(errors.length ? [heading("Errors"), ...errors.slice(0, 25).map((error) => bullet(`${error.source} | ${error.targetRole}: ${error.message}`))] : [heading("Errors"), paragraph("No source errors recorded.")]),
    heading("Top Opportunities"),
    ...(topJobs.length ? topJobs.map((job, index) => jobBlock(job, index + 1)) : [paragraph("No opportunities were returned for this run.")]),
  ];
}

async function createNotionRunPage({ startedAt, finishedAt, location, targets, jobs, errors, sourceStats }) {
  if (!process.env.NOTION_TOKEN) {
    return { skipped: true, reason: "Missing NOTION_TOKEN" };
  }

  const parentPageId = process.env.NOTION_WEEKLY_JOBS_PAGE_ID || DEFAULT_NOTION_PAGE_ID;
  const title = `Job Opportunities Run - ${new Date(startedAt).toISOString().slice(0, 10)}`;
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      icon: { type: "emoji", emoji: "🔎" },
      properties: {
        title: [{ type: "text", text: { content: title } }],
      },
      children: buildNotionBlocks({ startedAt, finishedAt, location, targets, jobs, errors, sourceStats }).slice(0, 95),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Notion page creation failed");
  }

  return { pageId: data.id, url: data.url };
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
  const location = cleanText(req.query.location || req.body?.location || process.env.WEEKLY_SEARCH_LOCATION || DEFAULT_LOCATION);
  const targets = getSelectedTargets(req);

  if (req.query.dryRun === "1" || req.query.dryRun === "true") {
    return res.status(200).json({
      runId,
      dryRun: true,
      location,
      targetRolesSearched: targets.length,
      targets,
      sources: [
        process.env.SERP_SOURCE_URL || `${getBaseUrl(req)}/api/search-jobs`,
        process.env.APIFY_SOURCE_URL || DEFAULT_APIFY_SOURCE_URL,
      ],
      notionParentPageId: process.env.NOTION_WEEKLY_JOBS_PAGE_ID || DEFAULT_NOTION_PAGE_ID,
      schedule: "0 9 * * 0",
    });
  }

  const errors = [];
  const jobs = [];
  const sourceStats = [
    { source: "SerpAPI / Google Jobs", successes: 0, failures: 0, jobs: 0 },
    { source: "LinkedIn / Apify", successes: 0, failures: 0, jobs: 0 },
  ];

  for (const target of targets) {
    const plannedSources = [
      { source: "SerpAPI / Google Jobs", run: () => runSerpSearch(req, target, location) },
      { source: "LinkedIn / Apify", run: () => runApifySearch(target, location) },
    ];
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
    notion = await createNotionRunPage({
      startedAt,
      finishedAt,
      location,
      targets,
      jobs: sortedJobs,
      errors,
      sourceStats,
    });
  } catch (error) {
    notion = { error: error.message };
  }

  return res.status(200).json({
    runId,
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
