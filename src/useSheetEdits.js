import { useEffect, useMemo, useState } from 'react'

// Review changes are kept separately from the source spreadsheet and layered
// on top of it, so the original file is never modified.
const EMPTY = { columns: [], rows: [], values: {}, notes: {} }

function load(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
  } catch {
    return EMPTY
  }
}

export function useSheetEdits(file, sheet) {
  const key = `review-tool:${file}:${sheet.name}`
  const [edits, setEdits] = useState(() => load(key))

  useEffect(() => {
    try {
      if (edits === EMPTY) return
      localStorage.setItem(key, JSON.stringify(edits))
    } catch {
      // Storage full or unavailable: changes still work for this session.
    }
  }, [key, edits])

  const columns = useMemo(
    () => [
      ...sheet.columns,
      ...edits.columns.map((k) => ({ key: k, type: 'text', added: true, filled: 0, distinct: 0, categorical: false, top: [] })),
    ],
    [sheet.columns, edits.columns],
  )

  const rows = useMemo(() => {
    const added = edits.rows.map((id, i) => ({ __id: id, __row: sheet.rows.length + i + 1, __new: true }))
    return [...sheet.rows, ...added].map((r) => (edits.values[r.__id] ? { ...r, ...edits.values[r.__id] } : r))
  }, [sheet.rows, edits.rows, edits.values])

  const hasChanges = edits.columns.length > 0 || edits.rows.length > 0 || Object.keys(edits.values).length > 0 ||
    Object.keys(edits.notes).length > 0

  function addColumn(name) {
    const label = name.trim()
    if (!label) return 'Enter a column name.'
    if (columns.some((c) => c.key.toLowerCase() === label.toLowerCase())) return 'That column already exists.'
    setEdits((e) => ({ ...e, columns: [...e.columns, label] }))
    return null
  }

  function removeColumn(name) {
    setEdits((e) => ({
      ...e,
      columns: e.columns.filter((c) => c !== name),
      values: mapEntries(e.values, (v) => omit(v, name)),
      notes: mapEntries(e.notes, (n) => omit(n, name)),
    }))
  }

  function addRow() {
    const id = `new-${Date.now().toString(36)}`
    setEdits((e) => ({ ...e, rows: [...e.rows, id] }))
    return id
  }

  function removeRow(id) {
    setEdits((e) => ({ ...e, rows: e.rows.filter((r) => r !== id), values: omit(e.values, id), notes: omit(e.notes, id) }))
  }

  function setValue(id, col, value) {
    let v = value
    if (col.type === 'number' && value.trim() !== '' && !Number.isNaN(Number(value))) v = Number(value)
    setEdits((e) => ({ ...e, values: { ...e.values, [id]: { ...e.values[id], [col.key]: v } } }))
  }

  function setNote(id, colKey, text) {
    setEdits((e) => {
      const rowNotes = text.trim() ? { ...e.notes[id], [colKey]: text.trim() } : omit(e.notes[id] ?? {}, colKey)
      const notes = Object.keys(rowNotes).length ? { ...e.notes, [id]: rowNotes } : omit(e.notes, id)
      return { ...e, notes }
    })
  }

  function discardAll() {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
    setEdits(EMPTY)
  }

  return {
    columns,
    rows,
    notes: edits.notes,
    hasChanges,
    addColumn,
    removeColumn,
    addRow,
    removeRow,
    setValue,
    setNote,
    discardAll,
  }
}

function omit(obj, k) {
  const { [k]: _, ...rest } = obj
  return rest
}

function mapEntries(obj, fn) {
  return Object.fromEntries(
    Object.entries(obj)
      .map(([k, v]) => [k, fn(v)])
      .filter(([, v]) => Object.keys(v).length),
  )
}
