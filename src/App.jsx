import { useEffect, useRef, useState } from 'react'
import { ACCEPT, loadBundledWorkbooks, loadFile } from './loader.js'
import SheetView from './SheetView.jsx'

export default function App() {
  const [workbooks, setWorkbooks] = useState([])
  const [active, setActive] = useState(null) // { wb, sheet } indexes by id/name
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState(() => readStored(SIDEBAR_KEY) === 'collapsed')
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadBundledWorkbooks()
      .then((wbs) => !cancelled && addWorkbooks(wbs))
      .catch((e) => !cancelled && setError(`Could not load bundled spreadsheets: ${e.message}`))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  function addWorkbooks(wbs) {
    const valid = wbs.filter((wb) => wb.sheets.length)
    if (!valid.length) return
    setWorkbooks((prev) => [...prev, ...valid])
    setActive((cur) => cur ?? { wb: valid[0].id, sheet: valid[0].sheets[0].name })
  }

  async function handleFiles(fileList) {
    setError('')
    const files = [...fileList]
    const results = await Promise.allSettled(files.map(loadFile))
    const failed = files.filter((_, i) => results[i].status === 'rejected').map((f) => f.name)
    const loaded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
    addWorkbooks(loaded)
    if (loaded.length) setActive({ wb: loaded[0].id, sheet: loaded[0].sheets[0]?.name })
    if (failed.length) setError(`Could not read: ${failed.join(', ')}`)
  }

  function removeWorkbook(id) {
    const next = workbooks.filter((w) => w.id !== id)
    setWorkbooks(next)
    if (active?.wb === id) setActive(next[0] ? { wb: next[0].id, sheet: next[0].sheets[0].name } : null)
  }

  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    writeStored(SIDEBAR_KEY, next ? 'collapsed' : 'open')
  }

  const wb = workbooks.find((w) => w.id === active?.wb)
  const sheet = wb?.sheets.find((s) => s.name === active?.sheet)
  const totalRows = workbooks.reduce((n, w) => n + w.sheets.reduce((m, s) => m + s.rows.length, 0), 0)

  return (
    <div
      className={`app ${collapsed ? 'sidebar-collapsed' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      <aside className="sidebar">
        <div className="brand">
          {!collapsed && (
            <>
              <span className="brand-mark">▦</span>
              <div className="brand-text">
                <div className="brand-name">Review Tool</div>
                <div className="brand-sub">
                  {workbooks.length} file{workbooks.length === 1 ? '' : 's'} · {totalRows.toLocaleString()} rows
                </div>
              </div>
            </>
          )}
          <button
            className="collapse-btn"
            onClick={toggleSidebar}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            <SidebarIcon />
          </button>
        </div>

        <button
          className={`btn btn-primary ${collapsed ? 'btn-icon' : 'btn-block'}`}
          onClick={() => inputRef.current?.click()}
          title="Add spreadsheet"
        >
          {collapsed ? '+' : '+ Add spreadsheet'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />

        {!collapsed && (
          <nav className="file-list">
            {workbooks.map((w) => (
              <div key={w.id} className="file">
                <div className="file-head">
                  <span className="file-name" title={w.name}>
                    {w.name}
                  </span>
                  <button className="icon-btn" title="Remove" onClick={() => removeWorkbook(w.id)}>
                    ×
                  </button>
                </div>
                {w.sheets.map((s) => {
                  const isActive = active?.wb === w.id && active?.sheet === s.name
                  return (
                    <button
                      key={s.name}
                      className={`sheet-link ${isActive ? 'active' : ''}`}
                      onClick={() => setActive({ wb: w.id, sheet: s.name })}
                    >
                      <span>{s.name}</span>
                      <span className="count">{s.rows.length.toLocaleString()}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        )}

        {!collapsed && <ThemeSwitch />}
      </aside>

      <main className="main">
        {error && (
          <div className="alert">
            {error}
            <button className="icon-btn" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
        {loading ? (
          <div className="empty">Loading spreadsheets…</div>
        ) : sheet ? (
          <SheetView key={`${wb.id}/${sheet.name}`} file={wb.name} sheet={sheet} />
        ) : (
          <div className="empty dropzone" onClick={() => inputRef.current?.click()}>
            <div className="empty-icon">▦</div>
            <h2>No spreadsheet loaded</h2>
            <p>
              Drag and drop an Excel, ODS or CSV file here, or click to browse.
              <br />
              Files placed in <code>src/data/</code> load automatically.
            </p>
          </div>
        )}
      </main>

      {dragging && <div className="drop-overlay">Drop to load spreadsheet</div>}
    </div>
  )
}

const SIDEBAR_KEY = 'review-tool:sidebar'
const THEME_KEY = 'review-tool:theme'

function readStored(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the setting still applies for this session.
  }
}

function SidebarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  )
}
const THEMES = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System'],
]

function ThemeSwitch() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    writeStored(THEME_KEY, theme)
  }, [theme])

  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {THEMES.map(([value, label]) => (
        <button
          key={value}
          role="radio"
          aria-checked={theme === value}
          className={theme === value ? 'on' : ''}
          onClick={() => setTheme(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
