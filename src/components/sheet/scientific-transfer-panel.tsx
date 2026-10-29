import { t } from '#/copy'
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

/** An export receipt records at most this many rows; the database refuses more
 * (`record_scientific_export` validates the count), so the panel states the
 * limit instead of failing after the click. */
const EXPORT_ROW_LIMIT = 5000

export function ScientificTransferPanel({
  table,
  rows,
}: {
  table: ScientificTableWire
  rows: ScientificRowWire[]
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
      setStatus(
        t('notebook.scientificTransferPanel.exportedCountRowsWith', {
          count: rows.length,
        }),
      )
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : t('notebook.scientificTransferPanel.exportFailed'),
      )
    } finally {
      setBusy(false)
    }
  }

  const tooManyRows = rows.length > EXPORT_ROW_LIMIT

  return (
    <section
      className="mb-2 rounded border p-2 text-xs"
      aria-label={t('notebook.scientificTransferPanel.ariaLabel')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>{t('notebook.scientificTransferPanel.ariaLabel')}</strong>
        <button
          type="button"
          disabled={busy || tooManyRows}
          onClick={() => void runExport()}
        >
          {t('notebook.scientificTransferPanel.exportCsvMetadata')}
        </button>
      </div>
      {tooManyRows ? (
        <p className="mt-2 text-muted-foreground">
          {t('notebook.scientificTransferPanel.thisSheetHasCount', {
            count: rows.length,
            EXPORT_ROW_LIMIT: EXPORT_ROW_LIMIT.toLocaleString(),
          })}
        </p>
      ) : null}
      <p className="mt-2 text-muted-foreground">
        {t('notebook.scientificTransferPanel.toBringInstrumentFiles')}
      </p>
      {status ? <p className="mt-2 text-muted-foreground">{status}</p> : null}
    </section>
  )
}
