/**
 * Run quality control: the values a lab tracks across runs, each with its
 * Levey-Jennings chart, limits, Westgard rules and the runs that broke one.
 * Shown on an instrument and on the Plates page.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Textarea } from '#/components/inventory/list'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { RadioGroup } from '#/components/ui/radio-group'
import { Choice } from '#/components/ui/choice'
import { Select } from '#/components/ui/select'
import { Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  QC_POINT_LIMIT,
  QC_RULES,
  acknowledgeQcPoint,
  createQcSeries,
  deleteQcSeries,
  fetchPlateDesignOptions,
  fetchQcPoints,
  fetchQcSeries,
  openBreaches,
  qcKeys,
  qcMessage,
  recordQcPoint,
  scopeKey,
  setQcBaseline,
  trackPlateAssayQc,
  updateQcSeries,
} from '#/lib/run-qc'
import type { QcPointRow, QcRule, QcScope, QcSeriesRow } from '#/lib/run-qc'

import { LeveyJenningsChart, ruleLabel } from './levey-jennings-chart'

const client = notebookDataClient

function number(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'))

  return text.trim() !== '' && Number.isFinite(value) ? value : null
}

function short(value: number | null): string {
  return value === null ? '—' : String(Number(value.toPrecision(4)))
}

/** How one series reads in the list: its tone and its words. */
interface SeriesStatus {
  tone: 'ok' | 'bad' | 'warn' | 'none'
  label: string
}

function seriesStatus(series: QcSeriesRow): SeriesStatus {
  if (!series.enabled)
    return { tone: 'none', label: t('quality.runQc.status.off') }

  if (series.mean === null || series.sd === null)
    return { tone: 'warn', label: t('quality.runQc.status.noLimits') }

  return series.state === 'out_of_control'
    ? { tone: 'bad', label: t('quality.runQc.status.outOfControl') }
    : { tone: 'ok', label: t('quality.runQc.status.inControl') }
}

function seriesName(series: QcSeriesRow): string {
  return series.name
}

/**
 * The series table's columns: what is tracked, its limits, and whether it is
 * in control.
 */
function useQcSeriesColumns(): RegistryColumn<QcSeriesRow>[] {
  return useMemo<RegistryColumn<QcSeriesRow>[]>(
    () => [
      {
        id: 'name',
        header: t('quality.runQc.columns.series'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {seriesName(row.original)}
          </span>
        ),
      },
      {
        id: 'limits',
        header: t('quality.runQc.columns.limits'),
        size: 160,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {seriesLimits(row.original)}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('quality.runQc.columns.status'),
        size: 150,
        cell: ({ row }) => {
          const status = seriesStatus(row.original)

          return <Status tone={status.tone}>{status.label}</Status>
        },
      },
    ],
    [],
  )
}

/** A series' limits as one line, or a dash when none are set. */
function seriesLimits(row: QcSeriesRow): string {
  if (row.mean === null || row.sd === null) return '—'

  return t('quality.runQc.limitsValue', {
    mean: short(row.mean),
    sd: short(row.sd),
  })
}

export function RunQcPanel({
  scope,
  workspaceId,
  canWrite,
}: {
  scope: QcScope
  workspaceId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const key = scopeKey(scope)

  const list = useQuery({
    queryKey: qcKeys.series(key),
    queryFn: () => fetchQcSeries(client, scope),
    staleTime: 10_000,
  })

  const series = useMemo(() => list.data ?? [], [list.data])
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'value' | 'assay' | null>(null)

  // The detail shows the row a person picked, or the series that needs
  // attention: the first out of control, else the first tracked one.
  const selected =
    series.find((s) => s.id === pickedId) ??
    series.find((s) => s.state === 'out_of_control') ??
    series.at(0) ??
    null

  const selectedId = selected?.id ?? null

  const columns = useQcSeriesColumns()

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: qcKeys.all })

  return (
    <Section
      className="border-t border-border pt-4"
      title={t('quality.runQc.title')}
      count={series.length > 0 ? series.length : undefined}
      action={
        <QcPanelActions
          canWrite={canWrite}
          onTrackAssay={() => setDialog('assay')}
          onTrackValue={() => setDialog('value')}
        />
      }
    >
      <QcSeriesBody
        list={list}
        series={series}
        columns={columns}
        selected={selected}
        selectedId={selectedId}
        canWrite={canWrite}
        onPick={setPickedId}
        onChanged={refresh}
      />
      <QcPanelDialogs
        dialog={dialog}
        scope={scope}
        workspaceId={workspaceId}
        onClose={() => setDialog(null)}
        onCreated={(created) => {
          setPickedId(created.id)
          refresh()
        }}
        onChanged={refresh}
      />
    </Section>
  )
}

/** The two ways a person can start tracking a value. */
function QcPanelActions({
  canWrite,
  onTrackAssay,
  onTrackValue,
}: {
  canWrite: boolean
  onTrackAssay: () => void
  onTrackValue: () => void
}) {
  if (!canWrite) return undefined

  return (
    <>
      <Button size="sm" onClick={onTrackAssay}>
        {t('quality.runQc.trackAssay')}
      </Button>
      <Button size="sm" onClick={onTrackValue}>
        {t('quality.runQc.trackValue')}
      </Button>
    </>
  )
}

/** The series table and the detail of the series being read. */
function QcSeriesBody({
  list,
  series,
  columns,
  selected,
  selectedId,
  canWrite,
  onPick,
  onChanged,
}: {
  list: UseQueryResult<QcSeriesRow[]>
  series: QcSeriesRow[]
  columns: RegistryColumn<QcSeriesRow>[]
  selected: QcSeriesRow | null
  selectedId: string | null
  canWrite: boolean
  onPick: (id: string) => void
  onChanged: () => void
}) {
  if (list.isError) {
    return (
      <Notice tone="bad" title={t('quality.runQc.loadError')}>
        {qcMessage(list.error)}
      </Notice>
    )
  }

  if (!list.isPending && series.length === 0) {
    return (
      <EmptyState
        className="items-start py-6"
        icon="chart"
        title={t('quality.runQc.empty')}
        description={t('quality.runQc.emptyBody')}
      />
    )
  }

  return (
    <>
      <TableBox>
        <RegistryGrid
          label={t('quality.runQc.tableLabel')}
          rows={series}
          columns={columns}
          getRowId={(s) => s.id}
          rowSelection={selectedId ? { [selectedId]: true } : {}}
          onRowClick={(s) => onPick(s.id)}
          isLoading={list.isPending}
        />
      </TableBox>
      {selected ? (
        <SeriesDetail
          key={selected.id}
          series={selected}
          canWrite={canWrite}
          onChanged={onChanged}
        />
      ) : null}
      {!canWrite && !list.isPending ? (
        <p className="m-0 text-label text-fg-muted">
          {t('quality.runQc.readOnly')}
        </p>
      ) : null}
    </>
  )
}

/** The dialogs that record a value, track an assay or add a series. */
function QcPanelDialogs({
  dialog,
  scope,
  workspaceId,
  onClose,
  onCreated,
  onChanged,
}: {
  dialog: 'value' | 'assay' | null
  scope: QcScope
  workspaceId: string
  onClose: () => void
  onCreated: (created: QcSeriesRow) => void
  onChanged: () => void
}) {
  if (dialog === 'value') {
    return (
      <TrackValueDialog
        workspaceId={workspaceId}
        instrumentId={scope.instrumentId ?? null}
        onClose={onClose}
        onDone={onCreated}
      />
    )
  }

  if (dialog === 'assay') {
    return (
      <TrackAssayDialog
        instrumentId={scope.instrumentId ?? null}
        onClose={onClose}
        onDone={onChanged}
      />
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// One series
// ---------------------------------------------------------------------------

function SeriesDetail({
  series,
  canWrite,
  onChanged,
}: {
  series: QcSeriesRow
  canWrite: boolean
  onChanged: () => void
}) {
  const points = useQuery({
    queryKey: qcKeys.points(series.id),
    queryFn: () => fetchQcPoints(client, series.id),
    staleTime: 5_000,
  })

  const rows = useMemo(() => points.data ?? [], [points.data])

  const [dialog, setDialog] = useState<
    'limits' | 'rules' | 'value' | 'stop' | null
  >(null)

  const [acknowledging, setAcknowledging] = useState<QcPointRow | null>(null)
  const queryClient = useQueryClient()

  const toggle = useMutation({
    mutationFn: () =>
      updateQcSeries(client, series.id, { enabled: !series.enabled }),
    onSuccess: () => onChanged(),
    onError: (error) => toast.error(qcMessage(error)),
  })

  const breaks = rows.filter((p) => p.violations.length > 0).reverse()
  const open = openBreaches(rows)

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: qcKeys.all })

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle p-3">
      <SeriesHeader
        series={series}
        canWrite={canWrite}
        pausing={toggle.isPending}
        onPause={() => toggle.mutate()}
        onDialog={setDialog}
      />
      <SeriesChart series={series} rows={rows} loading={points.isPending} />
      <SeriesBreaks
        open={open.length}
        breaks={breaks}
        canWrite={canWrite}
        onAcknowledge={setAcknowledging}
      />
      <SeriesDialogs
        series={series}
        pointCount={rows.length}
        dialog={dialog}
        acknowledging={acknowledging}
        onClose={() => setDialog(null)}
        onAcknowledgeClose={() => setAcknowledging(null)}
        onChanged={refresh}
      />
    </div>
  )
}

/** Which series this is, its state, and the actions a writer can take. */
function SeriesHeader({
  series,
  canWrite,
  pausing,
  onPause,
  onDialog,
}: {
  series: QcSeriesRow
  canWrite: boolean
  pausing: boolean
  onPause: () => void
  onDialog: (dialog: 'limits' | 'rules' | 'value' | 'stop') => void
}) {
  const source =
    series.source_kind === 'plate_metric'
      ? t('quality.runQc.detail.sourcePlateNoName')
      : t('quality.runQc.detail.sourceManual')

  const limits =
    series.mean === null || series.sd === null
      ? t('quality.runQc.detail.noLimitsYet')
      : series.baseline_n
        ? t('quality.runQc.detail.limitsFrom', { count: series.baseline_n })
        : t('quality.runQc.detail.limitsEntered')

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h3 className="m-0 text-body font-medium text-fg">{series.name}</h3>
      <Status tone={seriesStatus(series).tone}>
        {seriesStatus(series).label}
      </Status>
      <span className="text-label text-fg-muted">
        {source} · {limits}
        {series.unit ? ` · ${series.unit}` : ''}
      </span>
      {canWrite ? (
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDialog('limits')}>
            {t('quality.runQc.detail.setLimits')}
          </Button>
          {series.source_kind === 'manual' ? (
            <Button size="sm" onClick={() => onDialog('value')}>
              {t('quality.runQc.detail.addValue')}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => onDialog('rules')}>
            {t('quality.runQc.detail.rules')}
          </Button>
          <Button size="sm" disabled={pausing} onClick={onPause}>
            {series.enabled
              ? t('quality.runQc.detail.pause')
              : t('quality.runQc.detail.resume')}
          </Button>
          <Button size="sm" onClick={() => onDialog('stop')}>
            {t('quality.runQc.detail.stop')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** The chart, or the reasons it has nothing to draw. */
function SeriesChart({
  series,
  rows,
  loading,
}: {
  series: QcSeriesRow
  rows: QcPointRow[]
  loading: boolean
}) {
  return (
    <>
      {rows.length === 0 && !loading ? (
        <p className="m-0 text-body text-fg-muted">
          {t('quality.runQc.chart.noPoints')}
        </p>
      ) : (
        <LeveyJenningsChart series={series} points={rows} />
      )}
      {series.mean === null && rows.length > 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('quality.runQc.chart.noLimits')}
        </p>
      ) : null}
      {rows.length >= QC_POINT_LIMIT ? (
        <p className="m-0 text-label text-fg-muted">
          {t('quality.runQc.chart.older', { count: QC_POINT_LIMIT })}
        </p>
      ) : null}
    </>
  )
}

/** The runs that broke a Westgard rule, with the note each carries. */
function SeriesBreaks({
  open,
  breaks,
  canWrite,
  onAcknowledge,
}: {
  open: number
  breaks: QcPointRow[]
  canWrite: boolean
  onAcknowledge: (point: QcPointRow) => void
}) {
  const columns = useSeriesBreakColumns(canWrite, onAcknowledge)

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="m-0 text-label font-medium text-fg">
        {t('quality.runQc.breaks.title')}
        {open > 0 ? (
          <span className="num ml-2 text-fg-muted">{open}</span>
        ) : null}
      </h4>
      {breaks.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('quality.runQc.breaks.empty')}
        </p>
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('quality.runQc.breaks.tableLabel')}
            rows={breaks}
            columns={columns}
            getRowId={(p) => p.id}
            selectable={false}
          />
        </TableBox>
      )}
    </div>
  )
}

/** The series' own dialogs, one at a time. */
function SeriesDialogs({
  series,
  pointCount,
  dialog,
  acknowledging,
  onClose,
  onAcknowledgeClose,
  onChanged,
}: {
  series: QcSeriesRow
  pointCount: number
  dialog: 'limits' | 'rules' | 'value' | 'stop' | null
  acknowledging: QcPointRow | null
  onClose: () => void
  onAcknowledgeClose: () => void
  onChanged: () => void
}) {
  return (
    <>
      {dialog === 'limits' ? (
        <LimitsDialog
          series={series}
          pointCount={pointCount}
          onClose={() => onClose()}
          onDone={() => {
            onChanged()
          }}
        />
      ) : null}
      {dialog === 'rules' ? (
        <RulesDialog
          series={series}
          onClose={() => onClose()}
          onDone={() => {
            onChanged()
          }}
        />
      ) : null}
      {dialog === 'value' ? (
        <ValueDialog
          series={series}
          onClose={() => onClose()}
          onDone={() => {
            onChanged()
          }}
        />
      ) : null}
      {dialog === 'stop' ? (
        <StopDialog
          series={series}
          onClose={() => onClose()}
          onDone={() => {
            onChanged()
          }}
        />
      ) : null}
      {acknowledging ? (
        <AcknowledgeDialog
          point={acknowledging}
          onClose={() => onAcknowledgeClose()}
          onDone={() => {
            onChanged()
          }}
        />
      ) : null}
    </>
  )
}

/** The breaks table's columns, including the acknowledge action a writer gets. */
function useSeriesBreakColumns(
  canWrite: boolean,
  onAcknowledge: (point: QcPointRow) => void,
): RegistryColumn<QcPointRow>[] {
  return useMemo<RegistryColumn<QcPointRow>[]>(
    () => [
      {
        id: 'when',
        header: t('quality.runQc.breaks.columns.when'),
        size: 150,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {formatDate(row.original.at, { time: true })}
          </span>
        ),
      },
      {
        id: 'run',
        header: t('quality.runQc.breaks.columns.run'),
        size: 110,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">
            {row.original.label ?? '—'}
          </span>
        ),
      },
      {
        id: 'value',
        header: t('quality.runQc.breaks.columns.value'),
        size: 90,
        cell: ({ row }) => (
          <span className="num">{short(row.original.value)}</span>
        ),
      },
      {
        id: 'sd',
        header: t('quality.runQc.breaks.columns.sd'),
        size: 90,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {row.original.z === null
              ? '—'
              : t('quality.runQc.breaks.sdValue', {
                  z: row.original.z.toFixed(1),
                })}
          </span>
        ),
      },
      {
        id: 'rules',
        header: t('quality.runQc.breaks.columns.rules'),
        size: 150,
        cell: ({ row }) => (
          <span
            title={row.original.violations.map((r) => ruleLabel(r)).join('\n')}
          >
            {row.original.violations.join(', ')}
          </span>
        ),
      },
      {
        id: 'note',
        header: t('quality.runQc.breaks.columns.note'),
        cell: ({ row }) => {
          const point = row.original

          if (point.acknowledged_at)
            return (
              <span className="truncate text-fg-muted" title={point.note ?? ''}>
                {point.excluded
                  ? `${t('quality.runQc.breaks.leftOut')} · `
                  : ''}
                {point.note ?? t('quality.runQc.breaks.acknowledged')}
              </span>
            )

          return canWrite ? (
            <Button size="sm" onClick={() => onAcknowledge(point)}>
              {t('quality.runQc.breaks.acknowledge')}
            </Button>
          ) : null
        },
      },
    ],
    [canWrite, onAcknowledge],
  )
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function TrackValueDialog({
  workspaceId,
  instrumentId,
  onClose,
  onDone,
}: {
  workspaceId: string
  instrumentId: string | null
  onClose: () => void
  onDone: (created: QcSeriesRow) => void
}) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [mean, setMean] = useState('')
  const [sd, setSd] = useState('')
  const [touched, setTouched] = useState(false)
  const meanValue = number(mean)
  const sdValue = number(sd)
  const limitsGiven = mean.trim() !== '' || sd.trim() !== ''

  const nameError = name.trim()
    ? null
    : t('quality.runQc.trackDialog.nameRequired')

  const sdError =
    limitsGiven && (sdValue === null || sdValue <= 0)
      ? t('quality.runQc.trackDialog.sdRequired')
      : null

  const save = useMutation({
    mutationFn: () =>
      createQcSeries(client, {
        workspaceId,
        name,
        instrumentId,
        unit,
        mean: limitsGiven ? meanValue : null,
        sd: limitsGiven ? sdValue : null,
      }),
    onSuccess: (created) => {
      toast.success(t('quality.runQc.trackDialog.saved'))
      onDone(created)
      onClose()
    },
    onError: (error) =>
      toast.error(
        `${t('quality.runQc.trackDialog.couldNotSave')} ${qcMessage(error)}`,
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={t('quality.runQc.trackDialog.title')}
          description={t('quality.runQc.trackDialog.body')}
        />
        <DialogBody>
          <Field
            label={t('quality.runQc.trackDialog.name')}
            hint={t('quality.runQc.trackDialog.nameHint')}
            error={touched ? nameError : null}
            required
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t('quality.runQc.trackDialog.unit')}>
            <Input
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
          </Field>
          <p className="m-0 text-label text-fg-muted">
            {t('quality.runQc.trackDialog.limitsHint')}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('quality.runQc.trackDialog.mean')}>
              <Input
                inputMode="decimal"
                value={mean}
                onChange={(event) => setMean(event.target.value)}
              />
            </Field>
            <Field
              label={t('quality.runQc.trackDialog.sd')}
              error={touched ? sdError : null}
            >
              <Input
                inputMode="decimal"
                value={sd}
                onChange={(event) => setSd(event.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('quality.runQc.cancel')}
          </DialogClose>
          <Button
            disabled={save.isPending}
            onClick={() => {
              setTouched(true)

              if (nameError || sdError) return
              save.mutate()
            }}
          >
            {save.isPending
              ? t('quality.runQc.trackDialog.saving')
              : t('quality.runQc.trackDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TrackAssayDialog({
  instrumentId,
  onClose,
  onDone,
}: {
  instrumentId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const designs = useQuery({
    queryKey: qcKeys.designs,
    queryFn: () => fetchPlateDesignOptions(client),
    staleTime: 30_000,
  })

  const [designId, setDesignId] = useState('')
  const options = designs.data ?? []

  const save = useMutation({
    mutationFn: () => trackPlateAssayQc(client, designId, instrumentId),
    onSuccess: (created) => {
      toast.success(
        created.length > 0
          ? t('quality.runQc.assayDialog.added', { count: created.length })
          : t('quality.runQc.assayDialog.already'),
      )
      onDone()
      onClose()
    },
    onError: (error) =>
      toast.error(
        `${t('quality.runQc.assayDialog.couldNotSave')} ${qcMessage(error)}`,
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={t('quality.runQc.assayDialog.title')}
          description={t('quality.runQc.assayDialog.body')}
        />
        <DialogBody>
          {designs.isSuccess && options.length === 0 ? (
            <p className="m-0 text-body text-fg-muted">
              {t('quality.runQc.assayDialog.none')}
            </p>
          ) : (
            <Field label={t('quality.runQc.assayDialog.assay')}>
              <Select
                value={designId}
                onChange={(event) => setDesignId(event.target.value)}
              >
                <option value="">
                  {t('quality.runQc.assayDialog.choose')}
                </option>
                {options.map((design) => (
                  <option key={design.id} value={design.id}>
                    {design.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('quality.runQc.cancel')}
          </DialogClose>
          <Button
            disabled={!designId || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('quality.runQc.assayDialog.saving')
              : t('quality.runQc.assayDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The words a limits form shows beside each field it is missing. */
interface LimitsProblems {
  meanError: string | null
  sdError: string | null
  countError: string | null
}

/** What a limits form is missing, in the words the fields show. */
function limitsProblems(
  meanValue: number | null,
  sdValue: number | null,
  countValue: number | null,
): LimitsProblems {
  const meanError =
    meanValue === null ? t('quality.runQc.limitsDialog.meanRequired') : null

  const sdError =
    sdValue === null || sdValue <= 0
      ? t('quality.runQc.limitsDialog.sdRequired')
      : null

  const countError =
    countValue === null || countValue < 5 || countValue > 1000
      ? t('quality.runQc.limitsDialog.countRequired')
      : null

  return { meanError, sdError, countError }
}

/** The fields the chosen mode asks for: entered limits, or the first count. */
function LimitsFields({
  mode,
  values,
  errors,
  onChange,
}: {
  mode: 'enter' | 'first'
  values: { mean: string; sd: string; count: string }
  errors: { mean: string | null; sd: string | null; count: string | null }
  onChange: {
    setMean: (value: string) => void
    setSd: (value: string) => void
    setCount: (value: string) => void
  }
}) {
  if (mode === 'first') {
    return (
      <Field
        label={t('quality.runQc.limitsDialog.firstCount')}
        error={errors.count}
      >
        <Input
          inputMode="numeric"
          value={values.count}
          onChange={(event) => onChange.setCount(event.target.value)}
        />
      </Field>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('quality.runQc.limitsDialog.mean')} error={errors.mean}>
        <Input
          inputMode="decimal"
          value={values.mean}
          onChange={(event) => onChange.setMean(event.target.value)}
        />
      </Field>
      <Field
        label={t('quality.runQc.limitsDialog.sd')}
        hint={t('quality.runQc.limitsDialog.sdHint')}
        error={errors.sd}
      >
        <Input
          inputMode="decimal"
          value={values.sd}
          onChange={(event) => onChange.setSd(event.target.value)}
        />
      </Field>
    </div>
  )
}

function LimitsDialog({
  series,
  pointCount,
  onClose,
  onDone,
}: {
  series: QcSeriesRow
  pointCount: number
  onClose: () => void
  onDone: () => void
}) {
  const [mode, setMode] = useState<'enter' | 'first'>(
    pointCount >= 5 && series.mean === null ? 'first' : 'enter',
  )

  const [mean, setMean] = useState(
    series.mean === null ? '' : short(series.mean),
  )

  const [sd, setSd] = useState(series.sd === null ? '' : short(series.sd))

  const [count, setCount] = useState(
    String(Math.min(Math.max(pointCount, 5), 20)),
  )

  const [touched, setTouched] = useState(false)
  const meanValue = number(mean)
  const sdValue = number(sd)
  const countValue = number(count)

  const { meanError, sdError, countError } = limitsProblems(
    meanValue,
    sdValue,
    countValue,
  )

  const save = useMutation({
    mutationFn: () =>
      setQcBaseline(
        client,
        series.id,
        mode === 'first'
          ? { firstN: Math.round(countValue!) }
          : { mean: meanValue!, sd: sdValue! },
      ),
    onSuccess: () => {
      toast.success(t('quality.runQc.limitsDialog.saved'))
      onDone()
      onClose()
    },
    onError: (error) =>
      toast.error(
        `${t('quality.runQc.limitsDialog.couldNotSave')} ${qcMessage(error)}`,
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={t('quality.runQc.limitsDialog.title', { name: series.name })}
          description={t('quality.runQc.limitsDialog.body')}
        />
        <DialogBody>
          <RadioGroup
            value={mode}
            onValueChange={(next) =>
              setMode(next === 'first' ? 'first' : 'enter')
            }
          >
            <Choice
              value="enter"
              title={t('quality.runQc.limitsDialog.enter')}
            />
            <Choice value="first" title={t('quality.runQc.limitsDialog.first')}>
              {t('quality.runQc.limitsDialog.firstBody')}
            </Choice>
          </RadioGroup>
          <LimitsFields
            mode={mode}
            values={{ mean, sd, count }}
            errors={{
              mean: touched ? meanError : null,
              sd: touched ? sdError : null,
              count: touched ? countError : null,
            }}
            onChange={{ setMean, setSd, setCount }}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('quality.runQc.cancel')}
          </DialogClose>
          <Button
            disabled={save.isPending}
            onClick={() => {
              setTouched(true)

              if (mode === 'enter' ? meanError || sdError : countError) return
              save.mutate()
            }}
          >
            {save.isPending
              ? t('quality.runQc.limitsDialog.saving')
              : t('quality.runQc.limitsDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RulesDialog({
  series,
  onClose,
  onDone,
}: {
  series: QcSeriesRow
  onClose: () => void
  onDone: () => void
}) {
  const [rules, setRules] = useState<QcRule[]>(series.rules)

  const save = useMutation({
    mutationFn: () => updateQcSeries(client, series.id, { rules }),
    onSuccess: () => {
      toast.success(t('quality.runQc.rulesDialog.saved'))
      onDone()
      onClose()
    },
    onError: (error) =>
      toast.error(
        `${t('quality.runQc.rulesDialog.couldNotSave')} ${qcMessage(error)}`,
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={t('quality.runQc.rulesDialog.title', { name: series.name })}
          description={t('quality.runQc.rulesDialog.body')}
        />
        <DialogBody>
          {QC_RULES.map((rule) => (
            <label key={rule} className="flex items-start gap-2 text-body">
              <Checkbox
                checked={rules.includes(rule)}
                onCheckedChange={(checked) =>
                  setRules((current) =>
                    checked
                      ? QC_RULES.filter(
                          (r) => r === rule || current.includes(r),
                        )
                      : current.filter((r) => r !== rule),
                  )
                }
              />
              <span>
                <span className="mono mr-2 text-fg-muted">{rule}</span>
                {ruleLabel(rule)}
              </span>
            </label>
          ))}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('quality.runQc.cancel')}
          </DialogClose>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending
              ? t('quality.runQc.rulesDialog.saving')
              : t('quality.runQc.rulesDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ValueDialog({
  series,
  onClose,
  onDone,
}: {
  series: QcSeriesRow
  onClose: () => void
  onDone: () => void
}) {
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [touched, setTouched] = useState(false)
  const parsed = number(value)

  const error =
    parsed === null ? t('quality.runQc.valueDialog.valueRequired') : null

  const save = useMutation({
    mutationFn: () =>
      recordQcPoint(client, { seriesId: series.id, value: parsed!, label }),
    onSuccess: (point) => {
      toast.success(
        point.violations.length > 0
          ? `${t('quality.runQc.valueDialog.saved')} · ${point.violations.join(', ')}`
          : t('quality.runQc.valueDialog.saved'),
      )
      onDone()
      onClose()
    },
    onError: (err) =>
      toast.error(
        `${t('quality.runQc.valueDialog.couldNotSave')} ${qcMessage(err)}`,
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={t('quality.runQc.valueDialog.title', { name: series.name })}
        />
        <DialogBody>
          <Field
            label={
              series.unit
                ? `${t('quality.runQc.valueDialog.value')} (${series.unit})`
                : t('quality.runQc.valueDialog.value')
            }
            error={touched ? error : null}
          >
            <Input
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <Field
            label={t('quality.runQc.valueDialog.label')}
            hint={t('quality.runQc.valueDialog.labelHint')}
          >
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('quality.runQc.cancel')}
          </DialogClose>
          <Button
            disabled={save.isPending}
            onClick={() => {
              setTouched(true)

              if (error) return
              save.mutate()
            }}
          >
            {save.isPending
              ? t('quality.runQc.valueDialog.saving')
              : t('quality.runQc.valueDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AcknowledgeDialog({
  point,
  onClose,
  onDone,
}: {
  point: QcPointRow
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [exclude, setExclude] = useState(false)

  const save = useMutation({
    mutationFn: () =>
      acknowledgeQcPoint(client, { pointId: point.id, note, exclude }),
    onSuccess: () => {
      toast.success(t('quality.runQc.acknowledgeDialog.saved'))
      onDone()
      onClose()
    },
    onError: (error) =>
      toast.error(
        `${t('quality.runQc.acknowledgeDialog.couldNotSave')} ${qcMessage(error)}`,
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={t('quality.runQc.acknowledgeDialog.title')}
          description={t('quality.runQc.acknowledgeDialog.body')}
        />
        <DialogBody>
          <Field
            label={t('quality.runQc.acknowledgeDialog.note')}
            hint={t('quality.runQc.acknowledgeDialog.noteHint')}
          >
            <Textarea
              className="min-h-[70px]"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 text-body">
            <Checkbox
              checked={exclude}
              onCheckedChange={(checked) => setExclude(Boolean(checked))}
            />
            <span>
              {t('quality.runQc.acknowledgeDialog.exclude')}
              <span className="block text-label text-fg-muted">
                {t('quality.runQc.acknowledgeDialog.excludeHint')}
              </span>
            </span>
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('quality.runQc.cancel')}
          </DialogClose>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending
              ? t('quality.runQc.acknowledgeDialog.saving')
              : t('quality.runQc.acknowledgeDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StopDialog({
  series,
  onClose,
  onDone,
}: {
  series: QcSeriesRow
  onClose: () => void
  onDone: () => void
}) {
  const stop = useMutation({
    mutationFn: () => deleteQcSeries(client, series.id),
    onSuccess: () => {
      toast.success(t('quality.runQc.stopDialog.stopped'))
      onDone()
      onClose()
    },
    onError: (error) =>
      toast.error(
        `${t('quality.runQc.stopDialog.couldNotStop')} ${qcMessage(error)}`,
      ),
  })

  return (
    <ConfirmDialog open onOpenChange={(open) => !open && onClose()}>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t('quality.runQc.stopDialog.title', { name: series.name })}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t('quality.runQc.stopDialog.body')}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>{t('quality.runQc.cancel')}</ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            {stop.isPending
              ? t('quality.runQc.stopDialog.stopping')
              : t('quality.runQc.stopDialog.confirm')}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
