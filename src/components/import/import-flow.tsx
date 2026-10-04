import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Input } from '#/components/v3/ui/input'
import { PageHeader, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Stepper } from '#/components/v3/ui/stepper'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { NativeSelect } from '#/components/v3/projects/select'
import { useExperimentRecords } from '#/components/v3/experiments/experiments-data'
import {
  calibrationStatus,
  useInstruments,
  useLatestCalibrationsByInstrument,
} from '#/components/v3/instruments/instruments-data'
import { createDataClient } from '#/lib/data-client'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import {
  datasetFieldsFromColumns,
  suggestImportMappings,
} from '#/lib/import-mapping'
import {
  commitImport,
  reviewImport,
  saveParserMapping,
  uploadImportFile,
} from '#/lib/import/data'
import type {
  ImportFileUploadResponse,
  ImportMappingDocument,
  ImportParserSummary,
  ImportReviewResponse,
} from '#/lib/import/types'

const client = createDataClient()
const STEPS = ['Upload', 'Map columns', 'Review and import']

type Step = 1 | 2 | 3

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
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
  if (row.outcome === 'planned')
    return `Fills planned row${row.plannedRowId ? '' : ''}`
  return 'New row'
}

/**
 * DSET-05 — the three-step import flow: Upload (store the raw file checksum
 * first, then parse and recognise a parser), Map columns (units, examples and
 * the parser's saved default) and Review and import (server-computed outcomes,
 * one snapshot on commit). The failure state offers the design's three
 * recovery options.
 */
export function ImportFlow() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const datasets = useQuery({
    queryKey: ['ui-port', 'import', 'datasets'],
    queryFn: () => fetchDatasetSummaries(client),
    staleTime: 15_000,
  })
  const experiments = useExperimentRecords(undefined)
  const instruments = useInstruments()
  const calibrations = useLatestCalibrationsByInstrument()

  const [step, setStep] = useState<Step>(1)
  const [datasetId, setDatasetId] = useState('')
  const [experimentId, setExperimentId] = useState('')
  const [instrumentId, setInstrumentId] = useState('')
  const [upload, setUpload] = useState<ImportFileUploadResponse | null>(null)
  const [activeParser, setActiveParser] = useState<ImportParserSummary | null>(
    null,
  )
  const [mappingValues, setMappingValues] = useState<Record<string, string>>({})
  const [review, setReview] = useState<ImportReviewResponse | null>(null)
  const [outcome, setOutcome] = useState<ImportCommitResponseSummary | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const dataset = useMemo(
    () => (datasets.data ?? []).find((item) => item.id === datasetId) ?? null,
    [datasets.data, datasetId],
  )
  const fields = useMemo(
    () => (dataset ? datasetFieldsFromColumns(dataset.columns) : []),
    [dataset],
  )
  const headers = upload?.sheet?.headers ?? []
  const mappingDocument = useMemo<ImportMappingDocument>(() => {
    const byId = new Map(fields.map((field) => [field.id, field]))
    return {
      sources: headers.map((source) => {
        const fieldId = mappingValues[source] ?? ''
        return {
          source,
          fieldId: fieldId || null,
          unit: fieldId ? (byId.get(fieldId)?.unit ?? null) : null,
        }
      }),
    }
  }, [fields, headers, mappingValues])

  const failed = upload !== null && (!upload.parsed || upload.parser === null)
  const mappedCount = Object.values(mappingValues).filter(Boolean).length

  function resetForNewFile() {
    setUpload(null)
    setActiveParser(null)
    setReview(null)
    setOutcome(null)
    setError('')
    setStep(1)
  }

  function applyMappingDefaults(next: ImportFileUploadResponse) {
    const nextHeaders = next.sheet?.headers ?? []
    const saved = next.savedMapping?.sources ?? []
    const suggested = suggestImportMappings(nextHeaders, fields)
    const values: Record<string, string> = {}
    for (const source of nextHeaders) {
      const savedEntry = saved.find((entry) => entry.source === source)
      const suggestedEntry = suggested.find((entry) => entry.source === source)
      values[source] =
        savedEntry?.fieldId ??
        (suggestedEntry?.kind === 'field' ? suggestedEntry.field.id : '')
    }
    setMappingValues(values)
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadImportFile({ file, datasetId: datasetId || null }),
    onSuccess: (result) => {
      setUpload(result)
      setActiveParser(result.parser)
      setReview(null)
      setOutcome(null)
      setError('')
      if (result.parsed && result.parser) {
        applyMappingDefaults(result)
        setStep(2)
      }
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : 'Could not upload the file.',
      )
    },
  })

  async function continueToReview() {
    if (!upload || !datasetId) return
    setBusy(true)
    setError('')
    try {
      if (activeParser?.parserId) {
        await saveParserMapping(client, {
          parserId: activeParser.parserId,
          targetKey: `dataset:${datasetId}`,
          mapping: mappingDocument,
        })
      }
      const next = await reviewImport({
        fileId: upload.fileId,
        datasetId,
        mapping: mappingDocument,
        parserKey: activeParser?.key ?? null,
        parserVersionId: activeParser?.parserVersionId ?? null,
        sheetName: upload.sheet?.name ?? null,
      })
      setReview(next)
      setStep(3)
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : 'Could not review the file.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function runCommit() {
    if (!upload || !datasetId) return
    setBusy(true)
    setError('')
    try {
      const result = await commitImport({
        fileId: upload.fileId,
        datasetId,
        mapping: mappingDocument,
        parserKey: activeParser?.key ?? null,
        parserId: activeParser?.parserId ?? null,
        parserVersionId: activeParser?.parserVersionId ?? null,
        experimentRecordId: experimentId || null,
        instrumentId: instrumentId || null,
        sheetName: upload.sheet?.name ?? null,
        idempotencyKey: crypto.randomUUID(),
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
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'import', 'datasets'],
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

  const latestCalibration = instrumentId
    ? calibrations.data?.get(instrumentId)
    : undefined
  const calibration = calibrationStatus(latestCalibration?.dueAt ?? null)

  function recoverManual() {
    if (!upload) return
    setActiveParser(null)
    applyMappingDefaults(upload)
    setError('')
    setStep(2)
  }

  function recoverDraft(parser: ImportParserSummary) {
    if (!upload) return
    setActiveParser(parser)
    applyMappingDefaults(upload)
    setError('')
    setStep(2)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        crumbs="Datasets / Import data"
        title="Import data"
        meta={
          <>
            <span>
              {upload
                ? `${upload.filename} · ${formatBytes(upload.byteSize)} · SHA-256 ${upload.checksum.slice(0, 4)}…${upload.checksum.slice(-4)}`
                : 'Store the file, check its columns, then see every row before importing.'}
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
            {step === 1 ? (
              <Button
                variant="primary"
                disabled={!upload || failed || uploadMutation.isPending}
                onClick={() => {
                  if (upload) {
                    applyMappingDefaults(upload)
                    setStep(2)
                  }
                }}
              >
                Continue
              </Button>
            ) : null}
            {step === 2 ? (
              <Button
                variant="primary"
                disabled={busy || mappedCount === 0}
                onClick={() => void continueToReview()}
              >
                {busy ? 'Checking…' : 'Continue'}
              </Button>
            ) : null}
            {step === 3 && !outcome ? (
              <Button
                variant="primary"
                disabled={busy || (review?.errors.length ?? 1) > 0}
                onClick={() => void runCommit()}
              >
                {busy
                  ? 'Importing…'
                  : `Import ${review?.summary.added ?? 0} rows`}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="px-4 py-4 md:px-6">
        <Stepper
          steps={STEPS}
          current={failed ? 1 : step}
          failed={failed}
          className="mb-4"
        />

        {error ? (
          <Banner tone="bad" title="Import error" className="mb-4">
            {error}
          </Banner>
        ) : null}

        {outcome ? (
          <Banner tone="info" title={`Imported ${outcome.committed} rows`}>
            Snapshot {outcome.snapshotVersionId?.slice(0, 8) ?? 'created'} ·
            import {outcome.importId?.slice(0, 8) ?? 'recorded'}. The original
            file is kept unchanged with its hash.
          </Banner>
        ) : null}

        {step === 1 ? (
          <UploadStep
            datasets={datasets.data ?? []}
            datasetId={datasetId}
            onDataset={setDatasetId}
            experiments={experiments.data ?? []}
            experimentId={experimentId}
            onExperiment={setExperimentId}
            instruments={instruments.data ?? []}
            instrumentId={instrumentId}
            onInstrument={setInstrumentId}
            calibration={calibration}
            upload={upload}
            busy={uploadMutation.isPending}
            failed={failed}
            onFile={(file) => uploadMutation.mutate(file)}
            onReplace={resetForNewFile}
            onManual={recoverManual}
            onTryDraft={recoverDraft}
            onAskAdmin={() => void navigate({ to: '/instruments' })}
          />
        ) : null}

        {step === 2 ? (
          <MapStep
            upload={upload}
            fields={fields}
            mappingValues={mappingValues}
            onMap={(source, fieldId) =>
              setMappingValues((current) => ({ ...current, [source]: fieldId }))
            }
            parser={activeParser}
          />
        ) : null}

        {step === 3 ? <ReviewStep upload={upload} review={review} /> : null}
      </div>
    </div>
  )
}

interface ImportCommitResponseSummary {
  committed: number
  importId: string | null
  snapshotVersionId: string | null
  outcome: Record<string, number>
}

function UploadStep({
  datasets,
  datasetId,
  onDataset,
  experiments,
  experimentId,
  onExperiment,
  instruments,
  instrumentId,
  onInstrument,
  calibration,
  upload,
  busy,
  failed,
  onFile,
  onReplace,
  onManual,
  onTryDraft,
  onAskAdmin,
}: {
  datasets: CanonicalDatasetWire[]
  datasetId: string
  onDataset: (id: string) => void
  experiments: Array<{ id: string; identifier: string | null; title: string }>
  experimentId: string
  onExperiment: (id: string) => void
  instruments: Array<{ id: string; displayId: string | null; name: string }>
  instrumentId: string
  onInstrument: (id: string) => void
  calibration: { tone: Tone; label: string }
  upload: ImportFileUploadResponse | null
  busy: boolean
  failed: boolean
  onFile: (file: File) => void
  onReplace: () => void
  onManual: () => void
  onTryDraft: (parser: ImportParserSummary) => void
  onAskAdmin: () => void
}) {
  return (
    <div className="grid max-w-[900px] gap-4">
      {datasets.length === 0 ? (
        <EmptyState
          icon="table"
          title="No dataset to import into"
          body="Create a dataset from a model first, then import instrument files into it."
        />
      ) : (
        <label className="grid max-w-[420px] gap-1 text-label text-fg-muted">
          Import into
          <NativeSelect
            aria-label="Import into dataset"
            value={datasetId}
            onChange={(event) => onDataset(event.target.value)}
          >
            <option value="">Choose a dataset…</option>
            {datasets.map((item) => (
              <option key={item.id} value={item.id}>
                Append to {item.display_id ?? item.name} · {item.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}

      {upload ? (
        <div className="grid gap-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Status tone={upload.parsed && upload.parser ? 'ok' : 'warn'}>
              {upload.parser
                ? `Recognised as ${upload.parser.label} v${upload.parser.version}`
                : 'Not recognised'}
            </Status>
            <Button size="sm" variant="secondary" onClick={onReplace}>
              Replace file
            </Button>
          </div>
          <p className="m-0 text-body text-fg-muted">
            {upload.recognitionMessage}
          </p>
          {!upload.parsed ? (
            <p className="m-0 text-body text-fg-muted">
              {upload.parseError} Nothing was imported. The file is kept so you
              can retry.
            </p>
          ) : null}
          {failed ? (
            <div className="grid gap-2">
              <p className="m-0 text-body text-fg-muted">
                Nothing was imported. The file is kept so you can retry. How do
                you want to continue?
              </p>
              <div className="flex flex-wrap gap-2">
                {upload.parsed ? (
                  <Button size="sm" variant="secondary" onClick={onManual}>
                    Map columns by hand for this file
                  </Button>
                ) : null}
                {(upload.draftParsers ?? []).map((draft) => (
                  <Button
                    key={draft.key}
                    size="sm"
                    variant="secondary"
                    onClick={() => onTryDraft(draft)}
                  >
                    Try parser “{draft.label}” (draft)
                  </Button>
                ))}
                <Button size="sm" variant="secondary" onClick={onAskAdmin}>
                  Ask an admin to update the parser
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <label className="grid max-w-[420px] gap-1 text-label text-fg-muted">
          Laboratory file
          <Input
            type="file"
            disabled={!datasetId || busy}
            accept=".csv,.tsv,.tab,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onFile(file)
            }}
          />
        </label>
      )}

      <div className="grid max-w-[640px] gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-label text-fg-muted">
          Link to experiment
          <NativeSelect
            aria-label="Link to experiment"
            value={experimentId}
            onChange={(event) => onExperiment(event.target.value)}
          >
            <option value="">No experiment</option>
            {experiments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.identifier ?? item.id.slice(0, 8)} · {item.title}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-label text-fg-muted">
          Instrument
          <NativeSelect
            aria-label="Instrument"
            value={instrumentId}
            onChange={(event) => onInstrument(event.target.value)}
          >
            <option value="">No instrument</option>
            {instruments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayId ?? item.name} · {item.name}
              </option>
            ))}
          </NativeSelect>
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
            See every row that will be added, flagged or skipped, then import.
          </li>
        </ol>
      </Section>
    </div>
  )
}

function MapStep({
  upload,
  fields,
  mappingValues,
  onMap,
  parser,
}: {
  upload: ImportFileUploadResponse | null
  fields: Array<{ id: string; label: string; unit?: string | null }>
  mappingValues: Record<string, string>
  onMap: (source: string, fieldId: string) => void
  parser: ImportParserSummary | null
}) {
  if (!upload?.sheet) return null
  const headers = upload.sheet.headers
  const mappedCount = Object.values(mappingValues).filter(Boolean).length
  return (
    <div className="grid gap-4">
      <p className="m-0 text-body text-fg-muted">
        {mappedCount} of {headers.length} mapped
        {parser ? ` · saved as the default for ${parser.label}` : ''}
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {headers.map((header) => {
              const fieldId = mappingValues[header] ?? ''
              const field = fields.find((item) => item.id === fieldId)
              const examples = upload
                .sheet!.sampleRows.slice(0, 3)
                .map((row) => row[header])
                .filter((value) => value)
              return (
                <TableRow key={header}>
                  <TableCell>{header}</TableCell>
                  <TableCell>
                    <NativeSelect
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
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {field?.unit ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-fg-muted">
                    {examples.join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <Status tone={fieldId ? 'ok' : 'stored'}>
                      {fieldId ? 'Mapped' : 'Skipped'}
                    </Status>
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

function ReviewStep({
  upload,
  review,
}: {
  upload: ImportFileUploadResponse | null
  review: ImportReviewResponse | null
}) {
  if (!review) return null
  return (
    <div className="grid gap-4">
      {review.errors.length > 0 ? (
        <Banner tone="bad" title="Fix these rows before importing">
          <ul className="m-0 pl-4">
            {review.errors.slice(0, 8).map((item) => (
              <li key={`${item.row}-${item.code}`}>
                Row {item.row ?? '?'}: {item.message}
              </li>
            ))}
          </ul>
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
      {upload ? (
        <p className="m-0 text-label text-fg-muted">
          Showing {review.rows.length} of {review.summary.total} rows, flags
          first. Committing {review.summary.added} rows.
        </p>
      ) : null}
    </div>
  )
}
