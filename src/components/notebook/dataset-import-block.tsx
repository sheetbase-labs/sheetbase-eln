import { useCallback, useEffect, useLayoutEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import { z } from 'zod'

import {
  ImportMapCheckFlow,
  ImportUploadFlow,
} from '#/components/import/import-flow'
import type { ImportSearch } from '#/components/import/import-search'
import { parseImportSearch } from '#/components/import/import-search'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { validateBlock } from '#/lib/blocks'
import { fetchDatasetImports, importQueryKeys } from '#/lib/import/data'
import type { DatasetImportRecord } from '#/lib/import/types'
import {
  fetchRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import type { BlockEditorProps } from './block-editor'
import { ConflictBanner } from './conflict-banner'
import { useAutosave } from './use-autosave'

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function draftSearch(search: ImportSearch) {
  const { step, parser, map, sheet, units, instrument } = search
  return Object.fromEntries(
    Object.entries({ step, parser, map, sheet, units, instrument }).filter(
      ([, value]) => value !== undefined,
    ),
  )
}

export function DatasetImportBlockEditor({
  block,
  save,
  offline,
  readOnly,
  onStatusChange,
  onInsertBelow,
}: BlockEditorProps) {
  const { auth } = useRouteContext({ from: '__root__' })
  const record = useQuery({
    queryKey: notebookQueryKeys.record(block.recordId),
    queryFn: () => fetchRecord(notebookDataClient, block.recordId),
  })
  const validate = useCallback((payload: Record<string, unknown>) => {
    const result = validateBlock({
      type: 'dataset_import',
      payload,
      payloadSchemaVersion: 1,
    })
    return result.ok ? [] : result.errors.map((error) => error.message)
  }, [])
  const autosave = useAutosave({
    initialValue: block.payload,
    validate,
    save,
    offline,
    touched: true,
  })
  const { draft, setDraft, status } = autosave
  const search = parseImportSearch(
    z.record(z.string(), z.unknown()).safeParse(draft.search).data ?? {},
  )
  useLayoutEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])
  const attachReceipt = useCallback(
    (receipt: DatasetImportRecord) => {
      setDraft((current) =>
        current.importId === receipt.id
          ? current
          : {
              fileId: current.fileId,
              datasetId: current.datasetId,
              importId: receipt.id,
              datasetVersionId: receipt.snapshot_version_id,
              sheetName: receipt.mapping?.sheetName,
            },
      )
    },
    [setDraft],
  )
  const fileId = text(draft.fileId)
  const datasetId = text(draft.datasetId)
  const returnTo = `/records/${block.recordId}/notebook`

  if (readOnly)
    return (
      <DatasetImportBlockPreview
        payload={block.payload}
        recordId={block.recordId}
      />
    )
  if (!auth?.workspace || !record.data)
    return (
      <Notice tone={record.isError ? 'bad' : 'info'}>
        {record.isError
          ? 'The notebook context could not be loaded.'
          : 'Loading notebook import…'}
      </Notice>
    )
  return (
    <section
      aria-label="Notebook data import"
      className="min-w-0 rounded-md border border-border"
    >
      {status === 'conflict' ? (
        <ConflictBanner
          message="This import block changed elsewhere."
          serverPreview={JSON.stringify(autosave.serverValue)}
          onUseServer={autosave.discardDraft}
          onKeepLocal={autosave.retry}
        />
      ) : null}
      {autosave.error ? (
        <Notice
          tone="bad"
          action={<Button onClick={autosave.retry}>Retry saving</Button>}
        >
          {autosave.error}
        </Notice>
      ) : null}
      {offline ? (
        <Notice>
          Reconnect to import data. The retained file is kept for retry.
        </Notice>
      ) : null}
      {status !== 'clean' ? (
        <p role="status" className="p-3 text-label">
          {autosave.statusLabel} — the file and imported data are retained.
        </p>
      ) : null}
      <fieldset
        disabled={
          offline ||
          status === 'conflict' ||
          status === 'failed' ||
          draft.fileId !== block.payload.fileId ||
          draft.importId !== block.payload.importId
        }
        className="m-0 min-w-0 border-0 p-0"
      >
        {text(draft.importId) ? (
          <>
            <DatasetImportBlockPreview
              payload={draft}
              recordId={block.recordId}
            />
            {onInsertBelow ? (
              <div className="px-4 pb-3">
                <Button onClick={() => onInsertBelow('dataset_import')}>
                  Import another file
                </Button>
              </div>
            ) : null}
          </>
        ) : fileId && datasetId ? (
          <ImportMapCheckFlow
            importId={fileId}
            search={{
              ...search,
              dataset: datasetId,
              experiment:
                record.data.kind === 'experiment' ? block.recordId : undefined,
              project: record.data.projectId ?? undefined,
              returnTo,
              sheet: search.sheet ?? text(draft.sheetName),
            }}
            onSearch={(next) =>
              setDraft({
                ...draft,
                search: draftSearch(next),
                sheetName: next.sheet,
              })
            }
            renderReceipt={(receipt) => (
              <AttachImportReceipt receipt={receipt} onAttach={attachReceipt} />
            )}
          />
        ) : (
          <ImportUploadFlow
            workspaceId={auth.workspace.id}
            createdByUserId={auth.user.id}
            initialExperimentId={
              record.data.kind === 'experiment' ? block.recordId : undefined
            }
            initialProjectId={record.data.projectId ?? undefined}
            returnTo={returnTo}
            onUploaded={async (uploadedId, next) => {
              setDraft({
                fileId: uploadedId,
                datasetId: next.dataset,
                search: draftSearch(next),
              })
            }}
          />
        )}
      </fieldset>
    </section>
  )
}

function AttachImportReceipt({
  receipt,
  onAttach,
}: {
  receipt: DatasetImportRecord
  onAttach: (receipt: DatasetImportRecord) => void
}) {
  useEffect(() => {
    onAttach(receipt)
  }, [receipt, onAttach])
  return (
    <p role="status" className="p-3 text-label">
      Import committed. Attaching its snapshot to this notebook…
    </p>
  )
}

export function DatasetImportBlockPreview({
  payload: value,
  recordId,
}: {
  payload: unknown
  recordId?: string
}) {
  const payload = z.record(z.string(), z.unknown()).safeParse(value).data ?? {}
  const datasetId = text(payload.datasetId)
  const importId = text(payload.importId)
  const versionId = text(payload.datasetVersionId)
  const returnTo = recordId ? `/records/${recordId}/notebook` : undefined
  const receipts = useQuery({
    queryKey: importQueryKeys.imports(datasetId ?? ''),
    queryFn: () => fetchDatasetImports(notebookDataClient, datasetId!),
    enabled: Boolean(datasetId && importId && versionId),
  })
  if (!importId || !versionId || !datasetId)
    return (
      <Notice icon="upload" title="Import data">
        {text(payload.fileId)
          ? 'File retained. Select this block to continue mapping and validation.'
          : 'Select this block to upload a file into a Dataset.'}
      </Notice>
    )
  if (receipts.isPending)
    return (
      <p role="status" className="p-3 text-label">
        Loading import receipt…
      </p>
    )
  const receipt = receipts.data?.find(
    (item) =>
      item.id === importId &&
      item.file_id === payload.fileId &&
      item.snapshot_version_id === versionId &&
      item.status === 'committed',
  )
  if (!receipt)
    return (
      <Notice tone="warn" title="Import evidence unavailable">
        The pinned receipt could not be read. Live data is not substituted.
      </Notice>
    )
  const filename = text(receipt.source_provenance.filename) ?? 'Imported file'
  return (
    <div className="grid min-w-0 gap-3 p-4">
      <div>
        <h3 className="text-body font-semibold">{filename}</h3>
        <p className="text-label text-fg-muted">
          {receipt.imported_row_ids.length} imported observations · pinned
          Dataset snapshot
        </p>
      </div>
      <div className="flex flex-wrap gap-3 text-label">
        <Link
          className="text-link"
          to="/datasets/$datasetId/rows"
          params={{ datasetId }}
          search={{ snapshot: versionId }}
        >
          View imported data
        </Link>
        <Link
          className="text-link"
          to="/analysis/new"
          search={{
            dataset: datasetId,
            snapshot: versionId,
            mode: 'analyse',
            returnTo,
          }}
        >
          Analyse this snapshot
        </Link>
        <Link
          className="text-link"
          to="/import/$importId"
          params={{ importId: text(payload.fileId)! }}
          search={{
            dataset: datasetId,
            sheet: text(payload.sheetName),
            returnTo,
          }}
        >
          View import receipt
        </Link>
      </div>
      <p className="m-0 break-all text-caption text-fg-muted">
        Source SHA-256:{' '}
        {text(receipt.source_provenance.checksum) ?? 'Not available'}
      </p>
    </div>
  )
}
