import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function expandRole(role) {
  const prompt = `Expand this job role into 5-8 real job titles used in job listings. Return ONLY a JSON array.

Role: ${role}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch {
    return [role];
  }
}

function normaliseJob(job) {
  const apply = job.apply_options?.[0] || {};

  return {
    role: job.title || "",
    company: job.company_name || "",
    location: job.location || "",
    posted: job.detected_extensions?.posted_at || "",
    applyLink: apply.link || job.share_link || "",
    description: job.description || "",
  };
}

export default async function handler(req, res) {
  const { role, location } = req.query;

  if (!role) {
    return res.status(400).json({ error: "Role required" });
  }

  try {
    const expandedRoles = await expandRole(role);

    let allJobs = [];

    for (const r of expandedRoles) {
      const params = new URLSearchParams({
        engine: "google_jobs",
        q: `${r} ${location || "London"}`,
        api_key: process.env.SERPAPI_KEY,
      });

      const response = await fetch(`https://serpapi.com/search.json?${params}`);
      const data = await response.json();

      const jobs = (data.jobs_results || []).map(normaliseJob);
      allJobs.push(...jobs);
    }

    const unique = Array.from(
      new Map(allJobs.map(j => [j.applyLink, j])).values()
    );

    return res.status(200).json({ jobs: unique.slice(0, 15), expandedRoles });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
