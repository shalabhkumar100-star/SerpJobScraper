export default async function handler(req, res) {
  const { role, location } = req.query

  const params = new URLSearchParams({
    engine: 'google_jobs',
    q: `${role} ${location}`,
    api_key: process.env.SERPAPI_KEY
  })

  try {
    const response = await fetch(`https://serpapi.com/search.json?${params}`)
    const data = await response.json()

    const jobs = (data.jobs_results || []).map(j => ({
      title: j.title,
      company: j.company_name,
      location: j.location,
      link: j.related_links?.[0]?.link || '#'
    }))

    res.status(200).json({ jobs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
