import { useMemo, useState } from 'react'

import {
  exportScientificCsv,
  exportScientificMetadata,
  parseScientificCsv,
  prepareScientificImport,
} from '#/lib/scientific-csv'
import type {
  CsvDelimiter,
  CsvEncoding,
  CsvMapping,
  CsvPreview,
} from '#/lib/scientific-csv'
import {
  importScientificRows,
  recordScientificExport,
  scientificDataClient,
} from '#/lib/scientific-sheet-data'
import type {
  ScientificLogicalType,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'

const logicalTypes: ScientificLogicalType[] = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
]

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeName(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'sheet'
  )
}

export function ScientificTransferPanel({
  table,
  rows,
  readOnly,
  onImported,
}: {
  table: ScientificTableWire
  rows: ScientificRowWire[]
  readOnly: boolean
  onImported: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [encoding, setEncoding] = useState<CsvEncoding>('utf-8')
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',')
  const [header, setHeader] = useState(true)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [mappingValues, setMappingValues] = useState<Record<string, string>>({})
  const [duplicates, setDuplicates] = useState<
    'allow' | 'reject_file' | 'skip_file'
  >('reject_file')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const mappings = useMemo<CsvMapping[]>(() => {
    if (!preview) return []
    return preview.headers.map((source, index) => {
      const value = mappingValues[source] ?? 'ignore'
      if (value === 'ignore') return { source, kind: 'ignore' }
      if (value.startsWith('existing:'))
        return {
          source,
          kind: 'existing',
          column: table.columns.find(
            (column) => column.id === value.slice('existing:'.length),
          )!,
        }
      return {
        source,
        kind: 'new',
        label: source,
        logicalType: (value.split(':')[1] ??
          preview.detectedTypes[index]) as ScientificLogicalType,
      }
    })
  }, [mappingValues, preview, table.columns])
  const prepared = useMemo(
    () => (preview ? prepareScientificImport(preview, mappings) : null),
    [mappings, preview],
  )

  const previewFile = async () => {
    if (!file) return setStatus('Choose a CSV file first.')
    setBusy(true)
    try {
      const result = parseScientificCsv(await file.arrayBuffer(), {
        encoding,
        delimiter,
        header,
      })
      const values = Object.fromEntries(
        result.headers.map((source, index) => {
          const existing = table.columns.find(
            (column) => column.label.toLowerCase() === source.toLowerCase(),
          )
          return [
            source,
            existing
              ? `existing:${existing.id}`
              : `new:${result.detectedTypes[index]}`,
          ]
        }),
      )
      setPreview(result)
      setMappingValues(values)
      setStatus(
        `Previewed ${result.rows.length} rows and ${result.headers.length} columns.`,
      )
    } catch (error) {
      setPreview(null)
      setStatus(error instanceof Error ? error.message : 'Could not parse CSV.')
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    if (!file || !preview || !prepared) return
    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const result = await importScientificRows(scientificDataClient, {
        tableId: table.id,
        schemaVersion: table.schema_version,
        file: {
          name: file.name,
          size: file.size,
          sha256: await sha256(buffer),
          encoding,
          delimiter,
          header,
        },
        mappings: mappings.flatMap((mapping) => {
          if (mapping.kind === 'ignore') return []
          return [
            mapping.kind === 'existing'
              ? { source: mapping.source, columnId: mapping.column.id }
              : {
                  source: mapping.source,
                  newColumn: {
                    label: mapping.label,
                    logicalType: mapping.logicalType,
                    nullable: true,
                    validation: {},
                  },
                },
          ]
        }),
        rows: prepared.rows,
        duplicateStrategy: duplicates,
      })
      setStatus(
        `Imported ${result.importedRows} rows atomically${result.skippedDuplicates ? `; skipped ${result.skippedDuplicates} duplicates` : ''}.`,
      )
      setPreview(null)
      setFile(null)
      await onImported()
    } catch (error) {
      setStatus(
        `${error instanceof Error ? error.message : 'Import failed.'} No rows or new fields were committed.`,
      )
    } finally {
      setBusy(false)
    }
  }

  const runExport = async () => {
    setBusy(true)
    try {
      await recordScientificExport(scientificDataClient, table.id, rows.length)
      const name = safeName(table.name)
      download(
        `${name}.csv`,
        'text/csv;charset=utf-8',
        exportScientificCsv(table, rows),
      )
      download(
        `${name}.metadata.json`,
        'application/json',
        exportScientificMetadata(table),
      )
      setStatus(`Exported ${rows.length} rows with schema and unit metadata.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mb-2 rounded border p-2 text-xs"
      aria-label="Data interchange"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>Data interchange</strong>
        <button type="button" onClick={() => setOpen((value) => !value)}>
          {open ? 'Close import' : 'Import CSV'}
        </button>
        <button
          type="button"
          disabled={busy || rows.length > 5000}
          onClick={() => void runExport()}
        >
          Export CSV + metadata
        </button>
        {open ? (
          <span className="text-muted-foreground">
            XLSX is not read directly yet; save one value-only worksheet as CSV.
          </span>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 space-y-3 border-t pt-2">
          <div className="flex flex-wrap items-end gap-2">
            <label>
              CSV file
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                disabled={readOnly || busy}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  setPreview(null)
                }}
              />
            </label>
            <label>
              Encoding
              <select
                value={encoding}
                onChange={(event) =>
                  setEncoding(event.target.value as CsvEncoding)
                }
              >
                <option value="utf-8">UTF-8</option>
                <option value="utf-16le">UTF-16 LE</option>
                <option value="windows-1252">Windows-1252</option>
              </select>
            </label>
            <label>
              Delimiter
              <select
                value={delimiter}
                onChange={(event) =>
                  setDelimiter(event.target.value as CsvDelimiter)
                }
              >
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={'\t'}>Tab</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={header}
                onChange={(event) => setHeader(event.target.checked)}
              />{' '}
              Header row
            </label>
            <button
              type="button"
              disabled={readOnly || busy || !file}
              onClick={() => void previewFile()}
            >
              Preview CSV
            </button>
          </div>
          {preview ? (
            <>
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th>Incoming</th>
                    <th>Detected</th>
                    <th>Map to</th>
                    <th>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((source, index) => (
                    <tr key={source} className="border-t">
                      <td>{source}</td>
                      <td>{preview.detectedTypes[index]}</td>
                      <td>
                        <select
                          aria-label={`Map ${source}`}
                          value={mappingValues[source]}
                          onChange={(event) =>
                            setMappingValues((current) => ({
                              ...current,
                              [source]: event.target.value,
                            }))
                          }
                        >
                          <option value="ignore">Ignore</option>
                          {table.columns.map((column) => (
                            <option
                              key={column.id}
                              value={`existing:${column.id}`}
                            >
                              {column.label} · {column.field_name}
                            </option>
                          ))}
                          {logicalTypes.map((type) => (
                            <option key={type} value={`new:${type}`}>
                              New {type} field
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{preview.rows[0]?.[source] ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label>
                Duplicate rows within this file
                <select
                  value={duplicates}
                  onChange={(event) =>
                    setDuplicates(event.target.value as typeof duplicates)
                  }
                >
                  <option value="reject_file">Reject the whole import</option>
                  <option value="skip_file">Skip later duplicates</option>
                  <option value="allow">Import every row</option>
                </select>
              </label>
              {preview.duplicateRows.length ? (
                <p>{preview.duplicateRows.length} duplicate rows detected.</p>
              ) : null}
              {prepared?.errors.length ? (
                <ul
                  role="alert"
                  className="max-h-32 overflow-auto text-destructive"
                >
                  {prepared.errors.map((error) => (
                    <li key={`${error.row}:${error.source}`}>
                      Row {error.row}, {error.source}: {error.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                disabled={
                  readOnly ||
                  busy ||
                  !mappings.some((mapping) => mapping.kind !== 'ignore') ||
                  !!prepared?.errors.length ||
                  (duplicates === 'reject_file' &&
                    !!preview.duplicateRows.length)
                }
                onClick={() => void runImport()}
              >
                Import all rows atomically
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {status ? (
        <p role="status" className="mt-2">
          {status}
        </p>
      ) : null}
    </section>
  )
}
