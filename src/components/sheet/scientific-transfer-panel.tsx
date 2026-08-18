import { useState } from 'react'

import {
  exportScientificCsv,
  exportScientificMetadata,
} from '#/lib/scientific-csv'
import {
  recordScientificExport,
  scientificDataClient,
} from '#/lib/scientific-sheet-data'
import type {
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'

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
}: {
  table: ScientificTableWire
  rows: ScientificRowWire[]
  readOnly?: boolean
  onImported?: () => Promise<void>
}) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

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
      aria-label="Sheet export"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>Sheet export</strong>
        <button
          type="button"
          disabled={busy || rows.length > 5000}
          onClick={() => void runExport()}
        >
          Export CSV + metadata
        </button>
      </div>
      <p className="mt-2 text-muted-foreground">
        Laboratory file import is the Dataset/Record import framework, not this
        Sheet export, leftover scientific CSV import, or plate CSV.
      </p>
      {status ? <p className="mt-2 text-muted-foreground">{status}</p> : null}
    </section>
  )
}
