import { useEffect, useMemo, useRef, useState } from 'react'
import { compareValues, exportCsv, exportXlsx, formatValue } from './loader.js'
import { useSheetEdits } from './useSheetEdits.js'

const PAGE_SIZES = [25, 50, 100, 250]
const LONG_TEXT = 80

export default function SheetView({ file, sheet }) {
  const { columns, rows, notes, hasChanges, addColumn, removeColumn, addRow, removeRow, setValue, setNote, discardAll } =
    useSheetEdits(file, sheet)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState({}) // { columnKey: value }
  const [notesOnly, setNotesOnly] = useState(false)
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [hidden, setHidden] = useState(() => new Set())
  const [selectedId, setSelectedId] = useState(null)
  const [popover, setPopover] = useState(null) // 'columns' | 'addColumn'

  const visibleCols = columns.filter((c) => !hidden.has(c.key))
  const filterCols = columns.filter((c) => c.categorical)
  const noteCount = Object.values(notes).reduce((n, r) => n + Object.keys(r).length, 0)
  const titleCol = useMemo(() => pickTitleColumn(sheet.columns, sheet.rows.length), [sheet])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const active = Object.entries(filters).filter(([, v]) => v !== '')
    let out = rows.filter((r) => {
      if (notesOnly && !notes[r.__id]) return false
      for (const [k, v] of active) if (formatValue(r[k]) !== v) return false
      if (!q) return true
      return (
        columns.some((c) => formatValue(r[c.key], c).toLowerCase().includes(q)) ||
        Object.values(notes[r.__id] ?? {}).some((n) => n.toLowerCase().includes(q))
      )
    })
    if (sort.key) {
      const dir = sort.dir === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => compareValues(a[sort.key], b[sort.key]) * dir)
    }
    return out
  }, [rows, columns, notes, query, filters, notesOnly, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const activeFilterCount = Object.values(filters).filter((v) => v !== '').length + (query ? 1 : 0) + (notesOnly ? 1 : 0)
  const selected = rows.find((r) => r.__id === selectedId)

  function toggleSort(key) {
    setSort((s) => (s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' }))
  }

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(0)
  }

  function clearAll() {
    setQuery('')
    setFilters({})
    setNotesOnly(false)
    setPage(0)
  }

  function handleAddRow() {
    setSelectedId(addRow())
  }

  function handleExport(format) {
    const base = `${file.replace(/\.[^.]+$/, '')}-${sheet.name}-reviewed`
    if (format === 'csv') exportCsv(`${base}.csv`, columns, rows, notes)
    else exportXlsx(`${base}.xlsx`, sheet.name, columns, rows, notes)
  }

  function handleDiscard() {
    if (window.confirm('Discard all added rows, columns, edits and notes for this sheet?')) {
      discardAll()
      setSelectedId(null)
    }
  }

  return (
    <div className="sheet">
      <section className="toolbar">
        <input
          className="search"
          type="search"
          placeholder={`Search ${rows.length.toLocaleString()} rows…`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
        />
        {filterCols.map((c) => (
          <select
            key={c.key}
            className={`select ${filters[c.key] ? 'on' : ''}`}
            value={filters[c.key] ?? ''}
            onChange={(e) => setFilter(c.key, e.target.value)}
          >
            <option value="">{c.key}: All</option>
            {[...new Set(rows.map((r) => formatValue(r[c.key])).filter(Boolean))].sort().map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ))}
        <button
          className={`btn ${notesOnly ? 'btn-on' : ''}`}
          onClick={() => {
            setNotesOnly((v) => !v)
            setPage(0)
          }}
        >
          With notes ({noteCount})
        </button>
        {activeFilterCount > 0 && (
          <button className="btn btn-ghost" onClick={clearAll}>
            Clear filters
          </button>
        )}

        <div className="spacer" />

        <button className="btn" onClick={handleAddRow}>
          + Row
        </button>
        <div className="popover-wrap">
          <button className="btn" onClick={() => setPopover((p) => (p === 'addColumn' ? null : 'addColumn'))}>
            + Column
          </button>
          {popover === 'addColumn' && (
            <AddColumnForm
              onAdd={(name) => {
                const err = addColumn(name)
                if (!err) setPopover(null)
                return err
              }}
              onCancel={() => setPopover(null)}
            />
          )}
        </div>
        <div className="popover-wrap">
          <button className="btn" onClick={() => setPopover((p) => (p === 'columns' ? null : 'columns'))}>
            Columns ({visibleCols.length}/{columns.length})
          </button>
          {popover === 'columns' && (
            <div className="popover" onMouseLeave={() => setPopover(null)}>
              {columns.map((c) => (
                <div key={c.key} className="check-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.key)}
                      onChange={() =>
                        setHidden((h) => {
                          const n = new Set(h)
                          n.has(c.key) ? n.delete(c.key) : n.add(c.key)
                          return n
                        })
                      }
                    />
                    {c.key}
                    {c.added && <span className="badge">added</span>}
                  </label>
                  {c.added && (
                    <button
                      className="icon-btn"
                      title="Delete column"
                      onClick={() => window.confirm(`Delete column "${c.key}" and its values?`) && removeColumn(c.key)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="btn" onClick={() => handleExport('csv')}>
          Export CSV
        </button>
        <button className="btn btn-primary" onClick={() => handleExport('xlsx')}>
          Export Excel
        </button>
        {hasChanges && (
          <button className="btn btn-ghost btn-danger" onClick={handleDiscard}>
            Discard changes
          </button>
        )}
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="rownum">#</th>
              {visibleCols.map((c) => (
                <th
                  key={c.key}
                  className={`${c.type === 'number' ? 'num' : ''} ${c.added ? 'added' : ''}`}
                  onClick={() => toggleSort(c.key)}
                >
                  <span className="th-inner">
                    {c.key}
                    <span className={`sort ${sort.key === c.key ? 'on' : ''}`}>
                      {sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const rowNotes = notes[r.__id] ?? {}
              return (
                <tr
                  key={r.__id}
                  onClick={() => setSelectedId(r.__id)}
                  className={`${selectedId === r.__id ? 'selected' : ''} ${r.__new ? 'new-row' : ''}`}
                >
                  <td className="rownum">{r.__row}</td>
                  {visibleCols.map((c) => (
                    <td
                      key={c.key}
                      className={`${c.type === 'number' ? 'num' : ''} ${rowNotes[c.key] ? 'has-note' : ''}`}
                      title={rowNotes[c.key] ? `Note: ${rowNotes[c.key]}` : undefined}
                    >
                      <div className="cell">
                        <Cell value={r[c.key]} col={c} />
                      </div>
                    </td>
                  ))}
                </tr>
              )
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length + 1} className="no-results">
                  No rows match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="pager">
        <span>
          {filtered.length ? safePage * pageSize + 1 : 0}–{Math.min((safePage + 1) * pageSize, filtered.length)} of{' '}
          {filtered.length.toLocaleString()}
        </span>
        <div className="spacer" />
        <select className="select" value={pageSize} onChange={(e) => (setPageSize(+e.target.value), setPage(0))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
        <button className="btn" disabled={safePage === 0} onClick={() => setPage(0)}>
          «
        </button>
        <button className="btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
          ‹
        </button>
        <span className="page-num">
          Page {safePage + 1} of {pageCount}
        </span>
        <button className="btn" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
          ›
        </button>
        <button className="btn" disabled={safePage >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>
          »
        </button>
      </footer>

      {selected && (
        <RecordModal
          file={file}
          sheet={sheet.name}
          rows={filtered}
          row={selected}
          columns={columns}
          titleCol={titleCol}
          notes={notes[selected.__id] ?? {}}
          onNavigate={(r) => setSelectedId(r.__id)}
          onClose={() => setSelectedId(null)}
          onSave={(col, value) => setValue(selected.__id, col, value)}
          onNote={(colKey, text) => setNote(selected.__id, colKey, text)}
          onDelete={
            selected.__new
              ? () => {
                  removeRow(selected.__id)
                  setSelectedId(null)
                }
              : null
          }
        />
      )}
    </div>
  )
}

// Prefer a column that looks like a title; otherwise the first mostly-filled free-text column.
function pickTitleColumn(columns, rowCount) {
  const candidates = columns.filter((c) => c.type === 'text' && !c.categorical && c.filled >= rowCount * 0.5)
  return candidates.find((c) => /\b(title|name|subject|heading)\b/i.test(c.key)) ?? candidates[0] ?? null
}

function AddColumnForm({ onAdd, onCancel }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  return (
    <form
      className="popover add-col"
      onSubmit={(e) => {
        e.preventDefault()
        setError(onAdd(name) ?? '')
      }}
    >
      <label className="field-label">New column name</label>
      <input
        autoFocus
        className="search"
        value={name}
        placeholder="e.g. Decision"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      />
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          Add column
        </button>
      </div>
    </form>
  )
}

function Cell({ value, col }) {
  if (value === '' || value === null || value === undefined) return <span className="muted">—</span>
  const text = formatValue(value, col)
  if (col.categorical) return <span className="pill">{text}</span>
  if (/^https?:\/\//i.test(text))
    return (
      <a href={text} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {text}
      </a>
    )
  return text
}

function RecordModal({ file, sheet, rows, row, columns, titleCol, notes, onNavigate, onClose, onSave, onNote, onDelete }) {
  const index = rows.findIndex((r) => r.__id === row.__id)
  const prev = index > 0 ? rows[index - 1] : null
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : null

  useEffect(() => {
    function onKey(e) {
      if (e.target.closest?.('input, textarea, select')) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && prev) onNavigate(prev)
      else if (e.key === 'ArrowRight' && next) onNavigate(next)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [prev, next, onNavigate, onClose])

  const fields = columns.filter((c) => c !== titleCol)
  const isLong = (c) => formatValue(row[c.key], c).length > LONG_TEXT
  const short = fields.filter((c) => !isLong(c))
  const long = fields.filter(isLong)
  const fieldProps = (c) => ({
    col: c,
    value: row[c.key],
    note: notes[c.key],
    onSave: (v) => onSave(c, v),
    onNote: (t) => onNote(c.key, t),
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-bar">
          <span className="modal-pos">
            {index >= 0 ? `${index + 1} of ${rows.length.toLocaleString()}` : `Row ${row.__row}`}
          </span>
          <div className="modal-actions">
            {onDelete && (
              <button className="btn btn-ghost btn-danger" onClick={() => window.confirm('Delete this row?') && onDelete()}>
                Delete row
              </button>
            )}
            <button className="btn" disabled={!prev} onClick={() => onNavigate(prev)} title="Previous (←)">
              ‹ Prev
            </button>
            <button className="btn" disabled={!next} onClick={() => onNavigate(next)} title="Next (→)">
              Next ›
            </button>
            <button className="icon-btn" onClick={onClose} title="Close (Esc)">
              ×
            </button>
          </div>
        </div>

        <article className="doc">
          <div className="doc-meta">
            {file} · {sheet} · Row {row.__row}
            {row.__new && <span className="badge">added</span>}
          </div>
          {titleCol ? (
            <Field key={`${row.__id}/title`} {...fieldProps(titleCol)} variant="title" />
          ) : (
            <h2 className="doc-title">Record {row.__row}</h2>
          )}

          {short.length > 0 && (
            <dl className="doc-grid">
              {short.map((c) => (
                <Field key={`${row.__id}/${c.key}`} {...fieldProps(c)} />
              ))}
            </dl>
          )}

          {long.map((c) => (
            <Field key={`${row.__id}/${c.key}`} {...fieldProps(c)} variant="section" />
          ))}
        </article>
      </div>
    </div>
  )
}

// One field of the record document: click the value to edit it, or add a note.
function Field({ col, value, note, onSave, onNote, variant }) {
  const initial = value instanceof Date || value === undefined || value === null ? formatValue(value, col) : String(value)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [noting, setNoting] = useState(false)
  const [noteDraft, setNoteDraft] = useState(note ?? '')

  function startEdit() {
    setDraft(initial)
    setEditing(true)
  }
  function save() {
    if (draft !== initial) onSave(draft)
    setEditing(false)
  }
  function startNote() {
    setNoteDraft(note ?? '')
    setNoting(true)
  }
  function saveNote() {
    onNote(noteDraft)
    setNoting(false)
  }

  const actions = (
    <span className="field-actions">
      {!editing && (
        <button className="link-btn" onClick={startEdit}>
          Edit
        </button>
      )}
      {!noting && !note && (
        <button className="link-btn" onClick={startNote}>
          + Note
        </button>
      )}
    </span>
  )

  const body = editing ? (
    <Editor value={draft} onChange={setDraft} onSave={save} onCancel={() => setEditing(false)} big={variant === 'title'} />
  ) : (
    <div className="field-value" onClick={startEdit} title="Click to edit">
      {variant === 'title' && !initial ? <span className="muted">Untitled</span> : <Value value={value} col={col} />}
    </div>
  )

  const noteBlock = noting ? (
    <div className="note note-editing">
      <Editor
        value={noteDraft}
        onChange={setNoteDraft}
        onSave={saveNote}
        onCancel={() => setNoting(false)}
        placeholder={`Note on ${col.key}…`}
        extra={
          note && (
            <button
              className="btn btn-ghost btn-danger"
              onClick={() => {
                onNote('')
                setNoting(false)
              }}
            >
              Delete note
            </button>
          )
        }
      />
    </div>
  ) : note ? (
    <div className="note" onClick={startNote} title="Click to edit note">
      <span className="note-label">Note</span>
      {note}
    </div>
  ) : null

  if (variant === 'title') {
    return (
      <div className="doc-title-wrap field">
        <div className="field-head">
          <span className="field-label">{col.key}</span>
          {actions}
        </div>
        <div className="doc-title">{body}</div>
        {noteBlock}
      </div>
    )
  }

  if (variant === 'section') {
    return (
      <section className="doc-section field">
        <div className="field-head">
          <h3>{col.key}</h3>
          {actions}
        </div>
        <div className="doc-text">{body}</div>
        {noteBlock}
      </section>
    )
  }

  return (
    <div className={`doc-field field ${col.added ? 'added' : ''}`}>
      <dt className="field-head">
        <span>{col.key}</span>
        {actions}
      </dt>
      <dd>{body}</dd>
      {noteBlock}
    </div>
  )
}

function Editor({ value, onChange, onSave, onCancel, placeholder, big, extra }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => {
    const el = ref.current
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])

  return (
    <div className="editor">
      <textarea
        ref={ref}
        className={`editor-input ${big ? 'big' : ''}`}
        value={value}
        placeholder={placeholder}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave()
        }}
      />
      <div className="form-actions">
        {extra}
        <span className="hint">Ctrl+Enter to save</span>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  )
}

function Value({ value, col }) {
  const text = formatValue(value, col)
  if (!text) return <span className="muted">—</span>
  if (col.categorical) return <span className="pill">{text}</span>
  if (/^https?:\/\/\S+$/i.test(text))
    return (
      <a href={text} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {text}
      </a>
    )
  return text
}
