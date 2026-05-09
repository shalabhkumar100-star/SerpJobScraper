import { useState } from 'react'

export default function App() {
  const [role, setRole] = useState('')
  const [location, setLocation] = useState('London')
  const [jobs, setJobs] = useState([])
  const [expandedRoles, setExpandedRoles] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const searchJobs = async () => {
    if (!role.trim()) {
      setError('Please enter a role')
      return
    }

    setLoading(true)
    setError('')
    setJobs([])
    setExpandedRoles([])
    setMeta(null)

    try {
      const params = new URLSearchParams({ role, location })
      const res = await fetch(`/api/search-jobs?${params.toString()}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Search failed')
      }

      setJobs(data.jobs || [])
      setExpandedRoles(data.expandedRoles || [])
      setMeta({
        totalFetched: data.totalFetched,
        totalUnique: data.totalUnique,
        filter: data.filter,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'Arial, sans-serif', maxWidth: 1300, margin: '0 auto' }}>
      <h1>Job Search Engine (SerpAPI)</h1>
      <p>Search Google Jobs via SerpAPI. Niche roles are expanded with OpenAI before search.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Role e.g. AI Governance"
          value={role}
          onChange={e => setRole(e.target.value)}
          style={{ padding: 10, flex: 1 }}
        />
        <input
          placeholder="Location e.g. London"
          value={location}
          onChange={e => setLocation(e.target.value)}
          style={{ padding: 10, flex: 1 }}
        />
        <button onClick={searchJobs} disabled={loading} style={{ padding: '10px 16px' }}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && <div style={{ color: 'red', marginBottom: 16 }}>Error: {error}</div>}

      {meta && (
        <div style={{ marginBottom: 16, padding: 12, background: '#f4f4f4', borderRadius: 6 }}>
          <div><strong>Total fetched:</strong> {meta.totalFetched ?? '-'}</div>
          <div><strong>Total unique:</strong> {meta.totalUnique ?? '-'}</div>
          <div><strong>Filter:</strong> {meta.filter || '-'}</div>
        </div>
      )}

      {expandedRoles.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <strong>Expanded searches:</strong> {expandedRoles.join(', ')}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table border="1" cellPadding="8" style={{ marginTop: 20, width: '100%', minWidth: 1100, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Role</th>
              <th align="left">Company</th>
              <th align="left">Location</th>
              <th align="left">Posted Date</th>
              <th align="left">Deadline</th>
              <th align="left">Source Query</th>
              <th align="left">Links</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, i) => (
              <tr key={`${job.applyLink || job.jobLink || i}-${i}`}>
                <td>{job.role || job.title}</td>
                <td>{job.company}</td>
                <td>{job.location}</td>
                <td>{job.postedDate || job.posted || '-'}</td>
                <td>{job.deadlineDate || job.deadline || '-'}</td>
                <td>{job.sourceQuery || '-'}</td>
                <td>
                  <a href={job.applyLink || job.jobLink || '#'} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
