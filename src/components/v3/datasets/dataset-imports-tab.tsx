/**
 * R5-SURF-01 — the dataset Imports tab.
 *
 * Result shape: one row per committed (or failed) import receipt from
 * `api.dataset_import_list` (DSET-02.3 / DSET-05.4), read through the same
 * `/api/db` boundary as every other screen — never a browser table read. Each
 * receipt already carries the frozen file, parser and outcome provenance the
 * commit wrote, so the tab shows When · File · Rows · Parser · Result without
 * joining the mutable parser catalogue.
 *
 * States are explicit: loading, denied (a non-member read), error, and the
 * honest empty state for a dataset that has never been imported into.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { EmptyState } from '#/components/v3/ui/empty-state'
import { Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { classifyDatasetTabAccess } from '#/components/v3/datasets/dataset-detail-tabs'
import { fetchDatasetImports, importQueryKeys } from '#/lib/import/data'
import type { DatasetImportRecord } from '#/lib/import/types'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'

export interface DatasetImportRow {
  id: string
  when: string
  file: string
  rows: number
  parser: string
  result: { tone: Tone; label: string }
  /** The retained import file, when the receipt has one to reopen. */
  importFileId: string | null
  /** Search state that resumes that file's map and check steps. */
  resumeSearch: {
    step: 'map'
    dataset: string
    experiment?: string
    parser?: string
  }
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key]
  return typeof field === 'string' && field.length > 0 ? field : null
}

const RESULT_BY_STATUS: Record<string, { tone: Tone; label: string }> = {
  committed: { tone: 'ok', label: 'Committed' },
  failed: { tone: 'bad', label: 'Failed' },
  preview: { tone: 'draft', label: 'Preview' },
}

/** One receipt as the tab's table shows it; unknown provenance degrades to "—". */
export function toDatasetImportRow(
  receipt: DatasetImportRecord,
): DatasetImportRow {
  const filename = stringField(receipt.source_provenance, 'filename')
  const parserName = stringField(receipt.parser_provenance, 'name')
  const parserVersion = receipt.parser_provenance.version
  const added = receipt.outcome.added
  return {
    id: receipt.id,
    when: formatNotebookDateTime(receipt.created_at),
    file: filename ?? (receipt.connector_run_id ? 'Connector import' : '—'),
    rows: typeof added === 'number' ? added : receipt.imported_row_ids.length,
    parser:
      parserName != null
        ? `${parserName}${typeof parserVersion === 'number' ? ` v${parserVersion}` : ''}`
        : '—',
    result: RESULT_BY_STATUS[receipt.status] ?? {
      tone: 'none',
      label: receipt.status,
    },
    importFileId: receipt.file_id,
    resumeSearch: {
      step: 'map',
      dataset: receipt.dataset_id,
      experiment: receipt.experiment_record_id ?? undefined,
      parser: stringField(receipt.parser_provenance, 'key') ?? undefined,
    },
  }
}

export function DatasetImportsTab({ datasetId }: { datasetId: string }) {
  const query = useQuery({
    queryKey: importQueryKeys.imports(datasetId),
    queryFn: () => fetchDatasetImports(notebookDataClient, datasetId),
  })
  const access = classifyDatasetTabAccess(query.error)

  if (query.isLoading) {
    return (
      <div className="px-4 py-6 md:px-6" aria-busy="true">
        <p className="text-body text-fg-muted">Loading imports…</p>
      </div>
    )
  }

  if (access) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="upload"
          title={
            access === 'denied'
              ? 'Imports are not available to you'
              : 'Imports could not be loaded'
          }
          body={
            access === 'denied'
              ? 'Import receipts belong to the dataset’s workspace. Ask a workspace member for access.'
              : 'The import receipts could not be read. Try again, or check the workspace connection.'
          }
        />
      </div>
    )
  }

  const rows = (query.data ?? []).map(toDatasetImportRow)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto px-4 py-5 md:px-6">
      <Section title="Imports" count={rows.length}>
        {rows.length ? (
          <TableBox>
            <Table aria-label="Imports">
              <TableHeader>
                <TableRow>
                  <TableHead className="first:pl-3">When</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead align="right">Rows</TableHead>
                  <TableHead>Parser</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="first:pl-3">{row.when}</TableCell>
                    <TableCell>
                      {row.importFileId ? (
                        <Link
                          to="/import/$importId"
                          params={{ importId: row.importFileId }}
                          search={row.resumeSearch}
                          className="text-link"
                        >
                          {row.file}
                        </Link>
                      ) : (
                        row.file
                      )}
                    </TableCell>
                    <TableCell align="right" className="num">
                      {row.rows}
                    </TableCell>
                    <TableCell>{row.parser}</TableCell>
                    <TableCell>
                      <Status tone={row.result.tone}>{row.result.label}</Status>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            icon="upload"
            title="No imports yet"
            body="Rows enter this dataset by import. Each committed import is receipted here with the file, parser and rows it wrote."
          />
        )}
      </Section>
    </div>
  )
}
