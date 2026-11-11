import { PickerSelect } from '#/components/record-picker/entity-picker'
import type { PickerOption } from '#/components/record-picker/entity-picker'
import {
  datasetOption,
  recordSearch,
} from '#/components/record-picker/entity-options'
import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { cn } from '#/lib/utils'
import { Banner } from '#/components/ui/alert'
import { BlockedImportDialog } from '#/components/contracts/blocked-import-dialog'
import type { ContractGateReport } from '#/lib/data-contracts/types'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { FileDrop } from '#/components/ui/file-drop'
import { Input } from '#/components/ui/input'
import { PageHeader, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { Stepper } from '#/components/ui/stepper'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableBox,
  TableRow,
} from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Select } from '#/components/ui/select'
import { usePageAi } from '#/lib/use-page-ai'
import {
  buildMappingInstruction,
  changesFromSuggestions,
  parseMappingAnswer,
} from '#/lib/ai-import-mapping'
import type { AiMappingSuggestion } from '#/lib/ai-import-mapping'
import { useExperimentRecords } from '#/components/experiments/experiments-data'
import {
  calibrationStatus,
  useInstruments,
  useLatestCalibrationsByInstrument,
} from '#/components/instruments/instruments-data'
import { cancelTarget } from '#/lib/create-context-search'
import { createDataClient } from '#/lib/data-client'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import { listPublishedDatasetSchemas } from '#/lib/dataset-product'
import { formatFileSize } from '#/lib/format-numbers'
import {
  describeRejectedImport,
  REJECTED_ROWS_PREFIX,
} from '#/lib/import-commit'
import {
  datasetFieldsFromColumns,
  importHeaderUnit,
  importUnitError,
} from '#/lib/import-mapping'
import type { ImportTargetField } from '#/lib/import-mapping'
import { requestParserUpdate } from '#/lib/parser-settings'
import {
  commitImport,
  fetchDatasetImports,
  fetchImportFile,
  ImportRequestError,
  importQueryKeys,
  resolveImportTarget,
  reviewImport,
  saveParserMapping,
  uploadImportFile,
} from '#/lib/import/data'
import type {
  DatasetImportRecord,
  ImportMappingDocument,
  ImportParserSummary,
  ImportReviewResponse,
  ImportSheetPreview,
} from '#/lib/import/types'

import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import {
  fileExtension,
  pickInstrumentParser,
  readWithImporter,
  readWithInstrumentParser,
} from '#/lib/extensions/plugin-files'
import { FileColumnsStep } from './file-columns-step'
import { PluginPullPanel } from './plugin-pull-panel'
import type { FileColumnsResult } from './file-columns-step'
import { ImportReceipt } from './import-receipt'
import { findCommittedReceipt } from './import-receipt-data'
import type { ImportSearch } from './import-search'
import { parseImportMapping, serializeImportMapping } from './import-search'
import {
  columnExamples,
  columnNote,
  commitIdempotencyKey,
  initialMappingValues,
  importViewState,
  outcomeLabel,
  outcomeTone,
  suggestDatasetFromFilename,
  suggestParserFromFilename,
  uploadTargetState,
} from './import-flow-data'

const client = createDataClient()

const STEPS = [
  t('common.actions.upload'),
  t('data.importFlow.mapColumns'),
  t('data.importFlow.reviewImport'),
]

const DATASETS_QUERY_KEY = ['ui-port', 'import', 'datasets'] as const
const SCHEMAS_QUERY_KEY = ['ui-port', 'import', 'schemas'] as const

export type { ImportSearch } from './import-search'

/** Experiments to link a file to: searched on the server, not preloaded. */
const experimentSearch = recordSearch(['Experiment'])

const BUILT_IN_EXTENSIONS = ['.csv', '.tsv', '.tab', '.txt', '.json', '.xlsx']

interface ImportCommitResponseSummary {
  committed: number
  importId: string | null
  snapshotVersionId: string | null
  outcome: Record<string, number>
}

/**
 * DSET-05 — step 1: choose what the import writes into (an existing Dataset, or
 * a new one named here), then store the file checksum-first and parse it on the
 * server. The stored file's id becomes the import's address, so every later
 * step is linkable and recoverable (R5-SURF-04).
 */
function TargetChoice({
  group,
  checked,
  onChange,
  disabled,
  title,
  hint,
}: {
  group: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
  title: string
  hint: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 hover:bg-surface-hover',
        checked && 'border-link bg-selection-subtle',
        disabled && 'cursor-default bg-surface-disabled text-fg-muted',
      )}
    >
      <input
        type="radio"
        name={group}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="min-w-0">
        <span className="block font-medium text-fg">{title}</span>
        <span className="block text-fg-muted">{hint}</span>
      </span>
    </label>
  )
}

function useUploadContext() {
  const targetGroup = useId()

  const datasets = useQuery({
    queryKey: DATASETS_QUERY_KEY,
    queryFn: () => fetchDatasetSummaries(client),
    staleTime: 15_000,
  })

  const schemas = useQuery({
    queryKey: SCHEMAS_QUERY_KEY,
    queryFn: () => listPublishedDatasetSchemas(client),
    staleTime: 60_000,
  })

  const experiments = useExperimentRecords(undefined)
  const instruments = useInstruments()
  const calibrations = useLatestCalibrationsByInstrument()

  return {
    targetGroup,
    datasets,
    schemas,
    experiments,
    instruments,
    calibrations,
  }
}

function useImportReaders() {
  // File formats and tools that installed plugins add to the upload step.
  const pluginPoints = useExtensionPoints()
  const pluginImporters = pluginPoints.data.importers
  const pluginConnectors = pluginPoints.data.connectors
  const pluginParsers = pluginPoints.data['instrument-parsers']

  const pluginImporterExtensions = useMemo(
    () => [
      ...new Set(
        pluginImporters.flatMap((item) => item.declaration.extensions),
      ),
    ],
    [pluginImporters],
  )

  const pluginExtensions = useMemo(
    () => [
      ...new Set([
        ...pluginImporterExtensions,
        ...pluginParsers.flatMap((item) => item.declaration.extensions),
      ]),
    ],
    [pluginImporterExtensions, pluginParsers],
  )

  /** A file in a format a plugin reads becomes a table first; anything else is left alone. */
  async function readable(file: File): Promise<File> {
    // An instrument's own file: a plugin parser that recognises it takes it.
    // Formats Sheetbase already reads are only taken when the parser says
    // what its files carry, so a parser can't swallow every CSV or sheet.
    const extension = fileExtension(file.name)
    const builtIn = BUILT_IN_EXTENSIONS.includes(extension)

    const asText = pluginParsers.some(
      (item) =>
        item.declaration.extensions.includes(extension) &&
        item.declaration.encoding === 'text',
    )
      ? await file.slice(0, 200_000).text()
      : null

    const parser = pickInstrumentParser(
      pluginParsers.filter(
        (item) => !builtIn || Boolean(item.declaration.contains),
      ),
      file.name,
      asText,
    )

    if (parser) {
      try {
        return await readWithInstrumentParser({
          extensionKey: parser.extensionKey,
          parserId: parser.id,
          encoding: parser.declaration.encoding,
          file,
        })
      } catch (error) {
        // A parser that cannot tell from the outside (a sheet) may find the
        // file isn't its instrument's after all; carry on with the usual read.
        if (!builtIn) throw error
      }
    }

    const importer = pluginImporters.find((item) =>
      item.declaration.extensions.includes(fileExtension(file.name)),
    )

    if (!importer) return file

    return readWithImporter({
      extensionKey: importer.extensionKey,
      importerId: importer.id,
      encoding: importer.declaration.encoding,
      file,
    })
  }

  return {
    pluginConnectors,
    pluginParsers,
    pluginImporterExtensions,
    pluginExtensions,
    readable,
  }
}

function useUploadTarget({
  initialInstrumentId,
  initialExperimentId,
  initialDatasetId,
}: ImportUploadProps) {
  const {
    targetGroup,
    datasets,
    schemas,
    experiments,
    instruments,
    calibrations,
  } = useUploadContext()

  const {
    pluginConnectors,
    pluginParsers,
    pluginImporterExtensions,
    pluginExtensions,
    readable,
  } = useImportReaders()

  const [mode, setMode] = useState<'append' | 'new' | 'file' | null>(null)

  // A file already read, waiting for its table's columns to be set up.
  const [columnsStage, setColumnsStage] = useState<{
    fileId: string
    filename: string
    sheet: ImportSheetPreview
  } | null>(null)

  const [datasetId, setDatasetId] = useState(initialDatasetId ?? '')
  const [schemaVersionId, setSchemaVersionId] = useState('')
  const [newName, setNewName] = useState('')
  const [experimentId, setExperimentId] = useState(initialExperimentId ?? '')

  const [experimentOption, setExperimentOption] = useState<PickerOption | null>(
    null,
  )

  // The experiment the page was opened from is named before anything is picked.
  const initialExperiment = initialExperimentId
    ? experiments.data?.find((item) => item.id === initialExperimentId)
    : undefined

  const initialExperimentOption: PickerOption | null = initialExperiment
    ? {
        id: initialExperiment.id,
        identifier: initialExperiment.identifier,
        label: initialExperiment.title,
      }
    : null

  const [instrumentId, setInstrumentId] = useState(initialInstrumentId ?? '')
  // A file picked before the target is chosen is held here until it is.
  const [held, setHeld] = useState<File | null>(null)
  const [suggested, setSuggested] = useState<string | null>(null)
  const [holdError, setHoldError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const datasetRows = datasets.data ?? []
  const structureRows = schemas.data ?? []

  // With nothing to append to, a table made from the file itself is the way in:
  // the first import never waits for someone to define columns.
  const { effectiveMode, targetReady } = uploadTargetState({
    mode,
    datasetCount: datasetRows.length,
    structureCount: structureRows.length,
    datasetId,
    schemaVersionId,
    newName,
  })

  const latestCalibration = instrumentId
    ? calibrations.data?.get(instrumentId)
    : undefined

  const calibration = calibrationStatus(latestCalibration?.dueAt ?? null)

  return {
    targetGroup,
    datasets,
    schemas,
    experiments,
    instruments,
    pluginConnectors,
    pluginParsers,
    pluginImporterExtensions,
    pluginExtensions,
    readable,
    setMode,
    columnsStage,
    setColumnsStage,
    datasetId,
    setDatasetId,
    schemaVersionId,
    setSchemaVersionId,
    newName,
    setNewName,
    experimentId,
    setExperimentId,
    experimentOption,
    setExperimentOption,
    initialExperimentOption,
    instrumentId,
    setInstrumentId,
    held,
    setHeld,
    suggested,
    setSuggested,
    holdError,
    setHoldError,
    starting,
    setStarting,
    datasetRows,
    structureRows,
    effectiveMode,
    targetReady,
    calibration,
  }
}

interface ImportUploadProps {
  workspaceId: string
  /** The signed-in person a Dataset created here is attributed to. */
  createdByUserId: string | null
  /** Preselects the instrument, e.g. from an instrument's "Upload a file" action. */
  initialInstrumentId?: string
  /** Preselects the experiment, e.g. from the experiment the person is in. */
  initialExperimentId?: string
  /** Preselects the Dataset to append to, e.g. from a Dataset's Re-import. */
  initialDatasetId?: string
  /** The project in view; a Dataset created here belongs to it. */
  initialProjectId?: string
  /** Where Cancel goes back to, when the person came from another page. */
  returnTo?: string
  /** An embedded host retains the file and target before opening mapping. */
  onUploaded?: (fileId: string, search: ImportSearch) => Promise<void>
}

function useImportUpload(props: ImportUploadProps) {
  const {
    workspaceId,
    createdByUserId,
    initialProjectId,
    returnTo,
    onUploaded,
  } = props

  const uploadTarget = useUploadTarget(props)

  const {
    experiments,
    readable,
    effectiveMode,
    setColumnsStage,
    schemaVersionId,
    newName,
    experimentId,
    datasetId,
    instrumentId,
    setHoldError,
    setHeld,
    setSuggested,
    targetReady,
    datasetRows,
    setDatasetId,
    held,
    setStarting,
  } = uploadTarget

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  /**
   * Step 1 hands the picked file straight to the shared transport. The pick's
   * own progress and failure belong to the file field, which is why this
   * function no longer tracks them: it resolves when the file is stored and
   * parsed, and a rejection becomes the row's message with its retry.
   */
  async function experimentProjectId(id: string): Promise<string | null> {
    if (!id) return null
    const loaded = experiments.data?.find((item) => item.id === id)

    if (loaded) return loaded.project_id ?? null

    const rows = await client.list<{ project_id: string | null }>(
      'records',
      `?id=eq.${encodeURIComponent(id)}&select=project_id&limit=1`,
    )

    return rows.at(0)?.project_id ?? null
  }

  async function start(picked: File) {
    const file = await readable(picked)

    if (effectiveMode === 'file') {
      // Read the file first; its columns are what the new table is made from.
      const upload = await uploadImportFile({ file, datasetId: null })

      if (!upload.sheet) {
        throw new Error(
          upload.parseError ?? t('data.importFlow.fileColumns.failed'),
        )
      }

      setColumnsStage({
        fileId: upload.fileId,
        filename: upload.filename,
        sheet: upload.sheet,
      })

      return
    }

    const target = await resolveImportTarget(
      client,
      effectiveMode === 'new'
        ? {
            mode: 'new',
            workspaceId,
            schemaVersionId,
            name: newName,
            createdByUserId,
            // A Dataset made for an experiment belongs to that experiment's
            // project, unless the page it was started from named one.
            primaryProjectId:
              initialProjectId ?? (await experimentProjectId(experimentId)),
          }
        : { mode: 'append', datasetId },
    )

    const upload = await uploadImportFile({
      file,
      datasetId: target.datasetId,
    })

    if (target.created) {
      void queryClient.invalidateQueries({ queryKey: DATASETS_QUERY_KEY })
    }

    const search: ImportSearch = {
      step: 'map',
      dataset: target.datasetId,
      experiment: experimentId || undefined,
      instrument: instrumentId || undefined,
      project: initialProjectId,
      returnTo,
    }

    if (onUploaded) {
      await onUploaded(upload.fileId, search)

      return
    }

    await navigate({
      to: '/import/$importId',
      params: { importId: upload.fileId },
      search,
    })
  }

  /**
   * The file comes first. With a target already chosen it is stored at once;
   * without one it is held, a Dataset is suggested from its name, and the
   * person confirms where it goes.
   */
  function pick(file: File | null): void | Promise<void> {
    setHoldError(null)

    if (!file) {
      setHeld(null)
      setSuggested(null)

      return undefined
    }

    if (targetReady) return start(file)
    setHeld(file)

    if (effectiveMode === 'append' && !datasetId) {
      const match = suggestDatasetFromFilename(file.name, datasetRows)

      if (match) {
        setDatasetId(match.id)
        setSuggested(match.id)
      }
    }

    return undefined
  }

  async function startHeld() {
    if (!held) return
    setStarting(true)
    setHoldError(null)

    try {
      await start(held)
    } catch (failure) {
      setHoldError(
        failure instanceof Error
          ? failure.message
          : t('data.importFlow.fileCouldUploaded'),
      )
    } finally {
      setStarting(false)
    }
  }

  return { ...uploadTarget, pick, startHeld }
}

export function ImportUploadFlow(props: ImportUploadProps) {
  const upload = useImportUpload(props)

  return upload.columnsStage ? (
    <UploadColumns upload={upload} props={props} />
  ) : (
    <UploadFileStep upload={upload} props={props} />
  )
}

function UploadColumns({
  upload,
  props,
}: {
  upload: ReturnType<typeof useImportUpload>
  props: ImportUploadProps
}) {
  const {
    workspaceId,
    createdByUserId,
    initialProjectId,
    returnTo,
    onUploaded,
  } = props

  const {
    columnsStage,
    experiments,
    experimentId,
    instrumentId,
    setColumnsStage,
  } = upload

  const queryClient = useQueryClient()
  const navigate = useNavigate()

  if (columnsStage) {
    const experimentProject =
      experiments.data?.find((item) => item.id === experimentId)?.project_id ??
      null

    return (
      <FileColumnsStep
        workspaceId={workspaceId}
        createdByUserId={createdByUserId}
        fileId={columnsStage.fileId}
        filename={columnsStage.filename}
        initialSheet={columnsStage.sheet}
        projectId={initialProjectId ?? experimentProject}
        onBack={() => setColumnsStage(null)}
        onCreated={async (result: FileColumnsResult) => {
          void queryClient.invalidateQueries({ queryKey: DATASETS_QUERY_KEY })

          const search: ImportSearch = {
            step: 'map',
            dataset: result.datasetId,
            experiment: experimentId || undefined,
            instrument: instrumentId || undefined,
            project: initialProjectId,
            returnTo,
            map: result.map,
            units: result.units,
            sheet: result.sheet,
          }

          if (onUploaded) {
            await onUploaded(columnsStage.fileId, search)

            return
          }

          await navigate({
            to: '/import/$importId',
            params: { importId: columnsStage.fileId },
            search,
          })
        }}
      />
    )
  }

  return null
}

function UploadFileStep({
  upload,
  props,
}: {
  upload: ReturnType<typeof useImportUpload>
  props: ImportUploadProps
}) {
  const { onUploaded, initialProjectId, returnTo } = props

  const {
    experimentId,
    pluginExtensions,
    pluginImporterExtensions,
    pluginParsers,
    pluginConnectors,
    pick,
    held,
    targetReady,
    holdError,
    starting,
    startHeld,
  } = upload

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={
          onUploaded
            ? undefined
            : [
                {
                  label: t('data.importFlow.datasets'),
                  link: { to: '/datasets' },
                },
                { label: t('data.importFlow.importData') },
              ]
        }
        title={t('data.importFlow.importData')}
        titleLevel={onUploaded ? 2 : 1}
        meta={t('data.importFlow.storeFileCheckColumns')}
        actions={
          !onUploaded ? (
            <Button
              data-keep-inline
              nativeButton={false}
              render={
                <Link
                  to={cancelTarget(
                    {
                      experiment: experimentId || undefined,
                      project: initialProjectId,
                      returnTo,
                    },
                    '/datasets',
                  )}
                />
              }
            >
              {t('common.actions.cancel')}
            </Button>
          ) : null
        }
      />
      <div className="px-4 py-4 md:px-6">
        <Stepper steps={STEPS} current={1} className="mb-4" />

        <div className="grid gap-4">
          <FileDrop
            label={t('data.importFlow.laboratoryFile')}
            inputLabel={t('data.importFlow.laboratoryFile')}
            accept={[
              '.csv,.tsv,.tab,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              ...pluginExtensions,
            ].join(',')}
            onFile={pick}
          />
          {pluginImporterExtensions.length > 0 ? (
            <p className="m-0 text-label text-fg-muted">
              {t('plugins.import.readable', {
                formats: pluginImporterExtensions.join(', '),
              })}
            </p>
          ) : null}
          {pluginParsers.length > 0 ? (
            <p className="m-0 text-label text-fg-muted">
              {t('plugins.import.instrumentFiles', {
                instruments: [
                  ...new Set(
                    pluginParsers.map(
                      (item) =>
                        item.declaration.instrument ?? item.declaration.title,
                    ),
                  ),
                ].join(', '),
              })}
            </p>
          ) : null}
          {pluginConnectors.length > 0 ? (
            <PluginPullPanel connectors={pluginConnectors} onFile={pick} />
          ) : null}
          {held && !targetReady ? (
            <p role="status" className="m-0 text-body text-fg-muted">
              {t('data.importFlow.nowChooseWhereGoes', { name: held.name })}
            </p>
          ) : null}
          {held && targetReady ? (
            <div className="flex max-w-[420px] flex-col gap-2">
              {holdError ? (
                <Banner
                  tone="bad"
                  title={t('data.importFlow.fileCouldUploaded')}
                >
                  {holdError}
                </Banner>
              ) : null}
              <Button
                variant="primary"
                className="self-start"
                disabled={starting}
                onClick={() => void startHeld()}
              >
                {starting
                  ? t('data.importFlow.uploading')
                  : t('data.importFlow.uploadContinue')}
              </Button>
            </div>
          ) : null}

          <UploadTargetFields upload={upload} props={props} />
        </div>
      </div>
    </div>
  )
}

/** Target selection and the context attached to the stored file. */
function UploadTargetFields({
  upload,
  props,
}: {
  upload: ReturnType<typeof useImportUpload>
  props: ImportUploadProps
}) {
  const {
    targetGroup,
    datasets,
    schemas,
    datasetRows,
    structureRows,
    effectiveMode,
    setMode,
  } = upload

  return (
    <>
      <div className="grid max-w-[640px] gap-1.5 text-label text-fg-muted">
        <span className="font-medium text-fg">
          {t('data.importFlow.whereGoes')}
        </span>
        {datasets.isLoading ? (
          <p role="status" className="m-0 text-body text-fg-muted">
            {t('data.importFlow.readingDatasets')}
          </p>
        ) : null}
        {datasets.isError ? (
          <Banner tone="bad" title={t('data.importFlow.datasetsCouldRead')}>
            {t('data.importFlow.listDidLoadSo')}
            <Button variant="quiet" onClick={() => void datasets.refetch()}>
              {t('common.actions.tryAgain')}
            </Button>
          </Banner>
        ) : null}
        <TargetChoice
          group={targetGroup}
          checked={effectiveMode === 'file'}
          onChange={() => setMode('file')}
          title={t('data.importFlow.fromFileTitle')}
          hint={
            datasetRows.length === 0 && structureRows.length === 0
              ? `${t('data.importFlow.fromFileHint')} ${t('data.importFlow.fromFileRecommended')}`
              : t('data.importFlow.fromFileHint')
          }
        />
        <TargetChoice
          group={targetGroup}
          checked={effectiveMode === 'new'}
          onChange={() => setMode('new')}
          disabled={structureRows.length === 0 && schemas.isSuccess}
          title={t('data.importFlow.likeTableTitle')}
          hint={t('data.importFlow.likeTableHint')}
        />
        <TargetChoice
          group={targetGroup}
          checked={effectiveMode === 'append'}
          onChange={() => setMode('append')}
          disabled={datasetRows.length === 0 && datasets.isSuccess}
          title={t('data.importFlow.appendTitle')}
          hint={
            datasetRows.length === 0 && datasets.isSuccess
              ? t('data.importFlow.nothingToAppend')
              : t('data.importFlow.appendHint')
          }
        />
      </div>

      <UploadDatasetFields upload={upload} />
      <UploadContextFields upload={upload} props={props} />
    </>
  )
}

function UploadDatasetFields({
  upload,
}: {
  upload: ReturnType<typeof useImportUpload>
}) {
  const {
    effectiveMode,
    datasetId,
    setDatasetId,
    setSuggested,
    datasetRows,
    suggested,
    schemaVersionId,
    setSchemaVersionId,
    schemas,
    newName,
    setNewName,
  } = upload

  return (
    <>
      {effectiveMode === 'file' ? null : effectiveMode === 'append' ? (
        <label className="grid max-w-[420px] gap-1 text-label text-fg-muted">
          {t('data.importFlow.dataset')}
          <PickerSelect
            noun="dataset"
            aria-label={t('data.importFlow.ariaImportIntoDataset')}
            value={datasetId}
            onChange={(id) => {
              setDatasetId(id)
              setSuggested(null)
            }}
            placeholder={t('data.importFlow.chooseDataset')}
            options={datasetRows.map((item) =>
              datasetOption({
                id: item.id,
                name: item.name,
                displayId: item.display_id,
              }),
            )}
          />
          {suggested && suggested === datasetId ? (
            <span>{t('data.importFlow.suggestedFromFileName')}</span>
          ) : null}
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-label text-fg-muted">
            {t('data.importFlow.datasetSchema2')}
            <PickerSelect
              noun="dataset schema"
              aria-label={t('data.importFlow.ariaLabel')}
              value={schemaVersionId}
              onChange={(id) => setSchemaVersionId(id)}
              placeholder={t('data.importFlow.placeholder')}
              options={(schemas.data ?? []).map((schema) => ({
                id: schema.schemaVersionId,
                label: schema.name,
                detail: t('data.importFlow.detail', {
                  version: schema.version,
                }),
              }))}
            />
          </label>
          <label className="grid gap-1 text-label text-fg-muted">
            {t('data.importFlow.datasetName')}
            <Input
              aria-label={t('data.importFlow.ariaNewDatasetName')}
              value={newName}
              placeholder={t('data.importFlow.placeholderEGElisaCapsid')}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
        </div>
      )}
    </>
  )
}

function UploadContextFields({
  upload,
  props,
}: {
  upload: ReturnType<typeof useImportUpload>
  props: ImportUploadProps
}) {
  const { onUploaded, initialExperimentId } = props

  const {
    experimentId,
    setExperimentId,
    setExperimentOption,
    experimentOption,
    initialExperimentOption,
    instrumentId,
    setInstrumentId,
    instruments,
    calibration,
    effectiveMode,
  } = upload

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-label text-fg-muted">
          {t('data.importFlow.linkExperiment')}
          <PickerSelect
            noun="experiment"
            aria-label={t('data.importFlow.linkExperiment')}
            value={experimentId}
            placeholder={t('data.importFlow.noExperiment')}
            disabled={Boolean(onUploaded && initialExperimentId)}
            onChange={(id, option) => {
              setExperimentId(id)
              setExperimentOption(option)
            }}
            selected={experimentOption ?? initialExperimentOption}
            clearLabel={t('data.importFlow.noExperiment')}
            search={experimentSearch}
          />
        </label>
        <label className="grid gap-1 text-label text-fg-muted">
          {t('data.importFlow.instrument')}
          <Select
            aria-label={t('data.importFlow.instrument')}
            value={instrumentId}
            onChange={(event) => setInstrumentId(event.target.value)}
          >
            <option value="">{t('data.importFlow.noInstrument')}</option>
            {(instruments.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayId ?? item.name} · {item.name}
              </option>
            ))}
          </Select>
          {instrumentId ? (
            <Status tone={calibration.tone}>{calibration.label}</Status>
          ) : null}
        </label>
      </div>

      {onUploaded ? (
        <p className="m-0 max-w-[640px] text-label text-fg-muted">
          {effectiveMode === 'new'
            ? t('data.importFlow.fileKeptNewDataset')
            : t('data.importFlow.fileKept')}
        </p>
      ) : (
        <Section title={t('data.importFlow.whatHappensNext')}>
          <ol className="m-0 grid list-decimal gap-1 pl-5 text-body text-fg-muted">
            <li>{t('data.importFlow.fileKeptExactlyUploaded')}</li>
            <li>{t('data.importFlow.checkHowFileColumns')}</li>
            <li>{t('data.importFlow.seeEveryRowAdded')}</li>
          </ol>
          <p className="m-0 mt-2 max-w-[640px] text-body text-fg-muted">
            {t('data.importFlow.eachStoredFileGets')}
          </p>
        </Section>
      )}
    </>
  )
}

/**
 * R5-SURF-04 — steps 2 and 3 for one stored import. The file is re-derived
 * from the server by its id, the target and mapping come from the search pins,
 * and the review is recomputed on the server for the check step, so a reload
 * never trusts browser state for validity.
 */
export function ImportMapCheckFlow({
  importId,
  search,
  onSearch,
  renderReceipt,
}: {
  importId: string
  search: ImportSearch
  onSearch: (next: ImportSearch) => void
  renderReceipt?: (receipt: DatasetImportRecord) => ReactNode
}) {
  return (
    <ImportMapCheckContent
      key={`${importId}:${search.sheet ?? ''}:${search.dataset ?? ''}`}
      importId={importId}
      search={search}
      onSearch={onSearch}
      renderReceipt={renderReceipt}
    />
  )
}

function useImportSource(importId: string, search: ImportSearch) {
  const file = useQuery({
    queryKey: [
      ...importQueryKeys.file(importId),
      search.sheet ?? '',
      search.dataset ?? '',
    ],
    queryFn: () =>
      fetchImportFile({
        fileId: importId,
        datasetId: search.dataset,
        sheetName: search.sheet,
      }),
    staleTime: Infinity,
  })

  const datasets = useQuery({
    queryKey: DATASETS_QUERY_KEY,
    queryFn: () => fetchDatasetSummaries(client),
    staleTime: 15_000,
  })

  const datasetId = search.dataset ?? file.data?.datasetId ?? ''

  // A committed import is a receipt: read-only, with a way to upload a
  // corrected file. It is found among the Dataset's receipts by this file.
  const receipts = useQuery({
    queryKey: importQueryKeys.imports(datasetId),
    queryFn: () => fetchDatasetImports(client, datasetId),
    enabled: Boolean(datasetId),
    staleTime: 15_000,
  })

  const receipt = findCommittedReceipt(receipts.data, importId, search.sheet)

  const dataset =
    (datasets.data ?? []).find((item) => item.id === datasetId) ?? null

  const fields = useMemo(
    () => (dataset ? datasetFieldsFromColumns(dataset.columns) : []),
    [dataset],
  )

  const headers = useMemo(() => file.data?.sheet?.headers ?? [], [file.data])

  const parserOptions = useMemo(() => {
    const options = [
      file.data?.parser,
      ...(file.data?.approvedParsers ?? []),
      ...(file.data?.draftParsers ?? []),
    ].filter((option): option is ImportParserSummary => Boolean(option))

    const seen = new Set<string>()

    return options.filter((option) =>
      seen.has(option.key) ? false : (seen.add(option.key), true),
    )
  }, [file.data])

  return {
    file,
    datasets,
    datasetId,
    receipt,
    dataset,
    fields,
    headers,
    parserOptions,
  }
}

function useImportMapping(
  context: ReturnType<typeof useImportSource>,
  search: ImportSearch,
) {
  const { file, dataset, fields, headers, parserOptions } = context
  const [manual, setManual] = useState(search.parser === 'manual')
  const [mappingValues, setMappingValues] = useState<Record<string, string>>({})
  const [sourceUnits, setSourceUnits] = useState<Record<string, string>>({})
  const [mappingReady, setMappingReady] = useState(false)

  const urlMapping = useMemo(() => parseImportMapping(search.map), [search.map])

  const suggestedParser = useMemo(
    () =>
      file.data
        ? suggestParserFromFilename(file.data.filename, parserOptions)
        : null,
    [file.data, parserOptions],
  )

  const parserKey =
    search.parser ?? file.data?.parser?.key ?? suggestedParser?.key ?? ''

  const activeParser = manual
    ? null
    : (parserOptions.find((option) => option.key === parserKey) ??
      file.data?.parser ??
      null)

  // Initialise once when both reads arrive. Later search writes must not reset
  // the person's edits; the outer file/worksheet/target key owns their lifetime.
  if (!mappingReady && file.data && dataset) {
    setMappingValues(
      initialMappingValues(headers, fields, file.data.savedMapping, urlMapping),
    )
    const pinned = parseImportMapping(search.units)
    setSourceUnits(
      Object.fromEntries(
        headers.map((source) => [
          source,
          Object.hasOwn(pinned, source)
            ? pinned[source]
            : (file.data.savedMapping?.sources.find(
                (entry) => entry.source === source,
              )?.sourceUnit ??
              importHeaderUnit(source) ??
              ''),
        ]),
      ),
    )
    setMappingReady(true)
  }

  const mappingDocument = useMemo<ImportMappingDocument>(
    () => ({
      sheetName: file.data?.sheet?.name,
      sources: headers.map((source) => {
        const fieldId = mappingValues[source] ?? ''

        return {
          source,
          fieldId: fieldId || null,
          unit: fields.find((field) => field.id === fieldId)?.unit ?? null,
          sourceUnit: sourceUnits[source] || null,
        }
      }),
    }),
    [file.data, fields, headers, mappingValues, sourceUnits],
  )

  const unitErrors = mappingDocument.sources.flatMap((entry) => {
    const field = fields.find((item) => item.id === entry.fieldId)
    const message = field ? importUnitError(field, entry.sourceUnit) : null

    return message ? [message] : []
  })

  // A required Schema field no column feeds: the database refuses every row, so
  // say so on the mapping instead of after Import.
  const mappedFieldIds = new Set(
    mappingDocument.sources.flatMap((entry) =>
      entry.fieldId ? [entry.fieldId] : [],
    ),
  )

  const requiredUnmapped =
    mappedFieldIds.size > 0
      ? fields.filter(
          (field) =>
            field.kind === 'dataset-field' &&
            !field.nullable &&
            !mappedFieldIds.has(field.id),
        )
      : []

  return {
    manual,
    setManual,
    mappingValues,
    setMappingValues,
    sourceUnits,
    setSourceUnits,
    mappingReady,
    suggestedParser,
    activeParser,
    mappingDocument,
    unitErrors,
    requiredUnmapped,
  }
}

function useImportReview(importId: string, search: ImportSearch) {
  const source = useImportSource(importId, search)
  const mapping = useImportMapping(source, search)
  const { file, datasets, datasetId, dataset } = source

  const {
    mappingValues,
    activeParser,
    manual,
    mappingReady,
    unitErrors,
    mappingDocument,
  } = mapping

  const step: 'map' | 'check' = search.step === 'check' ? 'check' : 'map'

  const worksheetReady = Boolean(
    search.sheet || file.data?.sheet?.sheetNames.length === 1,
  )

  const mappedCount = Object.values(mappingValues).filter(Boolean).length
  const parsed = Boolean(file.data?.parsed)

  const visibility = importViewState({
    step,
    parsed,
    worksheetReady,
    datasetId,
    datasetAvailable: Boolean(dataset),
    datasetsLoading: datasets.isLoading,
    hasParser: Boolean(activeParser),
    manual,
    mappedCount,
  })

  const { showMapping } = visibility

  const review = useQuery({
    queryKey: [
      'ui-port',
      'import',
      'review',
      importId,
      datasetId,
      search.map ?? '',
      search.units ?? '',
      search.sheet ?? '',
      activeParser?.key ?? '',
      activeParser?.parserVersionId ?? '',
    ],
    queryFn: () =>
      reviewImport({
        fileId: importId,
        datasetId,
        mapping: mappingDocument,
        parserKey: activeParser?.key ?? null,
        parserVersionId: activeParser?.parserVersionId ?? null,
        sheetName: file.data?.sheet?.name ?? null,
      }),
    enabled:
      (step === 'check' || showMapping) &&
      parsed &&
      worksheetReady &&
      mappingReady &&
      Boolean(datasetId) &&
      mappedCount > 0 &&
      unitErrors.length === 0,
  })

  return {
    ...source,
    ...mapping,
    step,
    worksheetReady,
    mappedCount,
    parsed,
    ...visibility,
    review,
  }
}

function useImportActions(
  importId: string,
  search: ImportSearch,
  onSearch: (next: ImportSearch) => void,
  model: ReturnType<typeof useImportReview>,
) {
  const {
    file,
    datasetId,
    mappedCount,
    activeParser,
    mappingDocument,
    mappingValues,
    sourceUnits,
    manual,
    review,
    fields,
  } = model

  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [blockedByContract, setBlockedByContract] =
    useState<ContractGateReport | null>(null)

  const [saveWarning, setSaveWarning] = useState('')

  const [outcome, setOutcome] = useState<ImportCommitResponseSummary | null>(
    null,
  )

  function writeSearch(next: ImportSearch) {
    setError('')
    onSearch(next)
  }

  async function continueToReview() {
    if (!file.data || !datasetId || mappedCount === 0) return
    setBusy(true)
    setError('')
    setSaveWarning('')

    try {
      // Saving the mapping as the parser's default is a convenience: a refused save
      // (permission, parser rules) leaves the review, which writes nothing, available.
      if (activeParser?.parserId) {
        try {
          await saveParserMapping(client, {
            parserId: activeParser.parserId,
            targetKey: `dataset:${datasetId}`,
            mapping: mappingDocument,
          })
        } catch (saveError) {
          setSaveWarning(
            saveError instanceof Error
              ? saveError.message
              : t('data.importFlow.mappingCouldSavedParser'),
          )
        }
      }

      writeSearch({
        ...search,
        step: 'check',
        sheet: file.data.sheet?.name,
        map: serializeImportMapping(mappingValues, true),
        units: serializeImportMapping(sourceUnits, true),
        parser: manual ? 'manual' : activeParser?.key,
      })
    } finally {
      setBusy(false)
    }
  }

  /** The map screen's own Import: keep the mapping as the parser's default,
   * then write the rows the review above already shows. */
  async function importNow() {
    if (!file.data || !datasetId || !review.data) return

    if (activeParser?.parserId) {
      try {
        await saveParserMapping(client, {
          parserId: activeParser.parserId,
          targetKey: `dataset:${datasetId}`,
          mapping: mappingDocument,
        })
      } catch (saveError) {
        setSaveWarning(
          saveError instanceof Error
            ? saveError.message
            : t('data.importFlow.mappingCouldSavedParser'),
        )
      }
    }

    await runCommit()
  }

  /**
   * A refused row is fixed in the source file. The corrected file starts a new
   * import with the target, experiment, instrument, parser and mapping this one
   * used, so the person is not asked to choose them again.
   */
  async function uploadCorrected(corrected: File) {
    const upload = await uploadImportFile({ file: corrected, datasetId })
    await navigate({
      to: '/import/$importId',
      params: { importId: upload.fileId },
      search: {
        ...search,
        dataset: datasetId,
        step: 'map',
        map: serializeImportMapping(mappingValues) || undefined,
      },
    })
  }

  async function runCommit() {
    if (!file.data || !datasetId || !review.data) return
    setBusy(true)
    setError('')

    try {
      const result = await commitImport({
        fileId: importId,
        datasetId,
        mapping: mappingDocument,
        parserKey: activeParser?.key ?? null,
        parserId: activeParser?.parserId ?? null,
        parserVersionId: activeParser?.parserVersionId ?? null,
        experimentRecordId: search.experiment ?? null,
        instrumentId: search.instrument ?? null,
        sheetName: file.data.sheet?.name ?? null,
        idempotencyKey: commitIdempotencyKey(
          importId,
          datasetId,
          mappingDocument,
        ),
      })

      if (!result.ok && result.contract?.blocked) {
        setBlockedByContract(result.contract)

        return
      }

      if (!result.ok) {
        setError(
          describeRejectedImport(
            result.errors.at(0)?.message ?? t('data.importFlow.importRejected'),
            fields,
          ),
        )

        return
      }

      setOutcome({
        committed: result.committed,
        importId: result.importId ?? null,
        snapshotVersionId: result.snapshotVersionId ?? null,
        outcome: result.outcome ?? {},
      })
      void queryClient.invalidateQueries({ queryKey: DATASETS_QUERY_KEY })
      void queryClient.invalidateQueries({
        queryKey: importQueryKeys.imports(datasetId),
      })
    } catch (commitError) {
      setError(
        commitError instanceof Error
          ? describeRejectedImport(commitError.message, fields)
          : t('data.importFlow.importFailed'),
      )
    } finally {
      setBusy(false)
    }
  }

  async function askAdmin() {
    try {
      await requestParserUpdate(importId)
      await navigate({
        to: '/settings/lab/instruments',
        search: {
          fileId: importId,
          versionId: activeParser?.parserVersionId,
        },
      })
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t('data.importFlow.parserUpdateRequestFailed'),
      )
    }
  }

  return {
    busy,
    error,
    blockedByContract,
    setBlockedByContract,
    saveWarning,
    outcome,
    writeSearch,
    continueToReview,
    importNow,
    uploadCorrected,
    runCommit,
    askAdmin,
  }
}

function ImportMapCheckContent({
  importId,
  search,
  onSearch,
  renderReceipt,
}: {
  importId: string
  search: ImportSearch
  onSearch: (next: ImportSearch) => void
  renderReceipt?: (receipt: DatasetImportRecord) => ReactNode
}) {
  const model = useImportReview(importId, search)
  const actions = useImportActions(importId, search, onSearch, model)
  const { receipt, file, step, parsed } = model

  if (receipt && renderReceipt) return renderReceipt(receipt)

  if (receipt)
    return (
      <ImportReceipt
        importId={importId}
        receipt={receipt}
        returnTo={search.returnTo}
      />
    )

  const notFound =
    file.error instanceof ImportRequestError &&
    (file.error.status === 404 || file.error.code === 'not_found')

  if (notFound) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          trail={[
            { label: t('data.importFlow.datasets'), link: { to: '/datasets' } },
            { label: t('data.importFlow.importData') },
          ]}
          title={t('data.importFlow.importFound')}
        />
        <div className="px-4 py-4 md:px-6">
          <EmptyState
            icon="upload"
            title={t('data.importFlow.importDoesnTExist')}
            description={t('data.importFlow.mayHaveBeenCancelled')}
            action={
              <Button
                variant="primary"
                nativeButton={false}
                render={<Link to="/import" />}
              >
                {t('data.importFlow.importData')}
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <ImportMappingHeader
        model={model}
        actions={actions}
        search={search}
        embedded={Boolean(renderReceipt)}
      />
      <div className="px-4 py-4 md:px-6">
        <Stepper
          steps={STEPS}
          current={step === 'check' ? 3 : 2}
          failed={parsed === false && file.data !== undefined}
          className="mb-4"
        />
        <ImportCommitStatus model={model} actions={actions} search={search} />
        <ImportSourceStatus model={model} actions={actions} search={search} />
        <ImportWorksheetControls
          model={model}
          actions={actions}
          search={search}
        />
        <ImportMappingReview model={model} actions={actions} search={search} />
      </div>
    </div>
  )
}

interface ImportStepProps {
  model: ReturnType<typeof useImportReview>
  actions: ReturnType<typeof useImportActions>
  search: ImportSearch
}

function ImportMappingHeader({
  model,
  actions,
  search,
  embedded,
}: ImportStepProps & { embedded: boolean }) {
  const { file, dataset } = model

  return (
    <PageHeader
      trail={
        embedded
          ? undefined
          : [
              {
                label: t('data.importFlow.datasets'),
                link: { to: '/datasets' },
              },
              { label: t('data.importFlow.importData') },
            ]
      }
      title={t('data.importFlow.importData')}
      titleLevel={embedded ? 2 : 1}
      meta={
        <>
          <span>
            {file.data
              ? t('data.importFlow.sha256', {
                  filename: file.data.filename,
                  value: formatFileSize(file.data.byteSize),
                  slice: file.data.checksum.slice(0, 4),
                  slice2: file.data.checksum.slice(-4),
                })
              : t('data.importFlow.readingStoredFile')}
          </span>
          {dataset ? (
            <span className="max-lg:hidden">
              {t('data.importFlow.target')} {dataset.display_id ?? ''} ·{' '}
              {dataset.name}
            </span>
          ) : null}
        </>
      }
      actions={
        <ImportMappingActions
          model={model}
          actions={actions}
          search={search}
          embedded={embedded}
        />
      }
    />
  )
}

function ImportMappingActions({
  model,
  actions,
  search,
  embedded,
}: ImportStepProps & { embedded: boolean }) {
  const { step } = model
  const { outcome } = actions

  return (
    <>
      {!outcome && !embedded ? (
        <Button
          nativeButton={false}
          render={<Link to={cancelTarget(search, '/import')} />}
        >
          {t('common.actions.cancel')}
        </Button>
      ) : null}
      {step === 'map' ? (
        <ImportMapActions model={model} actions={actions} search={search} />
      ) : null}
      {step === 'check' ? (
        <ImportCheckActions model={model} actions={actions} search={search} />
      ) : null}
    </>
  )
}

function ImportMapActions({ model, actions }: ImportStepProps) {
  const {
    showMapping,
    showParserChoice,
    mappedCount,
    mappingReady,
    worksheetReady,
    unitErrors,
    review,
  } = model

  const { busy, importNow, continueToReview } = actions

  return (
    <>
      {showMapping ? (
        <Button
          variant="primary"
          disabled={
            busy ||
            !review.data ||
            review.isFetching ||
            unitErrors.length > 0 ||
            review.data.errors.length > 0
          }
          onClick={() => void importNow()}
        >
          {busy
            ? t('data.importFlow.importing')
            : t('data.importFlow.importRows', {
                value: review.data?.summary.added ?? 0,
              })}
        </Button>
      ) : null}
      {!showMapping && !showParserChoice ? (
        <Button
          variant="primary"
          disabled={
            busy ||
            mappedCount === 0 ||
            !mappingReady ||
            !worksheetReady ||
            unitErrors.length > 0
          }
          onClick={() => void continueToReview()}
        >
          {busy ? t('data.importFlow.checking') : t('common.actions.continue')}
        </Button>
      ) : null}
    </>
  )
}

function ImportCheckActions({ model, actions, search }: ImportStepProps) {
  const { worksheetReady, unitErrors, review } = model
  const { busy, writeSearch, runCommit } = actions

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => writeSearch({ ...search, step: 'map' })}
      >
        {t('data.importFlow.backMapping')}
      </Button>
      <Button
        variant="primary"
        disabled={
          busy ||
          !review.data ||
          review.isFetching ||
          !worksheetReady ||
          unitErrors.length > 0 ||
          review.data.errors.length > 0
        }
        onClick={() => void runCommit()}
      >
        {busy
          ? t('data.importFlow.importing')
          : t('data.importFlow.importRows', {
              value: review.data?.summary.added ?? 0,
            })}
      </Button>
    </>
  )
}

function ImportCommitStatus({ model, actions, search }: ImportStepProps) {
  const { file, datasetId } = model

  const {
    blockedByContract,
    setBlockedByContract,
    error,
    saveWarning,
    outcome,
    askAdmin,
  } = actions

  return (
    <>
      <BlockedImportDialog
        report={blockedByContract}
        open={blockedByContract !== null}
        onOpenChange={(open) => {
          if (!open) setBlockedByContract(null)
        }}
      />

      {error ? (
        <Banner
          tone="bad"
          title={t('data.importFlow.importError')}
          className="mb-4"
        >
          {error}
          {file.data && !error.startsWith(REJECTED_ROWS_PREFIX) ? (
            <Button variant="quiet" onClick={() => void askAdmin()}>
              {t('data.importFlow.askAdminUpdateParser')}
            </Button>
          ) : null}
        </Banner>
      ) : null}

      {saveWarning ? (
        <Banner
          tone="warn"
          title={t('data.importFlow.mappingSavedParserS')}
          className="mb-4"
        >
          {t('data.importFlow.fileStillImportsMapping', { saveWarning })}
        </Banner>
      ) : null}

      {outcome ? (
        <Banner
          tone="info"
          title={t('data.importFlow.importedRows', {
            committed: outcome.committed,
          })}
        >
          {t('data.importFlow.importedDetail', {
            snapshot: outcome.snapshotVersionId?.slice(0, 8) ?? '—',
            importId: outcome.importId?.slice(0, 8) ?? '—',
          })}{' '}
          {datasetId ? (
            <Link
              to="/datasets/$datasetId/snapshots"
              params={{ datasetId }}
              className="underline"
            >
              {t('data.importFlow.openDatasetSnapshots')}
            </Link>
          ) : null}
          {search.experiment ? (
            <>
              {' · '}
              <Link
                to="/experiments/$expId/data/datasets"
                params={{ expId: search.experiment }}
                className="underline"
              >
                {t('data.importFlow.backExperiment')}
              </Link>
            </>
          ) : null}
          {search.returnTo ? (
            <>
              {' · '}
              <Link to={search.returnTo} className="underline">
                {t('data.importFlow.backWhereWere')}
              </Link>
            </>
          ) : null}
        </Banner>
      ) : null}
    </>
  )
}

function ImportSourceStatus({ model, actions, search }: ImportStepProps) {
  const { file, datasetId, datasetUnavailable } = model

  return (
    <>
      {file.isLoading ? (
        <p role="status" className="m-0 text-body text-fg-muted">
          {t('data.importFlow.readingStoredFile')}
        </p>
      ) : null}

      {file.error ? (
        <Banner
          tone="bad"
          title={t('data.importFlow.couldOpenImport')}
          className="mb-4"
        >
          {file.error.message}
          <Button variant="quiet" onClick={() => void file.refetch()}>
            {t('common.actions.tryAgain')}
          </Button>
        </Banner>
      ) : null}

      {datasetUnavailable ? (
        <Banner
          tone="bad"
          title={t('data.importFlow.datasetAvailable')}
          className="mb-4"
        >
          {t('data.importFlow.datasetChosenImportActive')}
        </Banner>
      ) : null}

      {file.data && !datasetId ? (
        <EmptyState
          icon="table"
          title={t('data.importFlow.importHasTarget')}
          description={t('data.importFlow.fileSavedButDataset')}
          action={
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/import" />}
            >
              {t('data.importFlow.importData')}
            </Button>
          }
        />
      ) : null}

      <ImportParserRecovery model={model} actions={actions} search={search} />
    </>
  )
}

function ImportParserRecovery({ model, actions, search }: ImportStepProps) {
  const {
    file,
    datasetId,
    parsed,
    datasetPending,
    showMapping,
    showParserChoice,
    setManual,
  } = model

  const { writeSearch, askAdmin } = actions

  return (
    <>
      {file.data && datasetId && !parsed ? (
        <div className="grid gap-3">
          <Banner tone="warn" title={t('data.importFlow.nothingImported')}>
            {file.data.parseError ??
              t('data.importFlow.fileCouldReadRegistered')}{' '}
            {t('data.importFlow.fileKeptSoRetry')}
          </Banner>
          <div className="flex flex-wrap gap-2">
            {(file.data.draftParsers ?? []).map((draft) => (
              <Button
                key={draft.key}
                size="sm"
                variant="secondary"
                onClick={() => writeSearch({ ...search, parser: draft.key })}
              >
                {t('data.importFlow.tryParserDraft', { label: draft.label })}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void askAdmin()}
            >
              {t('data.importFlow.askAdminUpdateParser2')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              nativeButton={false}
              render={<Link to="/import" />}
            >
              {t('data.importFlow.startDifferentImport')}
            </Button>
          </div>
        </div>
      ) : null}

      {file.data && parsed && datasetPending && !showMapping ? (
        <p role="status" className="m-0 text-body text-fg-muted">
          {t('data.importFlow.readingTargetDataset')}
        </p>
      ) : null}

      {file.data && showParserChoice ? (
        <ParserChoice
          file={{
            name: file.data.filename,
            size: formatFileSize(file.data.byteSize),
          }}
          message={
            file.data.recognitionMessage ??
            t('data.importFlow.fileDoesMatchRegistered')
          }
          drafts={file.data.draftParsers ?? []}
          onManual={() => {
            setManual(true)
            writeSearch({ ...search, parser: 'manual' })
          }}
          onDraft={(key) => writeSearch({ ...search, parser: key })}
          onAskAdmin={() => void askAdmin()}
        />
      ) : null}
    </>
  )
}

function ImportWorksheetControls({ model, actions, search }: ImportStepProps) {
  const {
    file,
    showParserChoice,
    worksheetReady,
    requiredUnmapped,
    unitErrors,
  } = model

  const { writeSearch, error } = actions

  return (
    <>
      {file.data?.sheet && !showParserChoice ? (
        <div className="mb-4 grid max-w-[420px] gap-1 text-label text-fg-muted">
          <label htmlFor="import-worksheet">
            {t('data.importFlow.worksheet')}
          </label>
          <Select
            id="import-worksheet"
            value={
              search.sheet ??
              (file.data.sheet.sheetNames.length === 1
                ? file.data.sheet.name
                : '')
            }
            onChange={(event) =>
              writeSearch({
                ...search,
                step: 'map',
                sheet: event.target.value || undefined,
                map: undefined,
                units: undefined,
                parser: undefined,
              })
            }
          >
            <option value="">{t('data.importFlow.chooseWorksheet')}</option>
            {file.data.sheet.sheetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <span>
            {worksheetReady
              ? t('data.importFlow.dataRows', {
                  toLocaleString: file.data.sheet.rowCount.toLocaleString(),
                  name: file.data.sheet.name,
                })
              : t('data.importFlow.chooseMeasurementsSheetCover')}
          </span>
        </div>
      ) : null}
      {requiredUnmapped.length > 0 && worksheetReady && !error ? (
        <Banner
          tone="warn"
          title={t('data.importFlow.requiredFieldHasColumn')}
          className="mb-4"
        >
          {t('data.importFlow.requiredUnmapped', {
            count: requiredUnmapped.length,
            fields: requiredUnmapped.map((field) => field.label).join(', '),
          })}
        </Banner>
      ) : null}
      {unitErrors.length > 0 && worksheetReady ? (
        <Banner
          tone="warn"
          title={t('data.importFlow.checkSourceUnits')}
          className="mb-4"
        >
          {unitErrors.map((message) => (
            <p key={message} className="m-0">
              {message}
            </p>
          ))}
        </Banner>
      ) : null}
    </>
  )
}

function ImportMappingReview({ model, actions, search }: ImportStepProps) {
  const {
    showMapping,
    showReview,
    activeParser,
    setManual,
    parserOptions,
    suggestedParser,
    headers,
    fields,
    mappingValues,
    sourceUnits,
    setSourceUnits,
    setMappingValues,
    file,
    review,
    dataset,
  } = model

  const { writeSearch, uploadCorrected } = actions

  return (
    <>
      {showMapping ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="grid gap-4">
            <div className="grid max-w-[420px] gap-1 text-label text-fg-muted">
              {t('data.importFlow.parser')}
              <Select
                aria-label={t('data.importFlow.ariaParserFile')}
                value={activeParser?.key ?? ''}
                onChange={(event) => {
                  const next = event.target.value
                  setManual(next === '')
                  writeSearch({ ...search, parser: next || 'manual' })
                }}
              >
                <option value="">{t('data.importFlow.parserMapHand')}</option>
                {parserOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label} v{option.version}
                  </option>
                ))}
              </Select>
              {suggestedParser ? (
                <span className="text-label">
                  {t('data.importFlow.suggestedFromFileName2', {
                    label: suggestedParser.label,
                  })}
                </span>
              ) : null}
            </div>
            <MapTable
              headers={headers}
              fields={fields}
              mappingValues={mappingValues}
              sourceUnits={sourceUnits}
              onUnit={(source, unit) => {
                const next = { ...sourceUnits, [source]: unit }
                setSourceUnits(next)
                writeSearch({
                  ...search,
                  units: serializeImportMapping(next, true),
                })
              }}
              parser={activeParser}
              sheet={file.data?.sheet ?? null}
              onApplyAi={(suggestions) => {
                const nextMap = { ...mappingValues }
                const nextUnits = { ...sourceUnits }

                for (const suggestion of suggestions) {
                  nextMap[suggestion.header] = suggestion.fieldId

                  if (suggestion.sourceUnit)
                    nextUnits[suggestion.header] = suggestion.sourceUnit
                }

                setMappingValues(nextMap)
                setSourceUnits(nextUnits)
                writeSearch({
                  ...search,
                  map: serializeImportMapping(nextMap, true),
                  units: serializeImportMapping(nextUnits, true),
                })
              }}
              onMap={(source, fieldId) => {
                const next = { ...mappingValues, [source]: fieldId }
                setMappingValues(next)
                writeSearch({
                  ...search,
                  map: serializeImportMapping(next, true),
                })
              }}
            />
            <ReviewTable
              review={review.data ?? null}
              loading={review.isFetching}
              onCorrectedFile={uploadCorrected}
              part="rows"
            />
          </div>
          <ReviewTable
            review={review.data ?? null}
            loading={false}
            part="aside"
            target={dataset?.display_id ?? null}
          />
        </div>
      ) : null}

      {showReview ? (
        <ReviewTable
          review={review.data ?? null}
          loading={review.isFetching}
          onCorrectedFile={uploadCorrected}
        />
      ) : null}
    </>
  )
}

/**
 * A file no approved parser recognises (the Import failed board): what was
 * stored, why it was not read, and the ways forward. Nothing is imported and
 * the file is kept.
 */
function ParserChoice({
  file,
  message,
  drafts,
  onManual,
  onDraft,
  onAskAdmin,
}: {
  file: { name: string; size: string }
  message: string
  drafts: ImportParserSummary[]
  onManual: () => void
  onDraft: (key: string) => void
  onAskAdmin: () => void
}) {
  const [choice, setChoice] = useState('manual')

  const extension = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.') + 1).toUpperCase()
    : 'FILE'

  const options = [
    { value: 'manual', label: t('data.importFlow.mapColumnsHandFile') },
    ...drafts.map((draft) => ({
      value: `draft:${draft.key}`,
      label: t('data.importFlow.tryParserDraft', { label: draft.label }),
    })),
    { value: 'admin', label: t('data.importFlow.askAdminUpdateParser2') },
  ]

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3 rounded-md border px-3 py-2.5">
        <span className="rounded-sm bg-surface-muted px-1.5 py-0.5 font-mono text-label text-fg-muted">
          {extension}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium">{file.name}</div>
          <div className="text-label text-fg-muted">
            {t('data.importFlow.storedSize', { size: file.size })}
          </div>
        </div>
        <Button size="sm" nativeButton={false} render={<Link to="/import" />}>
          {t('data.importFlow.replaceFile')}
        </Button>
      </div>
      <Banner tone="bad" title={t('data.importFlow.fileDoesnTMatch')}>
        {message}
        <p className="m-0 mt-1 text-label text-fg-muted">
          {t('data.importFlow.nothingImportedFileKept')}
        </p>
      </Banner>
      <fieldset className="m-0 grid gap-1.5 border-0 p-0">
        <legend className="mb-1 p-0 text-body">
          {t('data.importFlow.howDoWantContinue')}
        </legend>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 text-body"
          >
            <input
              type="radio"
              name="parser-choice"
              value={option.value}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <div>
        <Button
          variant="primary"
          onClick={() => {
            if (choice === 'manual') onManual()
            else if (choice === 'admin') onAskAdmin()
            else onDraft(choice.replace(/^draft:/, ''))
          }}
        >
          {choice === 'admin'
            ? t('data.importFlow.askAdmin')
            : choice === 'manual'
              ? t('data.importFlow.mapColumns')
              : t('data.importFlow.tryParser')}
        </Button>
      </div>
    </div>
  )
}

function MapTable({
  headers,
  fields,
  mappingValues,
  sourceUnits,
  onUnit,
  parser,
  sheet,
  onMap,
  onApplyAi,
}: {
  headers: string[]
  fields: ImportTargetField[]
  mappingValues: Record<string, string>
  sourceUnits: Record<string, string>
  onUnit: (source: string, unit: string) => void
  parser: ImportParserSummary | null
  sheet: ImportSheetPreview | null
  onMap: (source: string, fieldId: string) => void
  onApplyAi: (suggestions: AiMappingSuggestion[]) => void
}) {
  const mappedCount = Object.values(mappingValues).filter(Boolean).length
  const sampleRows = sheet?.sampleRows ?? []
  const ai = usePageAi()

  const [aiState, setAiState] = useState<
    | { phase: 'idle' }
    | { phase: 'running' }
    | { phase: 'failed'; message: string }
    | { phase: 'ready'; suggestions: AiMappingSuggestion[] }
  >({ phase: 'idle' })

  const askAi = async () => {
    setAiState({ phase: 'running' })

    const result = await ai.run({
      task: 'map_columns',
      instruction: buildMappingInstruction(
        headers.map((header) => ({
          header,
          examples: columnExamples(header, sampleRows),
        })),
        fields,
      ),
    })

    if (result.status !== 'ok') {
      setAiState({ phase: 'failed', message: result.message })

      return
    }

    setAiState({
      phase: 'ready',
      suggestions: changesFromSuggestions(
        parseMappingAnswer(result.text, headers, fields),
        mappingValues,
        sourceUnits,
      ),
    })
  }

  const pending = aiState.phase === 'ready' ? aiState.suggestions : []
  const pendingByHeader = new Map(pending.map((item) => [item.header, item]))

  return (
    <div className="grid gap-4">
      <p className="m-0 text-body text-fg-muted">
        {parser
          ? t('data.importFlow.columnsMappedDefault', {
              mappedCount,
              length: headers.length,
              label: parser.label,
            })
          : t('data.importFlow.columnsMapped', {
              mappedCount,
              length: headers.length,
            })}
      </p>
      <p className="m-0 text-label text-fg-muted">
        {t('data.importFlow.declareUnitsAlreadyUsed')}
      </p>
      {ai.live ? (
        <div className="flex flex-wrap items-center gap-2">
          {pending.length === 0 ? (
            <Button
              variant="secondary"
              size="sm"
              icon="spark"
              disabled={aiState.phase === 'running'}
              data-testid="import-ai-suggest"
              onClick={() => void askAi()}
            >
              {aiState.phase === 'running'
                ? t('data.importFlow.aiSuggesting')
                : t('data.importFlow.aiSuggest')}
            </Button>
          ) : (
            <>
              <span className="text-body" role="status">
                {t('data.importFlow.aiSuggestionsTitle', {
                  count: pending.length,
                })}
              </span>
              <Button
                size="sm"
                icon="spark"
                data-testid="import-ai-apply"
                onClick={() => {
                  onApplyAi(pending)
                  setAiState({ phase: 'idle' })
                }}
              >
                {t('data.importFlow.aiApply', { count: pending.length })}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => setAiState({ phase: 'idle' })}
              >
                {t('data.importFlow.aiDismiss')}
              </Button>
            </>
          )}
          {aiState.phase === 'ready' && pending.length === 0 ? (
            <span className="text-label text-fg-muted" role="status">
              {t('data.importFlow.aiNothing')}
            </span>
          ) : null}
          {aiState.phase === 'failed' ? (
            <span className="text-label text-fg-muted" role="status">
              {t('data.importFlow.aiFailed', { message: aiState.message })}
            </span>
          ) : null}
        </div>
      ) : null}
      {pending.length > 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('data.importFlow.aiSuggestionsHint')}
        </p>
      ) : null}
      <div className="overflow-auto rounded-md border">
        <Table aria-label={t('data.importFlow.ariaColumnMapping')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('data.importFlow.fileColumn')}</TableHead>
              <TableHead>{t('data.importFlow.datasetField')}</TableHead>
              <TableHead>{t('data.importFlow.sourceUnit')}</TableHead>
              <TableHead>{t('data.importFlow.storageUnit')}</TableHead>
              <TableHead>{t('data.importFlow.exampleValues')}</TableHead>
              <TableHead>{t('data.importFlow.status')}</TableHead>
              <TableHead>{t('data.importFlow.note')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {headers.map((header) => {
              const fieldId = mappingValues[header] ?? ''
              const field = fields.find((item) => item.id === fieldId)

              const unitError = field
                ? importUnitError(field, sourceUnits[header])
                : null

              const examples = columnExamples(header, sampleRows)

              return (
                <TableRow key={header}>
                  <TableCell>{header}</TableCell>
                  <TableCell>
                    <Select
                      aria-label={t('data.importFlow.ariaMap', { header })}
                      value={fieldId}
                      onChange={(event) => onMap(header, event.target.value)}
                    >
                      <option value="">
                        {t('data.importFlow.notImported')}
                      </option>
                      {fields.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                    {pendingByHeader.has(header) ? (
                      <AiSuggestionHint
                        suggestion={pendingByHeader.get(header)!}
                        fields={fields}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {field &&
                    ['integer', 'decimal'].includes(field.logicalType) ? (
                      <Input
                        aria-label={t('data.importFlow.ariaSourceUnit', {
                          header,
                        })}
                        value={sourceUnits[header] ?? ''}
                        onChange={(event) => onUnit(header, event.target.value)}
                        placeholder={
                          field.unit
                            ? t('data.importFlow.placeholderDeclareUnit')
                            : t('data.importFlow.placeholderUnitless')
                        }
                      />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {field?.unit ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-fg-muted">
                    {examples.length > 0 ? examples.join(', ') : '—'}
                  </TableCell>
                  <TableCell>
                    <Status
                      tone={unitError ? 'warn' : fieldId ? 'ok' : 'stored'}
                    >
                      {unitError
                        ? t('data.importFlow.checkUnits')
                        : fieldId
                          ? t('data.importFlow.mapped')
                          : t('data.importFlow.skipped')}
                    </Status>
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {columnNote(
                      header,
                      sampleRows,
                      sheet?.rowCount ?? 0,
                      Boolean(fieldId),
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function AiSuggestionHint({
  suggestion,
  fields,
}: {
  suggestion: AiMappingSuggestion
  fields: ImportTargetField[]
}) {
  const field = fields.find((item) => item.id === suggestion.fieldId)

  const bits = [
    field?.label,
    suggestion.sourceUnit
      ? t('data.importFlow.aiUnitGuess', { unit: suggestion.sourceUnit })
      : null,
    suggestion.kind ? t(`data.importFlow.aiKind.${suggestion.kind}`) : null,
  ].filter(Boolean)

  return (
    <p className="m-0 mt-1 flex items-start gap-1 text-label text-fg">
      <Icon name="spark" size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        {bits.join(' · ')}
        {suggestion.reason ? ` — ${suggestion.reason}` : ''}
      </span>
    </p>
  )
}

type ReviewRow = ImportReviewResponse['rows'][number]

/** The rows an import would add, flagged ones first, on the app's own grid. */
function ReviewRowsGrid({ review }: { review: ImportReviewResponse }) {
  const columns = useMemo<RegistryColumn<ReviewRow>[]>(
    () => [
      {
        id: 'row',
        header: t('data.importFlow.row'),
        accessorFn: (row) => row.index,
        enableHiding: false,
        size: 72,
        cell: ({ row }) => (
          <span className="num text-fg-muted">{row.original.index}</span>
        ),
      },
      ...review.columns
        .filter((column) => column.fieldId)
        .map((column): RegistryColumn<ReviewRow> => ({
          id: `source:${column.source}`,
          header: column.source,
          accessorFn: (row) => row.values[column.source] ?? '',
          cell: ({ row }) => (
            <span className="mono">
              {row.original.values[column.source] ?? '—'}
            </span>
          ),
        })),
      {
        id: 'outcome',
        header: t('data.importFlow.outcome'),
        accessorFn: (row) => outcomeLabel(row),
        cell: ({ row }) => (
          <Status tone={outcomeTone(row.original.outcome)}>
            {outcomeLabel(row.original)}
          </Status>
        ),
      },
    ],
    [review.columns],
  )

  return (
    <TableBox>
      <RegistryGrid
        label={t('data.importFlow.rowsImport')}
        rows={review.rows}
        columns={columns}
        getRowId={(row) => String(row.index)}
        selectable={false}
      />
    </TableBox>
  )
}

function ReviewTable({
  review,
  loading,
  onCorrectedFile,
  part = 'all',
  target = null,
}: {
  review: ImportReviewResponse | null
  loading: boolean
  onCorrectedFile?: (file: File) => Promise<void> | void
  /** `rows` is the table with its refusals, `aside` the summary beside it,
   * `all` both stacked (the review step). */
  part?: 'all' | 'rows' | 'aside'
  target?: string | null
}) {
  if (loading && !review) {
    return (
      <p role="status" className="m-0 text-body text-fg-muted">
        {t('data.importFlow.checkingEveryRow')}
      </p>
    )
  }

  if (!review) return null

  const rows = (
    <>
      {review.errors.length > 0 ? (
        <Banner tone="bad" title={t('data.importFlow.theseRowsStopImport')}>
          <ul className="m-0 pl-4">
            {review.errors.slice(0, 8).map((item) => (
              <li key={`${item.row}-${item.code}`}>
                {t('data.importFlow.row')} {item.row ?? '?'}: {item.message}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-1">
            {t('data.importFlow.rowCannotReadImported')}
          </p>
          {onCorrectedFile ? (
            <FileDrop
              className="mt-2 max-w-[420px]"
              label={t('data.importFlow.uploadCorrectedFile')}
              inputLabel={t('data.importFlow.correctedFile')}
              accept=".csv,.tsv,.tab,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onFile={(corrected) =>
                corrected ? onCorrectedFile(corrected) : undefined
              }
            />
          ) : null}
        </Banner>
      ) : null}
      {part === 'rows' ? (
        <div className="flex items-baseline gap-2">
          <h2 className="m-0 text-section">
            {t('data.importFlow.rowsImport')}
          </h2>
          <span className="text-label text-fg-muted">
            {t('data.importFlow.rowsShowingFlagsFirst', {
              total: review.summary.total,
              length: review.rows.length,
            })}
          </span>
        </div>
      ) : null}
      <ReviewRowsGrid review={review} />
    </>
  )

  const aside = (
    <>
      <Section title={t('data.importFlow.summary')}>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
          <dt className="text-fg-muted">{t('data.importFlow.willAdd')}</dt>
          <dd className="m-0 font-medium">
            {t('common.counts.rows', { count: review.summary.added })}
          </dd>
          <dt className="text-fg-muted">{t('data.importFlow.fillsPlanned')}</dt>
          <dd className="m-0 font-medium">
            {t('common.counts.rows', { count: review.summary.planned })}
          </dd>
          <dt className="text-fg-muted">{t('data.importFlow.flagged')}</dt>
          <dd className="m-0 font-medium">
            {t('common.counts.rows', { count: review.summary.flagged })}
          </dd>
          <dt className="text-fg-muted">{t('data.importFlow.skipped')}</dt>
          <dd className="m-0 font-medium">
            {t('data.importFlow.controls', { count: review.summary.skipped })}
          </dd>
        </dl>
      </Section>
      <Section title={t('data.importFlow.flaggedRows')}>
        <p className="m-0 text-body text-fg-muted">
          {t('data.importFlow.flaggedRowsImportTheir')}
        </p>
      </Section>
      <Section title={t('data.importFlow.record')}>
        <p className="m-0 text-body text-fg-muted">
          {target
            ? t('data.importFlow.recordedIn', { target })
            : t('data.importFlow.recordedInDataset')}
        </p>
      </Section>
    </>
  )

  if (part === 'rows') return <>{rows}</>

  if (part === 'aside') return <div className="grid gap-4">{aside}</div>

  return (
    <div className="grid gap-4">
      {rows}
      {aside}
      <p className="m-0 text-label text-fg-muted">
        {t('data.importFlow.showingRowsFlagsFirst', {
          length: review.rows.length,
          total: review.summary.total,
          added: review.summary.added,
        })}
      </p>
    </div>
  )
}
