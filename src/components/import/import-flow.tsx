import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

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
import { createDataClient } from '#/lib/data-client'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import { listPublishedDatasetSchemas } from '#/lib/dataset-product'
import { formatFileSize } from '#/lib/format-numbers'
import {
  datasetFieldsFromColumns,
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
  ImportMappingDocument,
  ImportParserSummary,
  ImportReviewResponse,
  ImportSheetPreview,
} from '#/lib/import/types'

import { ImportReceipt, findCommittedReceipt } from './import-receipt'
import type { ImportSearch } from './import-search'
import { parseImportMapping, serializeImportMapping } from './import-search'

const client = createDataClient()
const STEPS = ['Upload', 'Map columns', 'Review and import']
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
  const canonical = mapping.sources
    .map((source) => `${source.source}=${source.fieldId ?? ''}`)
    .join('|')
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
  if (row.outcome === 'skipped') return 'Control, not imported'
  if (row.outcome === 'flagged')
    return row.flags.map((flag) => flag.reason).join('; ') || 'Flagged'
  if (row.outcome === 'planned') return 'Fills planned row'
  return 'New row'
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
}) {
  const navigate = useNavigate()
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
    await navigate({
      to: '/import/$importId',
      params: { importId: upload.fileId },
      search: {
        step: 'map',
        dataset: target.datasetId,
        experiment: experimentId || undefined,
        instrument: instrumentId || undefined,
      },
    })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={[{ label: 'Datasets' }, { label: 'Import data' }]}
        title="Import data"
        meta="Store the file, check its columns, then see every row before importing."
      />
      <div className="px-4 py-4 md:px-6">
        <Stepper steps={STEPS} current={1} className="mb-4" />

        <div className="grid max-w-[900px] gap-4">
          <div className="grid max-w-[520px] gap-1 text-label text-fg-muted">
            <span>Import into</span>
            {datasets.isLoading ? (
              <p role="status" className="m-0 text-body text-fg-muted">
                Reading your Datasets…
              </p>
            ) : null}
            {datasets.isError ? (
              <Banner tone="bad" title="Your Datasets could not be read.">
                The list did not load, so appending to a Dataset cannot be
                offered yet.
                <Button variant="quiet" onClick={() => void datasets.refetch()}>
                  Retry
                </Button>
              </Banner>
            ) : null}
            {/* "No Dataset to append to" is a fact about the workspace, so it is
                only said once the read settled and came back empty — never while
                the list is still loading or after the read failed. */}
            {datasets.isSuccess && datasetRows.length === 0 ? (
              <p className="m-0 text-body text-fg-muted">
                There is no Dataset to append to yet. Name a new one below and
                the import creates it on the Model you choose.
              </p>
            ) : null}
            {datasetRows.length > 0 ? (
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-target"
                    checked={effectiveMode === 'append'}
                    onChange={() => setMode('append')}
                  />
                  Append to a Dataset
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-target"
                    checked={effectiveMode === 'new'}
                    onChange={() => setMode('new')}
                  />
                  New dataset
                </label>
              </div>
            ) : null}
          </div>

          {effectiveMode === 'append' ? (
            <label className="grid max-w-[420px] gap-1 text-label text-fg-muted">
              Dataset
              <Select
                aria-label="Import into dataset"
                value={datasetId}
                onChange={(event) => setDatasetId(event.target.value)}
              >
                <option value="">Choose a dataset…</option>
                {datasetRows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_id ?? item.name} · {item.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <div className="grid max-w-[520px] gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-label text-fg-muted">
                Model
                <Select
                  aria-label="Model for the new dataset"
                  value={schemaVersionId}
                  onChange={(event) => setSchemaVersionId(event.target.value)}
                >
                  <option value="">Choose a model…</option>
                  {(schemas.data ?? []).map((schema) => (
                    <option
                      key={schema.schemaVersionId}
                      value={schema.schemaVersionId}
                    >
                      {schema.name} v{schema.version}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1 text-label text-fg-muted">
                Dataset name
                <Input
                  aria-label="New dataset name"
                  value={newName}
                  placeholder="e.g. ELISA capsid titre — run 4"
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
            </div>
          )}

          <FileDrop
            className="max-w-[420px]"
            label="Laboratory file"
            inputLabel="Laboratory file"
            accept=".csv,.tsv,.tab,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={!targetReady}
            disabledReason="Choose where the file goes first."
            onFile={(file) => (file ? start(file) : undefined)}
          />

          <div className="grid max-w-[640px] gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-label text-fg-muted">
              Link to experiment
              <Select
                aria-label="Link to experiment"
                value={experimentId}
                onChange={(event) => setExperimentId(event.target.value)}
              >
                <option value="">No experiment</option>
                {(experiments.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.identifier || item.id.slice(0, 8)} · {item.title}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1 text-label text-fg-muted">
              Instrument
              <Select
                aria-label="Instrument"
                value={instrumentId}
                onChange={(event) => setInstrumentId(event.target.value)}
              >
                <option value="">No instrument</option>
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

          <Section title="What happens next">
            <ol className="m-0 grid list-decimal gap-1 pl-5 text-body text-fg-muted">
              <li>The file is stored unchanged with its SHA-256 hash.</li>
              <li>Check how file columns map to dataset fields and units.</li>
              <li>
                See every row that will be added, flagged or skipped, then
                import.
              </li>
            </ol>
            <p className="m-0 mt-2 max-w-[640px] text-body text-fg-muted">
              Each stored file gets its own link, so a mapping or check step can
              be shared and picked up later. When you are importing into a new
              Dataset, storing the file creates that Dataset straight away; no
              rows are written until you import.
            </p>
          </Section>
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
}: {
  importId: string
  search: ImportSearch
  onSearch: (next: ImportSearch) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const step: 'map' | 'check' = search.step === 'check' ? 'check' : 'map'
  const file = useQuery({
    queryKey: importQueryKeys.file(importId),
    queryFn: () =>
      fetchImportFile({ fileId: importId, datasetId: search.dataset }),
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
  const receipt = findCommittedReceipt(receipts.data, importId)
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

  const [manual, setManual] = useState(false)
  const [mappingValues, setMappingValues] = useState<Record<string, string>>({})
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
    setMappingReady(true)
  }, [mappingReady, file.data, dataset, headers, fields, urlMapping])

  const mappingDocument = useMemo<ImportMappingDocument>(
    () => ({
      sources: headers.map((source) => {
        const fieldId = mappingValues[source] ?? ''
        return {
          source,
          fieldId: fieldId || null,
          unit: fieldId
            ? (fields.find((field) => field.id === fieldId)?.unit ?? null)
            : null,
        }
      }),
    }),
    [fields, headers, mappingValues],
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
      step === 'check' && parsed && Boolean(datasetId) && mappedCount > 0,
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
              : 'The mapping could not be saved as the parser’s default.',
          )
        }
      }
      writeSearch({ ...search, step: 'check' })
    } finally {
      setBusy(false)
    }
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
        setError(result.errors.at(0)?.message ?? 'The import was rejected.')
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
          ? commitError.message
          : 'The import failed.',
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
          : 'The parser update request failed. The file is kept for retry.',
      )
    }
  }

  if (receipt) return <ImportReceipt importId={importId} receipt={receipt} />

  const notFound =
    file.error instanceof ImportRequestError &&
    (file.error.status === 404 || file.error.code === 'not_found')

  if (notFound) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          trail={[{ label: 'Datasets' }, { label: 'Import data' }]}
          title="Import not found"
        />
        <div className="px-4 py-4 md:px-6">
          <EmptyState
            icon="upload"
            title="This import doesn’t exist"
            description="It may have been cancelled, or it belongs to another workspace. Start again from the upload step."
            action={
              <Button
                variant="primary"
                nativeButton={false}
                render={<Link to="/import" />}
              >
                Import data
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
        trail={[{ label: 'Datasets' }, { label: 'Import data' }]}
        title="Import data"
        meta={
          <>
            <span>
              {file.data
                ? `${file.data.filename} · ${formatFileSize(file.data.byteSize)} · SHA-256 ${file.data.checksum.slice(0, 4)}…${file.data.checksum.slice(-4)}`
                : 'Reading the stored file…'}
            </span>
            {dataset ? (
              <span className="max-lg:hidden">
                Target {dataset.display_id ?? ''} · {dataset.name}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            {step === 'map' ? (
              <Button
                variant="primary"
                disabled={busy || mappedCount === 0 || !mappingReady}
                onClick={() => void continueToReview()}
              >
                {busy ? 'Checking…' : 'Continue'}
              </Button>
            ) : null}
            {step === 'check' ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => writeSearch({ ...search, step: 'map' })}
                >
                  Back to mapping
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    busy || !review.data || review.data.errors.length > 0
                  }
                  onClick={() => void runCommit()}
                >
                  {busy
                    ? 'Importing…'
                    : `Import ${review.data?.summary.added ?? 0} rows`}
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
          <Banner tone="bad" title="Import error" className="mb-4">
            {error}
            {file.data ? (
              <Button variant="quiet" onClick={() => void askAdmin()}>
                Ask admin to update parser
              </Button>
            ) : null}
          </Banner>
        ) : null}

        {saveWarning ? (
          <Banner
            tone="warn"
            title="Mapping not saved as this parser’s default"
            className="mb-4"
          >
            {saveWarning} This file still imports with the mapping you chose.
          </Banner>
        ) : null}

        {outcome ? (
          <Banner tone="info" title={`Imported ${outcome.committed} rows`}>
            Snapshot {outcome.snapshotVersionId?.slice(0, 8) ?? 'created'} ·
            import {outcome.importId?.slice(0, 8) ?? 'recorded'}. The original
            file is kept unchanged with its hash.{' '}
            {datasetId ? (
              <Link
                to="/datasets/$datasetId/snapshots"
                params={{ datasetId }}
                className="underline"
              >
                Open the Dataset snapshots
              </Link>
            ) : null}
          </Banner>
        ) : null}

        {file.isLoading ? (
          <p role="status" className="m-0 text-body text-fg-muted">
            Reading the stored file…
          </p>
        ) : null}

        {file.error ? (
          <Banner
            tone="bad"
            title="Could not open this import"
            className="mb-4"
          >
            {file.error.message}
            <Button variant="quiet" onClick={() => void file.refetch()}>
              Retry
            </Button>
          </Banner>
        ) : null}

        {datasetUnavailable ? (
          <Banner
            tone="bad"
            title="This Dataset is not available"
            className="mb-4"
          >
            The Dataset pinned to this import is not in your active Datasets. It
            may have been archived, or you may not have access to it.
          </Banner>
        ) : null}

        {file.data && !datasetId ? (
          <EmptyState
            icon="table"
            title="This import has no target"
            description="The file is stored but no Dataset is pinned. Start the import again to choose one."
            action={
              <Button
                variant="primary"
                nativeButton={false}
                render={<Link to="/import" />}
              >
                Import data
              </Button>
            }
          />
        ) : null}

        {file.data && datasetId && !parsed ? (
          <div className="grid max-w-[680px] gap-3">
            <Banner tone="warn" title="Nothing was imported">
              {file.data.parseError ??
                'The file could not be read with a registered parser.'}{' '}
              The file is kept so you can retry.
            </Banner>
            <div className="flex flex-wrap gap-2">
              {(file.data.draftParsers ?? []).map((draft) => (
                <Button
                  key={draft.key}
                  size="sm"
                  variant="secondary"
                  onClick={() => writeSearch({ ...search, parser: draft.key })}
                >
                  Try parser “{draft.label}” (draft)
                </Button>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void askAdmin()}
              >
                Ask an admin to update the parser
              </Button>
              <Button
                size="sm"
                variant="secondary"
                nativeButton={false}
                render={<Link to="/import" />}
              >
                Start a different import
              </Button>
            </div>
          </div>
        ) : null}

        {file.data && parsed && datasetPending && !showMapping ? (
          <p role="status" className="m-0 text-body text-fg-muted">
            Reading the target Dataset…
          </p>
        ) : null}

        {file.data && showParserChoice ? (
          <div className="grid max-w-[680px] gap-3">
            <Banner tone="warn" title="Choose how to read this file">
              {file.data.recognitionMessage ??
                'This file does not match a registered parser.'}
              {/* ImportFailed-light.png states this under the mismatch: the
                  file is kept, nothing was written. */}
              <p className="m-0 mt-1">
                Nothing was imported. The file is kept so you can retry.
              </p>
            </Banner>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setManual(true)}
              >
                Map columns by hand for this file
              </Button>
              {(file.data.draftParsers ?? []).map((draft) => (
                <Button
                  key={draft.key}
                  size="sm"
                  variant="secondary"
                  onClick={() => writeSearch({ ...search, parser: draft.key })}
                >
                  Try parser “{draft.label}” (draft)
                </Button>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void askAdmin()}
              >
                Ask an admin to update the parser
              </Button>
            </div>
          </div>
        ) : null}

        {showMapping ? (
          <div className="grid gap-4">
            <div className="grid max-w-[420px] gap-1 text-label text-fg-muted">
              Parser
              <Select
                aria-label="Parser for this file"
                value={activeParser?.key ?? ''}
                onChange={(event) => {
                  const next = event.target.value
                  setManual(next === '')
                  writeSearch({ ...search, parser: next || undefined })
                }}
              >
                <option value="">No parser — map by hand</option>
                {parserOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label} v{option.version}
                  </option>
                ))}
              </Select>
              {suggestedParser ? (
                <span className="text-label">
                  Suggested from the file name: {suggestedParser.label}. Change
                  it if the file came from another instrument.
                </span>
              ) : null}
            </div>
            <MapTable
              headers={headers}
              fields={fields}
              mappingValues={mappingValues}
              parser={activeParser}
              sheet={file.data?.sheet ?? null}
              onMap={(source, fieldId) => {
                const next = { ...mappingValues, [source]: fieldId }
                setMappingValues(next)
                writeSearch({ ...search, map: serializeImportMapping(next) })
              }}
            />
          </div>
        ) : null}

        {showReview ? (
          <ReviewTable
            review={review.data ?? null}
            loading={review.isFetching}
          />
        ) : null}
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
  if (!mapped) return 'No matching field'
  const matched = sampleRows
    .slice(0, 6)
    .filter((row) => (row[source] ?? '').trim().length > 0).length
  return `Matched ${matched} of ${Math.min(rowCount, 6)}`
}

function MapTable({
  headers,
  fields,
  mappingValues,
  parser,
  sheet,
  onMap,
}: {
  headers: string[]
  fields: ImportTargetField[]
  mappingValues: Record<string, string>
  parser: ImportParserSummary | null
  sheet: ImportSheetPreview | null
  onMap: (source: string, fieldId: string) => void
}) {
  const mappedCount = Object.values(mappingValues).filter(Boolean).length
  const sampleRows = sheet?.sampleRows ?? []
  return (
    <div className="grid gap-4">
      <p className="m-0 text-body text-fg-muted">
        Columns {mappedCount} of {headers.length} mapped
        {parser ? ` · continue to save this as ${parser.label}’s default` : ''}
      </p>
      <div className="overflow-auto rounded-md border">
        <Table aria-label="Column mapping">
          <TableHeader>
            <TableRow>
              <TableHead>File column</TableHead>
              <TableHead>Dataset field</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Example values</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {headers.map((header) => {
              const fieldId = mappingValues[header] ?? ''
              const field = fields.find((item) => item.id === fieldId)
              const examples = columnExamples(header, sampleRows)
              return (
                <TableRow key={header}>
                  <TableCell>{header}</TableCell>
                  <TableCell>
                    <Select
                      aria-label={`Map ${header}`}
                      value={fieldId}
                      onChange={(event) => onMap(header, event.target.value)}
                    >
                      <option value="">— not imported —</option>
                      {fields.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {field?.unit ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-fg-muted">
                    {examples.length > 0 ? examples.join(', ') : '—'}
                  </TableCell>
                  <TableCell>
                    <Status tone={fieldId ? 'ok' : 'stored'}>
                      {fieldId ? 'Mapped' : 'Skipped'}
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
}: {
  review: ImportReviewResponse | null
  loading: boolean
}) {
  if (loading && !review) {
    return (
      <p role="status" className="m-0 text-body text-fg-muted">
        Checking every row…
      </p>
    )
  }
  if (!review) return null
  return (
    <div className="grid gap-4">
      {review.errors.length > 0 ? (
        <Banner tone="bad" title="These rows stop the import">
          <ul className="m-0 pl-4">
            {review.errors.slice(0, 8).map((item) => (
              <li key={`${item.row}-${item.code}`}>
                Row {item.row ?? '?'}: {item.message}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-1">
            A row that cannot be read is not imported, and nothing is written
            while these are on the list. There is no cell editing here: fix the
            value in the source file and store it again, or go back to mapping
            and point that column at a field that accepts it.
          </p>
        </Banner>
      ) : null}
      <div className="overflow-auto rounded-md border">
        <Table aria-label="Rows to import">
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              {review.columns
                .filter((column) => column.fieldId)
                .map((column) => (
                  <TableHead key={column.source}>{column.source}</TableHead>
                ))}
              <TableHead>Outcome</TableHead>
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
      <Section title="Summary">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-1 text-body sm:grid-cols-3">
          <div>
            {/* The reference names this total "Will add"; the commit writes
                every row that is not a control, so it covers the planned and
                flagged rows the lines below break out. */}
            <dt className="text-fg-muted">Will add</dt>
            <dd className="m-0 font-medium">{review.summary.added} rows</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Fills planned</dt>
            <dd className="m-0 font-medium">{review.summary.planned} rows</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Flagged</dt>
            <dd className="m-0 font-medium">{review.summary.flagged} rows</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Skipped</dt>
            <dd className="m-0 font-medium">
              {review.summary.skipped} controls
            </dd>
          </div>
        </dl>
      </Section>
      <p className="m-0 max-w-[680px] text-body text-fg-muted">
        Flagged rows import with their flag and stay out of analyses until
        reviewed. Nothing is dropped silently. The import, mapping and file hash
        are written to the dataset and experiment History.
      </p>
      <p className="m-0 text-label text-fg-muted">
        Showing {review.rows.length} of {review.summary.total} rows, flags
        first. Committing {review.summary.added} rows.
      </p>
    </div>
  )
}
