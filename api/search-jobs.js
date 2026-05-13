import OpenAI from "openai";
import { flattenTargetRoles } from "../config/targetRoles.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TARGET_ROLE_EXPANSIONS = Object.fromEntries(
  flattenTargetRoles().map((role) => [
    role.targetRole.toLowerCase(),
    role.searchTerms,
  ]),
);

const STATIC_ROLE_EXPANSIONS = {
  ...TARGET_ROLE_EXPANSIONS,
  "sox": ["SOX Manager", "SOX Compliance Manager", "SOX Controls Manager", "Internal Controls Manager", "IT Controls Manager", "Technology Controls Manager", "ITGC Manager", "SOX ITGC", "Financial Controls Manager", "Internal Audit SOX"],
  "it sox": ["IT SOX Manager", "SOX ITGC Manager", "IT General Controls", "ITGC", "IT Controls Manager", "Technology Controls Manager", "SOX Compliance Manager", "Internal Controls Technology", "IT Audit SOX", "Technology Risk Controls"],
  "it auditor": ["IT Auditor", "Senior IT Auditor", "Technology Auditor", "IT Audit Manager", "Technology Audit Manager", "IT Risk Auditor", "Internal Audit Technology", "Technology Risk Assurance"],
  "ai governance": ["AI Governance Manager", "Responsible AI Manager", "AI Risk Manager", "AI Compliance Manager", "AI Assurance Manager", "Model Risk Manager", "AI Policy Manager", "AI Risk Management", "Responsible AI Lead"]
};

function formatDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function normaliseSerpLocation(value) {
  const text = String(value || "London").trim();
  if (/^london\s*,\s*uk$/i.test(text)) return "London";
  if (/^london\s*,\s*united kingdom$/i.test(text)) return "London";
  return text || "London";
}

function relativeToDate(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return "";
  const now = new Date();
  const date = new Date(now);
  if (text.includes("today") || text.includes("hour") || text.includes("minute") || text.includes("just now")) return formatDate(date);
  const dayMatch = text.match(/(\d+)\s+day/);
  if (dayMatch) {
    date.setDate(now.getDate() - Number(dayMatch[1]));
    return formatDate(date);
  }
  const weekMatch = text.match(/(\d+)\s+week/);
  if (weekMatch) {
    date.setDate(now.getDate() - Number(weekMatch[1]) * 7);
    return formatDate(date);
  }
  return "";
}

async function expandRole(role) {
  const cleanRole = String(role || "").trim();
  const key = cleanRole.toLowerCase();
  const staticExpansions = STATIC_ROLE_EXPANSIONS[key] || [];
  const prompt = `Expand this job search term into 8-12 real job titles and search phrases used in job listings. Return ONLY a JSON array of strings. Search term: ${cleanRole}`;
  try {
    const response = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.2 });
    const aiExpansions = JSON.parse(response.choices[0].message.content);
    return [...new Set([cleanRole, ...staticExpansions, ...aiExpansions])].slice(0, 12);
  } catch {
    return [...new Set([cleanRole, ...staticExpansions])].slice(0, 12);
  }
}

function findPostedRaw(job) {
  const candidates = [
    job.detected_extensions?.posted_at,
    job.detected_extensions?.postedAt,
    job.detected_extensions?.date_posted,
    job.detected_extensions?.date,
    job.extensions?.find((x) => /ago|today|hour|minute|day|week/i.test(String(x))),
    job.description?.match(/(?:posted|listed)\s+((?:\d+\s+)?(?:hour|hours|day|days|week|weeks)\s+ago|today)/i)?.[1],
  ];
  return candidates.find(Boolean) || "";
}

function postedWithin7Days(postedRaw) {
  const text = String(postedRaw || "").toLowerCase();
  if (!text) return true;
  if (text.includes("today") || text.includes("hour") || text.includes("minute") || text.includes("just now")) return true;
  const dayMatch = text.match(/(\d+)\s+day/);
  if (dayMatch) return Number(dayMatch[1]) <= 7;
  const weekMatch = text.match(/(\d+)\s+week/);
  if (weekMatch) return Number(weekMatch[1]) <= 1;
  return true;
}

function normaliseJob(job, sourceQuery) {
  const apply = job.apply_options?.[0] || {};
  const postedRaw = findPostedRaw(job);
  const deadlineRaw = job.detected_extensions?.deadline || job.detected_extensions?.apply_by || job.deadline || "";
  return {
    role: job.title || "",
    company: job.company_name || "",
    location: job.location || "",
    source: "SerpAPI / Google Jobs",
    posted: postedRaw,
    postedDate: relativeToDate(postedRaw) || "",
    deadline: deadlineRaw,
    deadlineDate: relativeToDate(deadlineRaw) || deadlineRaw || "",
    applyLink: apply.link || job.share_link || "",
    jobLink: job.share_link || "",
    description: job.description || "",
    sourceQuery,
  };
}

function dedupeJobs(jobs) {
  const seen = new Map();
  for (const job of jobs) {
    const key = `${job.role}|${job.company}|${job.location}`.toLowerCase();
    if (!seen.has(key)) seen.set(key, job);
  }
  return Array.from(seen.values());
}

export default async function handler(req, res) {
  const { role, location } = req.query;
  if (!role) return res.status(400).json({ error: "Role required" });
  if (!process.env.SERPAPI_KEY) return res.status(500).json({ error: "Missing SERPAPI_KEY" });
  try {
    const shouldExpand = !["0", "false", "no"].includes(String(req.query.expand || "1").toLowerCase());
    const maxQueries = Number(req.query.maxQueries || 12);
    const expandedRoles = (shouldExpand ? await expandRole(role) : [String(role).trim()]).slice(0, maxQueries);
    const searchLocation = normaliseSerpLocation(location);
    let allJobs = [];
    const diagnostics = [];

    for (const query of expandedRoles) {
      const params = new URLSearchParams({ engine: "google_jobs", q: query, location: searchLocation, hl: "en", gl: "uk", api_key: process.env.SERPAPI_KEY });
      const response = await fetch(`https://serpapi.com/search.json?${params}`);
      const data = await response.json();
      const jobsResults = data.jobs_results || [];
      diagnostics.push({
        query,
        location: searchLocation,
        status: response.status,
        error: data.error || "",
        searchMetadataStatus: data.search_metadata?.status || "",
        jobsResults: jobsResults.length,
      });
      if (!response.ok || data.error) continue;
      const jobs = jobsResults.map((job) => normaliseJob(job, query));
      allJobs.push(...jobs);
    }

    const unique = dedupeJobs(allJobs).filter((job) => postedWithin7Days(job.posted));
    return res.status(200).json({
      jobs: unique.slice(0, 30),
      expandedRoles,
      totalFetched: allJobs.length,
      totalUnique: unique.length,
      diagnostics,
      filter: "last 7 days where posted metadata is available; blank when Google Jobs does not expose posting age",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
