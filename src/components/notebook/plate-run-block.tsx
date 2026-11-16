/**
 * The plate run block: one plate run shown in the notebook, live. It carries
 * the plate map, how the plate did against its controls (Z′, signal to
 * background), the hits and the fitted potencies, so the experiment reads the
 * result without leaving the page. The block holds only the run's id; the
 * database keeps a small pinned copy of the result so a submitted revision
 * shows what the run said when it was submitted.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { Icon } from '#/components/icons'
import { NewRunDialog } from '#/components/plates/new-run-dialog'
import { PlateRunSummary, Stat } from '#/components/plates/plate-run-summary'
import { fmt } from '#/components/plates/plates-shared'
import type { MapView } from '#/components/plates/plates-shared'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import type { PickerOption } from '#/components/record-picker/entity-picker'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { FileDrop } from '#/components/ui/file-drop'
import { Status } from '#/components/ui/status'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { addPlateRunToExperiment } from '#/lib/plate-experiment-run'
import {
  fetchPlateRun,
  fetchPlateRuns,
  messageOf,
  plateRunKeys,
  plateRunReference,
} from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'
import type { BlockEditorProps } from './block-editor'
import { plateRunBlockPayload } from './plate-run-block-data'
import type { PlateRunBlockPayload } from './plate-run-block-data'

const client = notebookDataClient

function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: plateRunKeys.one(runId ?? ''),
    queryFn: () => fetchPlateRun(client, runId ?? ''),
    enabled: Boolean(runId),
    staleTime: 5_000,
  })
}

/** The result as the block pinned it, for when the run can't be read. */
function PinnedResult({
  pinned,
}: {
  pinned: NonNullable<PlateRunBlockPayload['pinned']>
}) {
  const zPrime = pinned.zPrime

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="mono text-fg-muted">{pinned.reference}</span>
        <span className="font-heading text-[15px] font-semibold">
          {pinned.name}
        </span>
        {pinned.analysedAt ? (
          <span className="text-label text-fg-muted">
            {t('plates.run.analysedOn', {
              date: formatDate(pinned.analysedAt),
            })}
          </span>
        ) : null}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat
          label={t('plates.qc.zPrime')}
          value={fmt(zPrime ?? null, 2)}
          tone={
            zPrime === undefined
              ? undefined
              : zPrime >= 0.5
                ? 'ok'
                : zPrime >= 0
                  ? 'warn'
                  : 'bad'
          }
        />
        <Stat
          label={t('plates.qc.signalToBackground')}
          value={fmt(pinned.signalToBackground ?? null, 3)}
        />
        <Stat
          label={t('features.plateRuns.summary.hits')}
          value={
            pinned.hitSamples === undefined
              ? ''
              : t('features.plateRuns.summary.hitsOf', {
                  hits: pinned.hitSamples,
                  tested: pinned.testedSamples ?? 0,
                })
          }
        />
        <Stat
          label={t('features.plateRuns.summary.readWells')}
          value={pinned.readWells === undefined ? '' : String(pinned.readWells)}
        />
      </dl>
    </div>
  )
}

/**
 * The block as a reader sees it. In a frozen revision it never reads the run:
 * it shows the pinned result it was submitted with.
 */
export function PlateRunBlockPreview({
  payload,
  frozen = false,
}: {
  payload: unknown
  frozen?: boolean
}) {
  const parsed = plateRunBlockPayload.safeParse(payload)
  const data = parsed.success ? parsed.data : {}
  const [view, setView] = useState<MapView>(data.view ?? 'hits')
  const run = useRun(frozen ? undefined : data.runId)

  if (!data.runId)
    return (
      <p className="m-0 text-fg-muted">{t('features.plateRuns.block.noRun')}</p>
    )

  if (!frozen && run.isPending)
    return (
      <p className="m-0 text-fg-muted">
        {t('features.plateRuns.block.loading')}
      </p>
    )

  if (!frozen && run.data)
    return (
      <div className="rounded-lg border border-border-subtle p-4">
        <PlateRunSummary run={run.data} view={view} onViewChange={setView} />
      </div>
    )

  if (data.pinned)
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4">
        <PinnedResult pinned={data.pinned} />
        <p className="m-0 text-label text-fg-muted">
          {frozen
            ? t('features.plateRuns.block.pinnedFrozen')
            : t('features.plateRuns.block.pinnedUnavailable')}
        </p>
      </div>
    )

  return (
    <Notice tone="warn">{t('features.plateRuns.block.unavailable')}</Notice>
  )
}

/** Runs that can go in this notebook: its own, and any that no experiment has. */
function useRunOptions(recordId: string) {
  const runs = useQuery({
    queryKey: plateRunKeys.list,
    queryFn: () => fetchPlateRuns(client),
    staleTime: 10_000,
  })

  const options: PickerOption[] = (runs.data ?? []).map((run) => {
    const elsewhere = run.record_id !== null && run.record_id !== recordId

    return {
      id: run.id,
      identifier: plateRunReference(run.number),
      label: run.name,
      detail: t(`plates.formats.${run.format}`),
      disabled: elsewhere,
      disabledReason: elsewhere
        ? t('features.plateRuns.block.inAnotherExperiment')
        : undefined,
    }
  })

  return { options, loading: runs.isPending }
}

/**
 * The block while it is being edited. With no run it offers the two ways to
 * get one: drop the reader's file, or pick a run that is already in Sheetbase.
 */
export function PlateRunBlockEditor({
  block,
  save,
  readOnly,
  onStatusChange,
}: BlockEditorProps) {
  const queryClient = useQueryClient()
  const parsed = plateRunBlockPayload.safeParse(block.payload)
  const data = parsed.success ? parsed.data : {}
  const run = useRun(data.runId)
  const { options, loading } = useRunOptions(block.recordId)
  const [dropped, setDropped] = useState<File | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)

  async function chooseRun(runId: string, view?: MapView) {
    setError(null)
    onStatusChange?.('saving')

    try {
      await addPlateRunToExperiment(client, {
        runId,
        recordId: block.recordId,
        addBlock: false,
      })

      const result = await save({ runId, view: view ?? data.view ?? 'hits' })

      if (!result.ok)
        throw new Error(
          result.message ?? t('features.plateRuns.block.couldNotSave'),
        )
      onStatusChange?.('clean')
      setChanging(false)
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
    } catch (cause) {
      onStatusChange?.('failed')
      setError(messageOf(cause, t('features.plateRuns.block.couldNotSave')))
    }
  }

  async function chooseView(view: MapView) {
    const result = await save({ ...block.payload, view })

    if (!result.ok)
      setError(result.message ?? t('features.plateRuns.block.couldNotSave'))
  }

  const hasRun = Boolean(data.runId)

  return (
    <div className="flex flex-col gap-3">
      {hasRun && run.data ? (
        <RunWithControls
          run={run.data}
          view={data.view ?? 'hits'}
          readOnly={Boolean(readOnly)}
          changing={changing}
          onChange={() => setChanging((v) => !v)}
          onView={(view) => void chooseView(view)}
        />
      ) : null}
      {hasRun && !run.data && !run.isPending ? (
        <Notice tone="warn">{t('features.plateRuns.block.unavailable')}</Notice>
      ) : null}
      {!readOnly && (!hasRun || changing) ? (
        <div className="grid gap-3 rounded-lg border border-dashed border-border p-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 font-medium">
              <Icon name="upload" size={16} aria-hidden="true" />
              {t('features.plateRuns.block.addTitle')}
            </div>
            <p className="m-0 text-label text-fg-muted">
              {t('features.plateRuns.block.addHint')}
            </p>
            <FileDrop
              label={t('features.plateRuns.form.drop')}
              accept=".csv,.tsv,.txt,.xlsx"
              onFile={(file) => {
                if (!file) return
                setDropped(file)
                setAdding(true)
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 font-medium">
              <Icon name="grid" size={16} aria-hidden="true" />
              {t('features.plateRuns.block.pickTitle')}
            </div>
            <p className="m-0 text-label text-fg-muted">
              {t('features.plateRuns.block.pickHint')}
            </p>
            <PickerSelect
              noun="plate run"
              value={data.runId ?? ''}
              options={options}
              onChange={(id) => {
                if (id) void chooseRun(id)
              }}
              placeholder={
                loading
                  ? t('features.plateRuns.block.loading')
                  : t('features.plateRuns.block.pickPlaceholder')
              }
            />
          </div>
        </div>
      ) : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {adding ? (
        <NewRunDialog
          open={adding}
          onOpenChange={(open) => {
            setAdding(open)

            if (!open) setDropped(null)
          }}
          experimentId={block.recordId}
          initialFile={dropped}
          onCreated={(created) => void chooseRun(created.id)}
        />
      ) : null}
    </div>
  )
}

function RunWithControls({
  run,
  view,
  readOnly,
  changing,
  onChange,
  onView,
}: {
  run: PlateRunRow
  view: MapView
  readOnly: boolean
  changing: boolean
  onChange: () => void
  onView: (view: MapView) => void
}) {
  const [picked, setPicked] = useState<MapView | null>(null)
  const shown = picked ?? view

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4">
      <PlateRunSummary
        run={run}
        view={shown}
        onViewChange={(next) => {
          setPicked(next)
          onView(next)
        }}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
        <Button
          size="sm"
          nativeButton={false}
          render={<Link to="/plates" search={{ run: run.id }} />}
        >
          {t('features.plateRuns.block.openRun')}
        </Button>
        {!readOnly ? (
          <Button size="sm" variant="quiet" onClick={onChange}>
            {changing
              ? t('features.plateRuns.block.keepRun')
              : t('features.plateRuns.block.changeRun')}
          </Button>
        ) : null}
        <Status tone="none">{t('features.plateRuns.block.live')}</Status>
      </div>
    </div>
  )
}
