'use client'
import { useState, useRef } from 'react'

type StepStatus = 'idle' | 'running' | 'done' | 'error'

interface Step {
  status: StepStatus
  msg: string
}

interface Steps {
  scrape: Step
  analyze: Step
  generate: Step
  github: Step
  vercel: Step
}

const initialSteps: Steps = {
  scrape:   { status: 'idle', msg: 'Crawl all pages with Apify' },
  analyze:  { status: 'idle', msg: 'Map routes and site structure' },
  generate: { status: 'idle', msg: 'Generate Next.js components with Claude' },
  github:   { status: 'idle', msg: 'Create repo and push files' },
  vercel:   { status: 'idle', msg: 'Deploy to Vercel' },
}

const stepLabels: Record<keyof Steps, string> = {
  scrape: 'Scrape with Apify',
  analyze: 'Analyze structure',
  generate: 'Generate Next.js',
  github: 'Push to GitHub',
  vercel: 'Deploy to Vercel',
}

export default function Home() {
  const [url, setUrl] = useState('https://thebianchilawgroup.com')
  const [apifyKey, setApifyKey] = useState('')
  const [githubKey, setGithubKey] = useState('')
  const [vercelKey, setVercelKey] = useState('')
  const [githubUser, setGithubUser] = useState('')
  const [repoName, setRepoName] = useState('')
  const [maxPages, setMaxPages] = useState(50)
  const [steps, setSteps] = useState<Steps>(initialSteps)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ liveUrl: string; repoUrl: string; fileCount: number; pageCount: number } | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [keysOpen, setKeysOpen] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = (msg: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`
    setLogs(prev => [...prev, line])
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, 50)
  }

  const setStep = (step: keyof Steps, status: StepStatus, msg: string) => {
    setSteps(prev => ({ ...prev, [step]: { status, msg } }))
  }

  const clone = async () => {
    if (!url || !apifyKey || !githubKey || !vercelKey || !githubUser) {
      alert('Please fill in all API keys and your GitHub username.')
      return
    }
    setRunning(true)
    setResult(null)
    setLogs([])
    setSteps(initialSteps)
    addLog('Starting clone pipeline...')

    try {
      const resp = await fetch('/api/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, apifyKey, githubKey, vercelKey, githubUser, repoName, maxPages })
      })

      if (!resp.body) throw new Error('No response body')
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            addLog(data.msg || data.step)
            if (data.step === 'error') {
              setStep('scrape', 'error', data.msg)
              addLog('ERROR: ' + data.msg)
            } else if (data.step === 'complete') {
              setResult({ liveUrl: data.liveUrl, repoUrl: data.repoUrl, fileCount: data.fileCount, pageCount: data.pageCount })
            } else if (data.step in steps) {
              setStep(data.step as keyof Steps, data.status, data.msg)
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      addLog('Fatal error: ' + message)
    } finally {
      setRunning(false)
    }
  }

  const iconFor = (status: StepStatus, num: number) => {
    if (status === 'done') return { symbol: '✓', bg: '#EAF3DE', color: '#3B6D11' }
    if (status === 'error') return { symbol: '✕', bg: '#FCEBEB', color: '#A32D2D' }
    if (status === 'running') return { symbol: '◌', bg: '#E6F1FB', color: '#185FA5' }
    return { symbol: String(num), bg: '#f0f0f0', color: '#888' }
  }

  return (
    <main style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Site Cloner</h1>
        <p style={{ color: '#666', fontSize: 14 }}>Scrape any site → generate Next.js → push to GitHub → deploy to Vercel</p>
      </div>

      {/* Target URL */}
      <div style={cardStyle}>
        <div style={labelStyle}>Target URL</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={clone}
            disabled={running}
            style={{ ...btnStyle, opacity: running ? 0.5 : 1, cursor: running ? 'not-allowed' : 'pointer' }}
          >
            {running ? 'Running...' : 'Clone site →'}
          </button>
        </div>
      </div>

      {/* API Keys */}
      <div style={cardStyle}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setKeysOpen(!keysOpen)}
        >
          <div style={labelStyle}>API Keys</div>
          <span style={{ fontSize: 12, color: '#888' }}>{keysOpen ? '▼' : '▶'}</span>
        </div>
        {keysOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            {[
              { label: 'Apify token', val: apifyKey, set: setApifyKey, ph: 'apify_api_...' },
              { label: 'GitHub PAT', val: githubKey, set: setGithubKey, ph: 'ghp_...' },
              { label: 'Vercel token', val: vercelKey, set: setVercelKey, ph: 'vercel token...' },
              { label: 'GitHub username', val: githubUser, set: setGithubUser, ph: 'your-username' },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{f.label}</div>
                <input
                  type={f.label.includes('token') || f.label.includes('PAT') ? 'password' : 'text'}
                  value={f.val}
                  onChange={e => f.set(e.target.value)}
                  placeholder={f.ph}
                  style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Options */}
      <div style={cardStyle}>
        <div style={labelStyle}>Options</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Max pages</div>
            <input type="number" value={maxPages} onChange={e => setMaxPages(Number(e.target.value))} min={1} max={200} style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Repo name (optional)</div>
            <input value={repoName} onChange={e => setRepoName(e.target.value)} placeholder="auto from URL" style={{ ...inputStyle, width: '100%' }} />
          </div>
        </div>
      </div>

      {/* Pipeline */}
      <div style={cardStyle}>
        <div style={labelStyle}>Pipeline</div>
        <div style={{ marginTop: 8 }}>
          {(Object.entries(steps) as [keyof Steps, Step][]).map(([key, step], i) => {
            const icon = iconFor(step.status, i + 1)
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: i < 4 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: icon.bg, color: icon.color, fontSize: 12, fontWeight: 600, flexShrink: 0,
                  animation: step.status === 'running' ? 'pulse 1.5s infinite' : 'none'
                }}>
                  {icon.symbol}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#111' }}>{stepLabels[key]}</div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{step.msg}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div style={{ ...cardStyle, background: '#EAF3DE', border: '1px solid #C0DD97' }}>
          <div style={{ fontSize: 13, color: '#3B6D11', fontWeight: 600, marginBottom: 8 }}>✓ Clone complete</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href={result.liveUrl} target="_blank" rel="noreferrer" style={linkStyle}>Live site →</a>
            <a href={result.repoUrl} target="_blank" rel="noreferrer" style={linkStyle}>GitHub repo →</a>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            {[['Pages', result.pageCount], ['Files', result.fileCount]].map(([label, val]) => (
              <div key={label as string} style={{ fontSize: 13, color: '#3B6D11' }}>
                <strong>{val}</strong> {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log */}
      {logs.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Console log</div>
          <div ref={logRef} style={{ background: '#f8f8f8', borderRadius: 8, padding: '10px 12px', maxHeight: 160, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, color: '#444', lineHeight: 1.7 }}>
            {logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </main>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12,
  padding: '1.25rem', marginBottom: '1rem'
}
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 10
}
const inputStyle: React.CSSProperties = {
  fontSize: 14, padding: '0 12px', height: 36, borderRadius: 8,
  border: '1px solid #e0e0e0', background: '#fafafa', outline: 'none', boxSizing: 'border-box'
}
const btnStyle: React.CSSProperties = {
  height: 36, padding: '0 18px', background: '#111', color: '#fff',
  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap'
}
const linkStyle: React.CSSProperties = {
  fontSize: 14, color: '#185FA5', textDecoration: 'none', fontWeight: 500
}
