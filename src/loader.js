import * as XLSX from 'xlsx'

export const ACCEPT = '.xlsx,.xls,.xlsm,.ods,.csv,.tsv'

// Every spreadsheet dropped into src/data is bundled and loaded on startup.
const bundled = import.meta.glob('./data/*.{xlsx,xls,xlsm,ods,csv,tsv}', {
  query: '?url',
  import: 'default',
  eager: true,
})

export async function loadBundledWorkbooks() {
  return Promise.all(
    Object.entries(bundled).map(async ([path, url]) => {
      const res = await fetch(url)
      return parseWorkbook(path.split('/').pop(), await res.arrayBuffer())
    }),
  )
}

export async function loadFile(file) {
  return parseWorkbook(file.name, await file.arrayBuffer())
}

let nextId = 0

export function parseWorkbook(name, buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheets = wb.SheetNames.map((sheetName) => parseSheet(sheetName, wb.Sheets[sheetName])).filter(
    (s) => s.columns.length > 0,
  )
  return { id: `wb-${nextId++}`, name, sheets }
}

function isBlank(v) {
  return v === '' || v === null || v === undefined
}

function parseSheet(name, ws) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: true })
  const headerIdx = grid.findIndex((r) => r.some((c) => String(c).trim() !== ''))
  if (headerIdx === -1) return { name, columns: [], rows: [] }

  const width = Math.max(...grid.map((r) => r.length))
  const seen = {}
  const keys = Array.from({ length: width }, (_, i) => {
    let label = String(grid[headerIdx][i] ?? '').trim() || `Column ${i + 1}`
    if (seen[label]) label = `${label} (${++seen[label]})`
    else seen[label] = 1
    return label
  })

  const rows = grid
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r, i) => {
      const obj = { __row: i + 1, __id: `r${i + 1}` }
      keys.forEach((k, j) => (obj[k] = r[j] ?? ''))
      return obj
    })

  // Drop columns that are completely empty and have no header.
  const columns = keys
    .map((key) => ({ key, ...inferColumn(rows, key) }))
    .filter((c) => !(c.filled === 0 && c.key.startsWith('Column ')))

  return { name, columns, rows }
}

function inferColumn(rows, key) {
  let num = 0
  let date = 0
  let filled = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity
  const counts = new Map()
  for (const r of rows) {
    const v = r[key]
    if (isBlank(v)) continue
    filled++
    if (v instanceof Date) date++
    else if (typeof v === 'number') {
      num++
      sum += v
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    const label = formatValue(v)
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  let type = 'text'
  if (filled && num / filled > 0.9) type = 'number'
  else if (filled && date / filled > 0.9) type = 'date'
  const distinct = counts.size
  const categorical = type === 'text' && distinct > 1 && distinct <= 40 && distinct <= filled * 0.6
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const stats = type === 'number' && num ? { sum, min, max, avg: sum / num } : null
  // Years and identifiers read better without thousands separators.
  const plain =
    type === 'number' && (/\b(year|id|code|zip|phone)\b/i.test(key) || (Number.isInteger(min) && min >= 1800 && max <= 2100))
  return { type, filled, distinct, categorical, top, stats, plain }
}

export function formatValue(v, col) {
  if (v instanceof Date) {
    const hasTime = v.getHours() || v.getMinutes()
    return hasTime ? v.toLocaleString() : v.toLocaleDateString()
  }
  if (typeof v === 'number') {
    if (col?.plain) return String(v)
    return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return String(v ?? '')
}

export function compareValues(a, b) {
  const ab = isBlank(a)
  const bb = isBlank(b)
  if (ab || bb) return ab === bb ? 0 : ab ? 1 : -1
  if (a instanceof Date && b instanceof Date) return a - b
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export const NOTES_COLUMN = 'Review Notes'

// One readable line per note, e.g. "Year: check the publication date".
function notesText(columns, rowNotes) {
  if (!rowNotes) return ''
  return columns
    .filter((c) => rowNotes[c.key])
    .map((c) => `${c.key}: ${rowNotes[c.key]}`)
    .join('\n')
}

// Builds the export sheet: every column, plus a visible notes column so notes
// survive in any format (CSV has no cell comments).
function buildSheet(columns, rows, notes) {
  // A re-imported export already has a notes column: merge into it rather than add another.
  const existing = columns.some((c) => c.key === NOTES_COLUMN)
  const header = existing ? columns.map((c) => c.key) : [...columns.map((c) => c.key), NOTES_COLUMN]
  const aoa = [
    header,
    ...rows.map((r) => {
      const text = notesText(columns, notes[r.__id])
      if (!existing) return [...columns.map((c) => r[c.key] ?? ''), text]
      return columns.map((c) =>
        c.key === NOTES_COLUMN ? [r[c.key], text].filter((v) => v !== '' && v != null).join('\n') : r[c.key] ?? '',
      )
    }),
  ]
  return XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
}

// Writes the reviewed sheet to .xlsx. Notes are in the notes column and also
// attached to their cells as comments.
export function exportXlsx(filename, sheetName, columns, rows, notes) {
  const ws = buildSheet(columns, rows, notes)
  rows.forEach((r, ri) => {
    const rowNotes = notes[r.__id]
    if (!rowNotes) return
    columns.forEach((c, ci) => {
      if (!rowNotes[c.key]) return
      const addr = XLSX.utils.encode_cell({ r: ri + 1, c: ci })
      ws[addr] ??= { t: 's', v: '' }
      ws[addr].c = [{ a: 'Reviewer', t: rowNotes[c.key] }]
    })
  })
  const found = columns.findIndex((c) => c.key === NOTES_COLUMN)
  const notesIdx = found === -1 ? columns.length : found
  const width = XLSX.utils.decode_range(ws['!ref']).e.c + 1
  ws['!cols'] = Array.from({ length: width }, (_, i) => ({ wch: i === notesIdx ? 60 : 18 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || 'Sheet1')
  XLSX.writeFile(wb, filename, { bookType: 'xlsx' })
}

export function exportCsv(filename, columns, rows, notes) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildSheet(columns, rows, notes), 'Sheet1')
  XLSX.writeFile(wb, filename, { bookType: 'csv' })
}
