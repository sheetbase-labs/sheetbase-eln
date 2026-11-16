import { t } from '#/copy'
import { useCallback, useEffect, useLayoutEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import { z } from 'zod'

import {
  ImportMapCheckFlow,
  ImportUploadFlow,
} from '#/components/import/import-flow'
import type { ImportSearch } from '#/components/import/import-search'
import { parseImportSearch } from '#/components/import/import-search'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/sonner'
import { openDatasetInNewSheet } from '#/lib/sheet-from-dataset'
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

const nonemptyText = z.string().min(1).optional().catch(undefined)
const text = nonemptyText.parse.bind(nonemptyText)

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

  const validate = useCallback(
    (payload: BlockEditorProps['block']['payload']) => {
      const result = validateBlock({
        type: 'dataset_import',
        payload,
        payloadSchemaVersion: 1,
      })

      return result.ok ? [] : result.errors.map((error) => error.message)
    },
    [],
  )

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
    // react-doctor-disable-next-line react-doctor/no-prop-callback-in-effect -- The mounted import editor owns its draft/conflict lifetime; this committed status drives the document navigation guard, not parent draft state.
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

  if (readOnly)
    return (
      <DatasetImportBlockPreview
        payload={block.payload}
        recordId={block.recordId}
        blockId={block.id}
        readOnly
      />
    )

  if (!auth?.workspace || !record.data)
    return (
      <Notice tone={record.isError ? 'bad' : 'info'}>
        {record.isError
          ? t('notebook.datasetImportBlock.theNotebookContextCould')
          : t('notebook.datasetImportBlock.loadingNotebookImport')}
      </Notice>
    )

  return (
    <section
      aria-label={t('notebook.datasetImportBlock.ariaLabel')}
      className="min-w-0 rounded-md border border-border"
    >
      {status === 'conflict' ? (
        <ConflictBanner
          message={t('notebook.datasetImportBlock.changedElsewhere')}
          serverPreview={JSON.stringify(autosave.serverValue)}
          onUseServer={autosave.discardDraft}
          onKeepLocal={autosave.retry}
        />
      ) : null}
      {autosave.error ? (
        <Notice
          tone="bad"
          action={
            <Button onClick={autosave.retry}>
              {t('notebook.datasetImportBlock.retrySaving')}
            </Button>
          }
        >
          {autosave.error}
        </Notice>
      ) : null}
      {offline ? (
        <Notice>
          {t('notebook.datasetImportBlock.reconnectToImportData')}
        </Notice>
      ) : null}
      {status !== 'clean' ? (
        <p role="status" className="p-3 text-label">
          {t('notebook.datasetImportBlock.statuslabelTheFileAnd', {
            statusLabel: autosave.statusLabel,
          })}
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
        <ImportDraftFlow
          blockId={block.id}
          draft={draft}
          setDraft={setDraft}
          record={record.data}
          workspaceId={auth.workspace.id}
          createdByUserId={auth.user.id}
          search={search}
          onInsertBelow={onInsertBelow}
          onAttach={attachReceipt}
        />
      </fieldset>
    </section>
  )
}

/** Upload/mapping/receipt navigation edits only the import editor's local draft. */
function ImportDraftFlow({
  blockId,
  draft,
  setDraft,
  record,
  workspaceId,
  createdByUserId,
  search,
  onInsertBelow,
  onAttach,
}: {
  blockId: string
  draft: BlockEditorProps['block']['payload']
  setDraft: React.Dispatch<
    React.SetStateAction<BlockEditorProps['block']['payload']>
  >
  record: NonNullable<Awaited<ReturnType<typeof fetchRecord>>>
  workspaceId: string
  createdByUserId: string
  search: ImportSearch
  onInsertBelow: BlockEditorProps['onInsertBelow']
  onAttach: (receipt: DatasetImportRecord) => void
}) {
  const fileId = text(draft.fileId)
  const datasetId = text(draft.datasetId)
  const returnTo = `/records/${record.id}/notebook`

  return text(draft.importId) ? (
    <>
      <DatasetImportBlockPreview
        payload={draft}
        recordId={record.id}
        blockId={blockId}
      />
      {onInsertBelow ? (
        <div className="px-4 pb-3">
          <Button onClick={() => onInsertBelow('dataset_import')}>
            {t('notebook.datasetImportBlock.importAnotherFile')}
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
        experiment: record.kind === 'experiment' ? record.id : undefined,
        project: record.projectId ?? undefined,
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
        <AttachImportReceipt receipt={receipt} onAttach={onAttach} />
      )}
    />
  ) : (
    <ImportUploadFlow
      workspaceId={workspaceId}
      createdByUserId={createdByUserId}
      initialExperimentId={record.kind === 'experiment' ? record.id : undefined}
      initialProjectId={record.projectId ?? undefined}
      returnTo={returnTo}
      onUploaded={async (uploadedId, next) => {
        setDraft({
          fileId: uploadedId,
          datasetId: next.dataset,
          search: draftSearch(next),
        })
      }}
    />
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
      {t('notebook.datasetImportBlock.importCommittedAttachingIts')}
    </p>
  )
}

/** Makes a sheet from the imported data and places it right below the import. */
function ShowInSheetButton({
  datasetId,
  recordId,
  blockId,
}: {
  datasetId: string
  recordId: string
  blockId: string
}) {
  const queryClient = useQueryClient()

  const makeSheet = useMutation({
    mutationFn: () =>
      openDatasetInNewSheet(notebookDataClient, {
        datasetId,
        notebookRecordId: recordId,
        afterBlockId: blockId,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: notebookQueryKeys.blocks(recordId),
        }),
        queryClient.invalidateQueries({
          queryKey: notebookQueryKeys.record(recordId),
        }),
      ])
      toast(t('notebook.datasetImportBlock.sheetAddedBelow'))
    },
    onError: (error) =>
      toast.error(t('notebook.datasetImportBlock.sheetNotMade'), {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

  return (
    <Button
      variant="primary"
      size="sm"
      disabled={makeSheet.isPending}
      onClick={() => makeSheet.mutate()}
    >
      {makeSheet.isPending
        ? t('notebook.datasetImportBlock.makingSheet')
        : t('notebook.datasetImportBlock.showInASheet')}
    </Button>
  )
}

function ReceiptLinks({
  datasetId,
  versionId,
  fileId,
  sheetName,
  recordId,
  blockId,
  canMakeSheet,
}: {
  datasetId: string
  versionId: string
  fileId: string
  sheetName: string | undefined
  recordId?: string
  blockId?: string
  canMakeSheet: boolean
}) {
  const returnTo = recordId ? `/records/${recordId}/notebook` : undefined

  return (
    <div className="flex flex-wrap gap-3 text-label">
      {recordId && blockId && canMakeSheet ? (
        <ShowInSheetButton
          datasetId={datasetId}
          recordId={recordId}
          blockId={blockId}
        />
      ) : null}
      <Link
        className="text-link"
        to="/sheets/new"
        search={{ dataset: datasetId, experiment: recordId, returnTo }}
      >
        {recordId && blockId && canMakeSheet
          ? t('notebook.datasetImportBlock.chooseSheetDefinition')
          : t('notebook.datasetImportBlock.openInASheet')}
      </Link>
      <Link
        className="text-link"
        to="/datasets/$datasetId/rows"
        params={{ datasetId }}
        search={{ snapshot: versionId }}
      >
        {t('notebook.datasetImportBlock.viewImportedData')}
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
        {t('notebook.datasetImportBlock.analyseThisSnapshot')}
      </Link>
      <Link
        className="text-link"
        to="/import/$importId"
        params={{ importId: fileId }}
        search={{
          dataset: datasetId,
          sheet: sheetName,
          returnTo,
        }}
      >
        {t('notebook.datasetImportBlock.viewImportReceipt')}
      </Link>
    </div>
  )
}

export function DatasetImportBlockPreview({
  payload: value,
  recordId,
  blockId,
  readOnly = false,
}: {
  payload: unknown
  recordId?: string
  /** The import block, so a sheet made from its data lands right below it. */
  blockId?: string
  readOnly?: boolean
}) {
  const payload = z.record(z.string(), z.unknown()).safeParse(value).data ?? {}
  const datasetId = text(payload.datasetId)
  const importId = text(payload.importId)
  const versionId = text(payload.datasetVersionId)

  const receipts = useQuery({
    queryKey: importQueryKeys.imports(datasetId ?? ''),
    queryFn: () => fetchDatasetImports(notebookDataClient, datasetId!),
    enabled: Boolean(datasetId && importId && versionId),
  })

  if (!importId || !versionId || !datasetId)
    return (
      <Notice icon="upload" title={t('notebook.datasetImportBlock.title')}>
        {text(payload.fileId)
          ? t('notebook.datasetImportBlock.fileRetainedSelectThis')
          : t('notebook.datasetImportBlock.selectThisBlockTo')}
      </Notice>
    )

  if (receipts.isPending)
    return (
      <p role="status" className="p-3 text-label">
        {t('notebook.datasetImportBlock.loadingImportReceipt')}
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
      <Notice
        tone="warn"
        title={t('notebook.datasetImportBlock.importEvidenceUnavailableTitle')}
      >
        {t('notebook.datasetImportBlock.thePinnedReceiptCould')}
      </Notice>
    )

  const filename =
    text(receipt.source_provenance.filename) ??
    t('notebook.datasetImportBlock.importedFile')

  return (
    <div className="grid min-w-0 gap-3 p-4">
      <div>
        <h3 className="text-body font-semibold">{filename}</h3>
        <p className="text-label text-fg-muted">
          {t('notebook.datasetImportBlock.countImportedObservationsPinned', {
            count: receipt.imported_row_ids.length,
          })}
        </p>
      </div>
      <ReceiptLinks
        datasetId={datasetId}
        versionId={versionId}
        fileId={text(payload.fileId)!}
        sheetName={text(payload.sheetName)}
        recordId={recordId}
        blockId={blockId}
        canMakeSheet={!readOnly}
      />
      <p className="m-0 text-caption text-fg-muted">
        {t('notebook.datasetImportBlock.aNewSheetUses')}
      </p>
      <p className="m-0 break-all text-caption text-fg-muted">
        {t('notebook.datasetImportBlock.sourceSha256Text', {
          text:
            text(receipt.source_provenance.checksum) ??
            t('notebook.datasetImportBlock.notAvailable'),
        })}
      </p>
    </div>
  )
}
