import { useState } from 'react'

export default function App() {
  const [role, setRole] = useState('')
  const [location, setLocation] = useState('')
  const [jobs, setJobs] = useState([])

  const searchJobs = async () => {
    const res = await fetch(`/api/search-jobs?role=${role}&location=${location}`)
    const data = await res.json()
    setJobs(data.jobs || [])
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Job Search Engine (SerpAPI)</h1>
      <input placeholder="Role" value={role} onChange={e => setRole(e.target.value)} />
      <input placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} />
      <button onClick={searchJobs}>Search</button>

      <table border="1" cellPadding="8" style={{ marginTop: 20 }}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Company</th>
            <th>Location</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job, i) => (
            <tr key={i}>
              <td>{job.title}</td>
              <td>{job.company}</td>
              <td>{job.location}</td>
              <td><a href={job.link} target="_blank">Apply</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
