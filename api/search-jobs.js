import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STATIC_ROLE_EXPANSIONS = {
  "sox": ["SOX Manager", "SOX Compliance Manager", "SOX Controls Manager", "Internal Controls Manager", "IT Controls Manager", "Technology Controls Manager", "ITGC Manager", "SOX ITGC", "Financial Controls Manager", "Internal Audit SOX"],
  "it sox": ["IT SOX Manager", "SOX ITGC Manager", "IT General Controls", "ITGC", "IT Controls Manager", "Technology Controls Manager", "SOX Compliance Manager", "Internal Controls Technology", "IT Audit SOX", "Technology Risk Controls"],
  "it auditor": ["IT Auditor", "Senior IT Auditor", "Technology Auditor", "IT Audit Manager", "Technology Audit Manager", "IT Risk Auditor", "Internal Audit Technology", "Technology Risk Assurance"],
  "ai governance": ["AI Governance Manager", "Responsible AI Manager", "AI Risk Manager", "AI Compliance Manager", "AI Assurance Manager", "Model Risk Manager", "AI Policy Manager", "AI Risk Management", "Responsible AI Lead"]
};

function formatDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function relativeToDate(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return "";

  const now = new Date();
  const date = new Date(now);

  if (text.includes("today") || text.includes("hour") || text.includes("minute") || text.includes("just now")) {
    return formatDate(date);
  }

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
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });
    const aiExpansions = JSON.parse(response.choices[0].message.content);
    return [...new Set([cleanRole, ...staticExpansions, ...aiExpansions])].slice(0, 12);
  } catch {
    return [...new Set([cleanRole, ...staticExpansions])].slice(0, 12);
  }
}

function postedWithin7Days(posted) {
  const text = String(posted || "").toLowerCase();
  if (!text) return true;
  if (text.includes("today") || text.includes("hour") || text.includes("minute") || text.includes("just now")) return true;

  const dayMatch = text.match(/(\d+)\s+day/);
  if (dayMatch) return Number(dayMatch[1]) <= 7;

  return false;
}

function normaliseJob(job, sourceQuery) {
  const apply = job.apply_options?.[0] || {};
  const postedRaw = job.detected_extensions?.posted_at || job.extensions?.find((x) => String(x).toLowerCase().includes("ago")) || "";

  return {
    role: job.title || "",
    company: job.company_name || "",
    location: job.location || "",
    postedDate: relativeToDate(postedRaw) || postedRaw,
    deadlineDate: relativeToDate(job.detected_extensions?.deadline || "") || job.detected_extensions?.deadline || job.deadline || "",
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
    const expandedRoles = await expandRole(role);
    const searchLocation = location || "London";
    let allJobs = [];

    for (const query of expandedRoles) {
      const params = new URLSearchParams({
        engine: "google_jobs",
        q: query,
        location: searchLocation,
        hl: "en",
        gl: "uk",
        api_key: process.env.SERPAPI_KEY,
      });

      const response = await fetch(`https://serpapi.com/search.json?${params}`);
      const data = await response.json();
      const jobs = (data.jobs_results || []).map((job) => normaliseJob(job, query));
      allJobs.push(...jobs);
    }

    const unique = dedupeJobs(allJobs).filter((job) => postedWithin7Days(job.postedDate));

    return res.status(200).json({
      jobs: unique.slice(0, 30),
      expandedRoles,
      totalFetched: allJobs.length,
      totalUnique: unique.length,
      filter: "last 7 days based on posted field where available",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
