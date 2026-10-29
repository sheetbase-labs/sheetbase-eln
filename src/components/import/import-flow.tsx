import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { datasetOption } from '#/components/v3/record-picker/entity-options'
import { useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { FileDrop } from '#/components/v3/ui/file-drop'
import { Input } from '#/components/v3/ui/input'
import { PageHeader, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { Stepper } from '#/components/v3/ui/stepper'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Select } from '#/components/v3/ui/select'
import { useExperimentRecords } from '#/components/v3/experiments/experiments-data'
import {
  calibrationStatus,
  useInstruments,
  useLatestCalibrationsByInstrument,
} from '#/components/v3/instruments/instruments-data'
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
  suggestImportMappings,
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

import { ImportReceipt, findCommittedReceipt } from './import-receipt'
import type { ImportSearch } from './import-search'
import { parseImportMapping, serializeImportMapping } from './import-search'

const client = createDataClient()
const STEPS = [
  t('common.actions.upload'),
  t('data.importFlow.mapColumns'),
  t('data.importFlow.reviewImport'),
]
const DATASETS_QUERY_KEY = ['ui-port', 'import', 'datasets'] as const
const SCHEMAS_QUERY_KEY = ['ui-port', 'import', 'schemas'] as const

export {
  parseImportMapping,
  parseImportSearch,
  serializeImportMapping,
} from './import-search'
export type { ImportSearch } from './import-search'

/**
 * A suggestion from the file name only: the parser catalogue's leading label
 * token (for example `TB-02` in `TB-02_run12.csv`). It pre-selects an option
 * the user can always override; the server still decides what reads the file.
 */
export function suggestParserFromFilename(
  filename: string,
  options: ImportParserSummary[],
): ImportParserSummary | null {
  const name = filename.toLowerCase()
  return (
    options.find((option) => {
      const label = option.label
        .toLowerCase()
        .replace(/ v[\d.]+$/, '')
        .split(' ')[0]
      return label.length >= 3 && name.includes(label)
    }) ?? null
  )
}

/**
 * A Dataset to suggest for a file picked before any target was chosen: the one
 * whose display ID, or whose name's words, appear in the file name
 * (`ELISA-capsid-titre_run4.csv` for "ELISA capsid titre"). Nothing is
 * suggested when no Dataset stands out, and the person can always change it.
 */
export function suggestDatasetFromFilename<
  T extends { id: string; name: string; display_id?: string | null },
>(filename: string, datasets: readonly T[]): T | null {
  const stem = filename
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
  const scored = datasets
    .map((dataset) => {
      const id = (dataset.display_id ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
      if (id.trim() && stem.includes(id.trim())) return { dataset, score: 100 }
      const words = dataset.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3)
      const hits = words.filter((word) => stem.includes(word)).length
      return { dataset, score: words.length > 0 ? hits : 0 }
    })
    .filter((entry) => entry.score >= 2 || entry.score === 100)
    .sort((a, b) => b.score - a.score)
  const best = scored.at(0)
  const next = scored.at(1)
  if (!best || (next && next.score === best.score)) return null
  return best.dataset
}

/**
 * The mapping a step starts from. A link's `map` is authoritative for every
 * header it names (an absent header means "not imported", exactly like a saved
 * mapping's explicit null); otherwise the parser's saved default wins and the
 * header-name suggestion fills the rest.
 */
export function initialMappingValues(
  headers: string[],
  fields: ImportTargetField[],
  savedMapping: ImportMappingDocument | null,
  urlMapping: Record<string, string>,
): Record<string, string> {
  if (Object.keys(urlMapping).length > 0) {
    const values: Record<string, string> = {}
    for (const header of headers) values[header] = urlMapping[header] ?? ''
    return values
  }
  const saved = savedMapping?.sources ?? []
  const suggested = suggestImportMappings(headers, fields)
  const values: Record<string, string> = {}
  for (const source of headers) {
    const savedEntry = saved.find((entry) => entry.source === source)
    const suggestedEntry = suggested.find((entry) => entry.source === source)
    values[source] = savedEntry
      ? (savedEntry.fieldId ?? '')
      : suggestedEntry?.kind === 'field'
        ? suggestedEntry.field.id
        : ''
  }
  return values
}

/**
 * A stable commit key for this file, target and mapping, so a reloaded check
 * step re-submits the same import and the canonical RPC returns the existing
 * receipt instead of writing a second snapshot. A different mapping is a
 * genuinely different import and gets its own key.
 */
export function commitIdempotencyKey(
  fileId: string,
  datasetId: string,
  mapping: ImportMappingDocument,
): string {
  const canonical = JSON.stringify([
    mapping.sheetName,
    mapping.sources.map((source) => [
      source.source,
      source.fieldId,
      source.unit,
      source.sourceUnit,
    ]),
  ])
  let hash = 2166136261
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `import-${fileId}-${datasetId}-${(hash >>> 0).toString(16)}`
}

function outcomeTone(outcome: string): 'ok' | 'warn' | 'bad' | 'stored' {
  if (outcome === 'flagged') return 'warn'
  if (outcome === 'skipped') return 'stored'
  if (outcome === 'planned') return 'ok'
  return 'stored'
}

function outcomeLabel(row: {
  outcome: string
  plannedRowId: string | null
  flags: Array<{ reason: string }>
}): string {
  if (row.outcome === 'skipped') return t('data.importFlow.controlImported')
  if (row.outcome === 'flagged')
    return (
      row.flags.map((flag) => flag.reason).join('; ') ||
      t('data.importFlow.flagged')
    )
  if (row.outcome === 'planned') return t('data.importFlow.fillsPlannedRow')
  return t('data.importFlow.newRow')
}

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
export function ImportUploadFlow({
  workspaceId,
  createdByUserId,
  initialInstrumentId,
  initialExperimentId,
  initialDatasetId,
  initialProjectId,
  returnTo,
  onUploaded,
}: {
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
}) {
  const navigate = useNavigate()
  const targetGroup = useId()
  const queryClient = useQueryClient()
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

  const [mode, setMode] = useState<'append' | 'new'>('append')
  const [datasetId, setDatasetId] = useState(initialDatasetId ?? '')
  const [schemaVersionId, setSchemaVersionId] = useState('')
  const [newName, setNewName] = useState('')
  const [experimentId, setExperimentId] = useState(initialExperimentId ?? '')
  const [instrumentId, setInstrumentId] = useState(initialInstrumentId ?? '')
  // A file picked before the target is chosen is held here until it is.
  const [held, setHeld] = useState<File | null>(null)
  const [suggested, setSuggested] = useState<string | null>(null)
  const [holdError, setHoldError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const datasetRows = datasets.data ?? []
  // With nothing to append to, the new-Dataset branch is the only path — it is
  // offered rather than a dead end.
  const effectiveMode = datasetRows.length === 0 ? 'new' : mode
  const targetReady =
    effectiveMode === 'append'
      ? Boolean(datasetId)
      : Boolean(schemaVersionId) && newName.trim().length > 0

  const latestCalibration = instrumentId
    ? calibrations.data?.get(instrumentId)
    : undefined
  const calibration = calibrationStatus(latestCalibration?.dueAt ?? null)

  /**
   * Step 1 hands the picked file straight to the shared transport. The pick's
   * own progress and failure belong to the file field, which is why this
   * function no longer tracks them: it resolves when the file is stored and
   * parsed, and a rejection becomes the row's message with its retry.
   */
  async function start(file: File) {
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
              initialProjectId ??
              experiments.data?.find((item) => item.id === experimentId)
                ?.project_id ??
              null,
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
            accept=".csv,.tsv,.tab,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onFile={pick}
          />
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

          <div className="grid max-w-[520px] gap-1 text-label text-fg-muted">
            <span>{t('data.importFlow.importInto')}</span>
            {datasets.isLoading ? (
              <p role="status" className="m-0 text-body text-fg-muted">
                {t('data.importFlow.readingDatasets')}
              </p>
            ) : null}
            {datasets.isError ? (
              <Banner tone="bad" title={t('data.importFlow.datasetsCouldRead')}>
                {t('data.importFlow.listDidLoadSo')}
                <Button variant="quiet" onClick={() => void datasets.refetch()}>
                  {t('data.importFlow.retry')}
                </Button>
              </Banner>
            ) : null}
            {/* "No Dataset to append to" is a fact about the workspace, so it is
                only said once the read settled and came back empty — never while
                the list is still loading or after the read failed. */}
            {datasets.isSuccess && datasetRows.length === 0 ? (
              <p className="m-0 text-body text-fg-muted">
                {t('data.importFlow.thereDatasetAppendYet')}
              </p>
            ) : null}
            {datasetRows.length > 0 ? (
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={targetGroup}
                    checked={effectiveMode === 'append'}
                    onChange={() => setMode('append')}
                  />
                  {t('data.importFlow.appendDataset')}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={targetGroup}
                    checked={effectiveMode === 'new'}
                    onChange={() => setMode('new')}
                  />
                  {t('data.importFlow.newDataset')}
                </label>
              </div>
            ) : null}
          </div>

          {effectiveMode === 'append' ? (
            <label className="grid max-w-[420px] gap-1 text-label text-fg-muted">
              Dataset
              <PickerSelect
                noun="dataset"
                aria-label="Import into dataset"
                value={datasetId}
                onChange={(id) => {
                  setDatasetId(id)
                  setSuggested(null)
                }}
                placeholder="Choose a dataset…"
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
                Dataset schema
                <PickerSelect
                  noun="dataset schema"
                  aria-label="Dataset schema for the new dataset"
                  value={schemaVersionId}
                  onChange={(id) => setSchemaVersionId(id)}
                  placeholder="Choose a Dataset schema…"
                  options={(schemas.data ?? []).map((schema) => ({
                    id: schema.schemaVersionId,
                    label: schema.name,
                    detail: `Version ${schema.version}`,
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

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-label text-fg-muted">
              {t('data.importFlow.linkExperiment')}
              <Select
                aria-label={t('data.importFlow.linkExperiment')}
                value={experimentId}
                disabled={Boolean(onUploaded && initialExperimentId)}
                onChange={(event) => setExperimentId(event.target.value)}
              >
                <option value="">{t('data.importFlow.noExperiment')}</option>
                {(experiments.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.identifier || item.id.slice(0, 8)} · {item.title}
                  </option>
                ))}
              </Select>
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
              {t('data.importFlow.fileRetainedUnchangedRows')}
              {effectiveMode === 'new'
                ? t('data.importFlow.uploadingCreatesNewDataset')
                : null}
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
        </div>
      </div>
    </div>
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
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const step: 'map' | 'check' = search.step === 'check' ? 'check' : 'map'
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
  const headers = file.data?.sheet?.headers ?? []

  const parserOptions = useMemo(() => {
    const options = [
      file.data?.parser,
      ...(file.data?.draftParsers ?? []),
    ].filter((option): option is ImportParserSummary => Boolean(option))
    const seen = new Set<string>()
    return options.filter((option) =>
      seen.has(option.key) ? false : (seen.add(option.key), true),
    )
  }, [file.data])

  const [manual, setManual] = useState(search.parser === 'manual')
  const [mappingValues, setMappingValues] = useState<Record<string, string>>({})
  const [sourceUnits, setSourceUnits] = useState<Record<string, string>>({})
  const [mappingReady, setMappingReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saveWarning, setSaveWarning] = useState('')
  const [outcome, setOutcome] = useState<ImportCommitResponseSummary | null>(
    null,
  )

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

  useEffect(() => {
    if (mappingReady || !file.data || !dataset) return
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
  }, [
    mappingReady,
    file.data,
    dataset,
    headers,
    fields,
    urlMapping,
    search.units,
  ])
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
  const worksheetReady = Boolean(
    search.sheet || file.data?.sheet?.sheetNames.length === 1,
  )
  const mappedCount = Object.values(mappingValues).filter(Boolean).length
  const parsed = Boolean(file.data?.parsed)
  const datasetPending = Boolean(datasetId) && datasets.isLoading
  const datasetUnavailable =
    Boolean(datasetId) && !datasets.isLoading && !dataset
  // The map step needs a chosen parser or a hand mapping before its table can
  // say anything. The review step reads the rows the mapping produces, so it
  // needs only the mapping: a reload at step=check with the pins kept shows the
  // rows, rather than an empty step beside an enabled Import button.
  const showMapping =
    step === 'map' &&
    parsed &&
    worksheetReady &&
    Boolean(dataset) &&
    Boolean(activeParser || manual)
  const showReview =
    step === 'check' && parsed && Boolean(dataset) && mappedCount > 0
  // "Choose how to read this file" claims nothing matched the file, so it waits until
  // the target is settled: not while the Dataset list is still loading (a parser may
  // already have matched), and not when the Dataset itself is missing — that banner
  // says what is actually wrong. It belongs to the mapping step, where reading the
  // file is the question being asked: on the review step the rows its mapping produced
  // are already on screen, and offering to re-read the file there would say both
  // "these rows will be imported" and "we cannot read this file".
  const showParserChoice =
    step === 'map' &&
    parsed &&
    worksheetReady &&
    Boolean(datasetId) &&
    !datasetUnavailable &&
    !activeParser &&
    !manual

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
        to: '/settings/instruments',
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
      <PageHeader
        trail={
          renderReceipt
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
        titleLevel={renderReceipt ? 2 : 1}
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
          <>
            {!outcome && !renderReceipt ? (
              <Button
                nativeButton={false}
                render={<Link to={cancelTarget(search, '/import')} />}
              >
                {t('common.actions.cancel')}
              </Button>
            ) : null}
            {step === 'map' && showMapping ? (
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
            {step === 'map' && !showMapping && !showParserChoice ? (
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
                {busy
                  ? t('data.importFlow.checking')
                  : t('common.actions.continue')}
              </Button>
            ) : null}
            {step === 'check' ? (
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
            ) : null}
          </>
        }
      />

      <div className="px-4 py-4 md:px-6">
        <Stepper
          steps={STEPS}
          current={step === 'check' ? 3 : 2}
          failed={parsed === false && file.data !== undefined}
          className="mb-4"
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
            {t('data.importFlow.snapshot')}{' '}
            {outcome.snapshotVersionId?.slice(0, 8) ?? 'created'}{' '}
            {t('data.importFlow.import')}{' '}
            {outcome.importId?.slice(0, 8) ?? 'recorded'}
            {t('data.importFlow.originalFileKeptUnchanged')}{' '}
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
                  to="/experiments/$expId/datasets"
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
              {t('data.importFlow.retry')}
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
            {requiredUnmapped.map((field) => field.label).join(', ')}{' '}
            {requiredUnmapped.length === 1 ? 'is' : 'are'}{' '}
            {t('data.importFlow.requiredFileColumnMapped')}{' '}
            {requiredUnmapped.length === 1 ? 'it' : 'them'}
            {t('data.importFlow.rowsWithoutValueRefused')}
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
      </div>
    </div>
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
            {file.size} {t('data.importFlow.stored')}
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

/**
 * The values a column shows as its examples. It is the rule the server's own
 * `buildColumnViews` applies — the first three non-empty values of the first
 * six rows — so the map step and the review step describe a column the same
 * way. The sheet preview the file response carries holds eight rows, which is
 * everything the rule reads.
 */
export function columnExamples(
  source: string,
  sampleRows: Array<Record<string, string>>,
): string[] {
  return sampleRows
    .slice(0, 6)
    .map((row) => (row[source] ?? '').trim())
    .filter((value) => value.length > 0)
    .slice(0, 3)
}

/**
 * A column's note: how much of the file it reads, or why it is left out. It
 * mirrors the server's `buildColumnViews`, so the note beside a mapping is the
 * same statement the review makes about that column.
 */
export function columnNote(
  source: string,
  sampleRows: Array<Record<string, string>>,
  rowCount: number,
  mapped: boolean,
): string {
  if (!mapped) return t('data.importFlow.matchingField')
  const matched = sampleRows
    .slice(0, 6)
    .filter((row) => (row[source] ?? '').trim().length > 0).length
  return t('data.importFlow.matchedOf', { matched, min: Math.min(rowCount, 6) })
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
}: {
  headers: string[]
  fields: ImportTargetField[]
  mappingValues: Record<string, string>
  sourceUnits: Record<string, string>
  onUnit: (source: string, unit: string) => void
  parser: ImportParserSummary | null
  sheet: ImportSheetPreview | null
  onMap: (source: string, fieldId: string) => void
}) {
  const mappedCount = Object.values(mappingValues).filter(Boolean).length
  const sampleRows = sheet?.sampleRows ?? []
  return (
    <div className="grid gap-4">
      <p className="m-0 text-body text-fg-muted">
        {t('data.importFlow.columnsMapped', {
          mappedCount,
          length: headers.length,
        })}
        {parser
          ? t('data.importFlow.continueSaveSDefault', { label: parser.label })
          : ''}
      </p>
      <p className="m-0 text-label text-fg-muted">
        {t('data.importFlow.declareUnitsAlreadyUsed')}
      </p>
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
      <div className="overflow-auto rounded-md border">
        <Table aria-label={t('data.importFlow.rowsImport')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('data.importFlow.row')}</TableHead>
              {review.columns
                .filter((column) => column.fieldId)
                .map((column) => (
                  <TableHead key={column.source}>{column.source}</TableHead>
                ))}
              <TableHead>{t('data.importFlow.outcome')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {review.rows.map((row) => (
              <TableRow key={row.index}>
                <TableCell className="text-fg-muted">{row.index}</TableCell>
                {review.columns
                  .filter((column) => column.fieldId)
                  .map((column) => (
                    <TableCell
                      key={column.source}
                      className="font-mono text-xs"
                    >
                      {row.values[column.source] ?? '—'}
                    </TableCell>
                  ))}
                <TableCell>
                  <Status tone={outcomeTone(row.outcome)}>
                    {outcomeLabel(row)}
                  </Status>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
  const aside = (
    <>
      <Section title={t('data.importFlow.summary')}>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
          <dt className="text-fg-muted">{t('data.importFlow.willAdd')}</dt>
          <dd className="m-0 font-medium">{review.summary.added} rows</dd>
          <dt className="text-fg-muted">{t('data.importFlow.fillsPlanned')}</dt>
          <dd className="m-0 font-medium">{review.summary.planned} rows</dd>
          <dt className="text-fg-muted">{t('data.importFlow.flagged')}</dt>
          <dd className="m-0 font-medium">{review.summary.flagged} rows</dd>
          <dt className="text-fg-muted">{t('data.importFlow.skipped')}</dt>
          <dd className="m-0 font-medium">{review.summary.skipped} controls</dd>
        </dl>
      </Section>
      <Section title={t('data.importFlow.flaggedRows')}>
        <p className="m-0 text-body text-fg-muted">
          {t('data.importFlow.flaggedRowsImportTheir')}
        </p>
      </Section>
      <Section title={t('data.importFlow.record')}>
        <p className="m-0 text-body text-fg-muted">
          {t('data.importFlow.importMappingFileHash')}{' '}
          {target
            ? t('data.importFlow.history', { target })
            : t('data.importFlow.datasetHistory')}{' '}
          {t('data.importFlow.experimentHistory')}
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
