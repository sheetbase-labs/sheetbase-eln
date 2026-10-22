import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { Banner } from '#/components/v3/ui/alert'
import { FileDrop } from '#/components/v3/ui/file-drop'
import { PageHeader, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { uploadImportFile } from '#/lib/import/data'
import type { DatasetImportRecord } from '#/lib/import/types'

import { serializeImportMapping } from './import-search'
import type { ImportSearch } from './import-search'

/** The committed receipt for a stored import file, if there is one. A failed
 * or preview row is not a receipt: the file can still be mapped and imported. */
export function findCommittedReceipt(
  receipts: readonly DatasetImportRecord[] | undefined,
  fileId: string,
  sheetName?: string,
): DatasetImportRecord | null {
  return (
    receipts?.find(
      (receipt) =>
        receipt.status === 'committed' &&
        receipt.file_id === fileId &&
        (!sheetName || receipt.mapping?.sheetName === sheetName),
    ) ?? null
  )
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * The settings a corrected file starts from: the Dataset, experiment,
 * instrument, parser and column mapping the committed import used. The person
 * re-checks them on the map step; nothing is committed until they do.
 */
export function carriedOverSettings(
  receipt: DatasetImportRecord,
): ImportSearch {
  const values: Record<string, string> = {}
  for (const entry of receipt.mapping?.sources ?? []) {
    if (entry.fieldId) values[entry.source] = entry.fieldId
  }
  const map = serializeImportMapping(values)
  const units = serializeImportMapping(
    Object.fromEntries(
      (receipt.mapping?.sources ?? []).flatMap((entry) =>
        entry.sourceUnit ? [[entry.source, entry.sourceUnit]] : [],
      ),
    ),
  )
  return {
    step: 'map',
    dataset: receipt.dataset_id,
    experiment: receipt.experiment_record_id ?? undefined,
    instrument: receipt.instrument_id ?? undefined,
    parser: text(receipt.parser_provenance.key),
    map: map || undefined,
    units: units || undefined,
    sheet: receipt.mapping?.sheetName,
  }
}

const OUTCOME_LABELS: Record<string, string> = {
  added: 'Added',
  planned: 'Planned',
  new: 'New',
  flagged: 'Flagged',
  skipped: 'Skipped',
}

/**
 * A committed import is a receipt, not a draft: what was imported, with which
 * parser and mapping, into which snapshot — read-only. The one thing it offers
 * is a corrected file, which opens a new import with the old settings.
 */
export function ImportReceipt({
  importId,
  receipt,
}: {
  importId: string
  receipt: DatasetImportRecord
}) {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const filename = text(receipt.source_provenance.filename) ?? 'Imported file'
  const parserName = text(receipt.parser_provenance.name)
  const parserVersion = receipt.parser_provenance.version
  const sources = (receipt.mapping?.sources ?? []).filter(
    (entry) => entry.fieldId,
  )
  const outcome = Object.entries(receipt.outcome).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  )

  async function uploadCorrected(file: File) {
    setError('')
    try {
      const upload = await uploadImportFile({
        file,
        datasetId: receipt.dataset_id,
      })
      await navigate({
        to: '/import/$importId',
        params: { importId: upload.fileId },
        search: carriedOverSettings(receipt),
      })
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'The corrected file could not be uploaded.',
      )
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={[{ label: 'Datasets' }, { label: 'Import receipt' }]}
        title={filename}
        meta={
          <>
            <Status tone="ok">Committed</Status>
            <span>{formatNotebookDateTime(receipt.created_at)}</span>
            <span className="mono max-lg:hidden">
              import {importId.slice(0, 8)}
            </span>
          </>
        }
      />
      <div className="grid max-w-[900px] gap-5 px-4 py-4 md:px-6">
        <Banner tone="info" title="This import is committed">
          It is a read-only receipt: the file and its mapping are kept exactly
          as they were imported. To change the data, upload a corrected file; it
          starts with the same Dataset, parser and mapping.
        </Banner>
        {error ? (
          <Banner tone="bad" title="Upload error">
            {error}
          </Banner>
        ) : null}

        <Section title="Receipt">
          <dl className="m-0 grid grid-cols-[120px_1fr] gap-y-1 text-body">
            <dt className="text-fg-muted">Dataset</dt>
            <dd className="m-0">
              <Link
                to="/datasets/$datasetId"
                params={{ datasetId: receipt.dataset_id }}
                search={{ view: 'imports' }}
                className="text-link"
              >
                Open the Dataset
              </Link>
            </dd>
            <dt className="text-fg-muted">Parser</dt>
            <dd className="m-0">
              {parserName
                ? `${parserName}${typeof parserVersion === 'number' ? ` v${parserVersion}` : ''}`
                : 'Mapped by hand'}
            </dd>
            <dt className="text-fg-muted">Worksheet</dt>
            <dd className="m-0">
              {text(receipt.source_provenance.sheetName) ??
                receipt.mapping?.sheetName ??
                'Not recorded'}
            </dd>
            <dt className="text-fg-muted">SHA-256</dt>
            <dd className="m-0 break-all font-mono text-xs">
              {text(receipt.source_provenance.checksum) ?? 'Not recorded'}
            </dd>
            <dt className="text-fg-muted">Rows</dt>
            <dd className="m-0">
              {outcome.length
                ? outcome
                    .map(([key, count]) =>
                      `${count} ${OUTCOME_LABELS[key] ?? key}`.toLowerCase(),
                    )
                    .join(' · ')
                : `${receipt.imported_row_ids.length} imported`}
            </dd>
            {receipt.snapshot_version_id ? (
              <>
                <dt className="text-fg-muted">Snapshot</dt>
                <dd className="m-0">
                  <Link
                    to="/datasets/$datasetId/snapshots"
                    params={{ datasetId: receipt.dataset_id }}
                    className="text-link"
                  >
                    {receipt.snapshot_version_id.slice(0, 8)}
                  </Link>
                </dd>
              </>
            ) : null}
          </dl>
        </Section>

        {sources.length ? (
          <Section title="Mapping used" count={sources.length}>
            <TableBox>
              <Table aria-label="Mapping used">
                <TableHeader>
                  <TableRow>
                    <TableHead className="first:pl-3">File column</TableHead>
                    <TableHead>Dataset field</TableHead>
                    <TableHead>Source unit</TableHead>
                    <TableHead>Storage unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((entry) => (
                    <TableRow key={entry.source}>
                      <TableCell className="first:pl-3">
                        {entry.source}
                      </TableCell>
                      <TableCell>{entry.fieldId}</TableCell>
                      <TableCell>
                        {entry.sourceUnit ?? 'Not declared'}
                      </TableCell>
                      <TableCell>{entry.unit ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          </Section>
        ) : null}

        <Section title="Upload a corrected file">
          <FileDrop
            className="max-w-[420px]"
            label="Corrected file"
            inputLabel="Corrected file"
            hint="Starts a new import into the same Dataset with this mapping."
            accept=".csv,.tsv,.tab,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onFile={(file) => (file ? uploadCorrected(file) : undefined)}
          />
        </Section>
      </div>
    </div>
  )
}
