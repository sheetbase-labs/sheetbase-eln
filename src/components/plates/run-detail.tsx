/**
 * One plate run: the plate coloured by what you want to see, how it did
 * against its own controls, which samples are hits, and the fitted curves.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
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
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { Tabs } from '#/components/ui/tabs'
import { PlateMap } from '#/components/viz/plate-map'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  HIT_DIRECTIONS,
  HIT_RULE_KINDS,
  NORMALISATIONS,
} from '#/lib/plate-assay'
import type {
  PlateAnalysis,
  PlateAssayConfig,
  SampleCurve,
  SampleGroupResult,
} from '#/lib/plate-assay'
import {
  analyseAndSavePlateRun,
  archivePlateRun,
  fetchPlateRun,
  messageOf,
  plateRunKeys,
  plateRunReference,
  updatePlateRun,
} from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'

import { DoseResponsePlot } from './dose-response-plot'
import { fmt, mapModel, qcTone, qualityLabel } from './plates-shared'
import type { MapModel, MapView } from './plates-shared'
import { WorklistBuilderDialog } from './worklist-dialogs'

const client = notebookDataClient

type DetailTab = 'hits' | 'curves' | 'qc'

/** The option a control reported, when it is one of the options it offers. */
function optionOf<Option extends string>(
  options: readonly Option[],
  value: string,
): Option | null {
  return options.find((option) => option === value) ?? null
}

const MAP_VIEWS: readonly MapView[] = ['normalised', 'raw', 'hits', 'roles']

const DETAIL_TABS: readonly DetailTab[] = ['hits', 'curves', 'qc']

const EFFECT_DIRECTIONS = ['inhibition', 'activation'] as const

const CURVE_MODELS = ['4pl', '5pl'] as const

export function RunDetail({
  runId,
  canWrite,
  onBack,
}: {
  runId: string
  canWrite: boolean
  onBack: () => void
}) {
  const queryClient = useQueryClient()

  const run = useQuery({
    queryKey: plateRunKeys.one(runId),
    queryFn: () => fetchPlateRun(client, runId),
    staleTime: 5_000,
  })

  const [view, setView] = useState<MapView>('normalised')
  const [tab, setTab] = useState<DetailTab>('hits')
  const [settings, setSettings] = useState(false)
  const [worklist, setWorklist] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [selectedCurve, setSelectedCurve] = useState<string | null>(null)
  const [onlyHits, setOnlyHits] = useState(false)

  const data = run.data ?? null
  const analysis = data?.results ?? null

  const map = useMemo(
    () =>
      data
        ? mapModel(data.format, data.wells, data.readout, analysis, view)
        : null,
    [data, analysis, view],
  )

  const analyse = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error(t('plates.run.notFound'))

      return analyseAndSavePlateRun(client, data)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      toast.success(t('plates.run.analysed'))
    },
    onError: (e) => toast.error(messageOf(e, t('plates.run.couldNotAnalyse'))),
  })

  const archive = useMutation({
    mutationFn: async () => {
      await archivePlateRun(client, runId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })

      if (data)
        toast.success(
          t('plates.run.archived', {
            reference: plateRunReference(data.number),
          }),
        )
      onBack()
    },
    onError: (e) => toast.error(messageOf(e, '')),
  })

  const curveColumns = useMemo(
    () => curveColumnsFor(data?.config.effectDirection),
    [data?.config.effectDirection],
  )

  if (run.isPending) {
    return <div className="p-6 text-fg-muted">…</div>
  }

  if (!data || !map) {
    return (
      <div className="p-6">
        <Notice tone="bad" title={t('plates.run.notFound')}>
          <Button variant="quiet" onClick={onBack}>
            {t('plates.back')}
          </Button>
        </Notice>
      </div>
    )
  }

  const samples = (analysis?.samples ?? []).filter((s) => !onlyHits || s.hit)
  const curves = analysis?.curves ?? []

  const curve: SampleCurve | undefined =
    curves.find((c) => c.key === selectedCurve) ?? curves.at(0)

  const reference = plateRunReference(data.number)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto max-md:pb-20">
      <RunHeader
        run={data}
        reference={reference}
        canWrite={canWrite}
        analysed={Boolean(analysis)}
        analysing={analyse.isPending}
        onBack={onBack}
        onSettings={() => setSettings(true)}
        onWorklist={() => setWorklist(true)}
        onAnalyse={() => analyse.mutate()}
        onArchive={() => setArchiving(true)}
      />
      <PlatePanel
        run={data}
        map={map}
        analysed={Boolean(analysis)}
        view={view}
        onChangeView={setView}
      />
      {analysis ? (
        <RunTabs
          run={data}
          analysis={analysis}
          tab={tab}
          onChangeTab={setTab}
          samples={samples}
          curves={curves}
          curve={curve}
          sampleColumns={SAMPLE_COLUMNS}
          curveColumns={curveColumns}
          onlyHits={onlyHits}
          onOnlyHitsChange={setOnlyHits}
          onSelectCurve={setSelectedCurve}
        />
      ) : null}

      <SettingsDialog run={data} open={settings} onOpenChange={setSettings} />
      <WorklistBuilderDialog
        run={data}
        open={worklist}
        onOpenChange={setWorklist}
      />
      <ArchiveDialog
        reference={reference}
        open={archiving}
        pending={archive.isPending}
        onOpenChange={setArchiving}
        onArchive={() => archive.mutate()}
      />
    </div>
  )
}

/** The sample rows of the hits tab; the numbers are formatted per column. */
function sampleColumnsFor(): RegistryColumn<SampleGroupResult>[] {
  return [
    {
      id: 'sample',
      header: t('plates.hits.sample'),
      cell: ({ row }) => (
        <span className="truncate font-medium text-fg">
          {row.original.label}
        </span>
      ),
    },
    {
      id: 'dose',
      header: t('plates.hits.dose'),
      size: 130,
      cell: ({ row }) => (
        <span className="num text-fg-muted">
          {row.original.concentration !== null
            ? `${fmt(row.original.concentration)} ${row.original.concentrationUnit ?? ''}`.trim()
            : ''}
        </span>
      ),
    },
    {
      id: 'wells',
      header: t('plates.hits.wells'),
      size: 80,
      cell: ({ row }) => <span className="num">{row.original.n}</span>,
    },
    {
      id: 'mean',
      header: t('plates.hits.mean'),
      size: 100,
      cell: ({ row }) => <span className="num">{fmt(row.original.mean)}</span>,
    },
    {
      id: 'sd',
      header: t('plates.hits.sd'),
      size: 100,
      cell: ({ row }) => (
        <span className="num text-fg-muted">{fmt(row.original.sd)}</span>
      ),
    },
    {
      id: 'cv',
      header: t('plates.hits.cv'),
      size: 90,
      cell: ({ row }) => (
        <span className="num text-fg-muted">
          {row.original.cv !== null ? `${fmt(row.original.cv, 2)}%` : ''}
        </span>
      ),
    },
    {
      id: 'hit',
      header: t('plates.hits.hit'),
      size: 90,
      cell: ({ row }) =>
        row.original.hit ? (
          <Status tone="bad">{t('plates.hits.yes')}</Status>
        ) : null,
    },
  ]
}

/** The fitted-curve rows; the potency column is named for the effect direction. */
function curveColumnsFor(
  effectDirection: PlateAssayConfig['effectDirection'] | undefined,
): RegistryColumn<SampleCurve>[] {
  return [
    {
      id: 'sample',
      header: t('plates.curves.sample'),
      cell: ({ row }) => (
        <span className="truncate font-medium text-fg">
          {row.original.label}
        </span>
      ),
    },
    {
      id: 'ec50',
      header: t(
        effectDirection === 'inhibition'
          ? 'plates.curves.ic50'
          : 'plates.curves.ec50',
      ),
      size: 150,
      cell: ({ row }) => (
        <span className="num">
          {fmt(row.original.ec50)} {row.original.concentrationUnit ?? ''}
        </span>
      ),
    },
    {
      id: 'interval',
      header: t('plates.curves.interval'),
      size: 170,
      cell: ({ row }) => (
        <span className="num text-fg-muted">
          {row.original.ec50Ci95
            ? `${fmt(row.original.ec50Ci95.lo)} – ${fmt(row.original.ec50Ci95.hi)}`
            : ''}
        </span>
      ),
    },
    {
      id: 'hill',
      header: t('plates.curves.hill'),
      size: 80,
      cell: ({ row }) => (
        <span className="num text-fg-muted">{fmt(row.original.hill, 2)}</span>
      ),
    },
    {
      id: 'r2',
      header: t('plates.curves.r2'),
      size: 80,
      cell: ({ row }) => (
        <span className="num text-fg-muted">{fmt(row.original.r2, 3)}</span>
      ),
    },
    {
      id: 'flags',
      header: t('plates.curves.flags'),
      cell: ({ row }) => (
        <span className="truncate text-warning-text">
          {row.original.flags
            .map((flag) => t(`plates.curves.flag.${flag}`))
            .join(', ')}
        </span>
      ),
    },
  ]
}

const SAMPLE_COLUMNS = sampleColumnsFor()

/** The run's title bar: what it is, its quality, and what can be done to it. */
function RunHeader({
  run,
  reference,
  canWrite,
  analysed,
  analysing,
  onBack,
  onSettings,
  onWorklist,
  onAnalyse,
  onArchive,
}: {
  run: PlateRunRow
  reference: string
  canWrite: boolean
  analysed: boolean
  analysing: boolean
  onBack: () => void
  onSettings: () => void
  onWorklist: () => void
  onAnalyse: () => void
  onArchive: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-6 py-3 max-md:px-4">
      <Button size="sm" variant="quiet" onClick={onBack}>
        {t('plates.back')}
      </Button>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate font-heading text-[17px] font-semibold">
          <span className="mono mr-2 text-fg-muted">{reference}</span>{' '}
          {run.name}
        </h1>
        <span className="text-label text-fg-muted">
          {t(`plates.formats.${run.format}`)} ·{' '}
          {t('plates.run.created', { date: formatDate(run.created_at) })}
          {run.analysed_at
            ? ` · ${t('plates.run.analysedOn', { date: formatDate(run.analysed_at) })}`
            : ''}
        </span>
      </div>
      <Status tone={qcTone(run.status === 'draft' ? null : run.qc_status)}>
        {qualityLabel(run)}
      </Status>
      {canWrite ? (
        <>
          <Button size="sm" onClick={onSettings}>
            {t('plates.run.settings')}
          </Button>
          <Button size="sm" onClick={onWorklist}>
            {t('plates.run.worklist')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={analysing}
            onClick={onAnalyse}
          >
            {analysed ? t('plates.run.reanalyse') : t('plates.run.analyse')}
          </Button>
          <Button size="sm" variant="quiet" onClick={onArchive}>
            {t('plates.run.archive')}
          </Button>
        </>
      ) : null}
    </div>
  )
}

/** The plate map, the view that colours it, and the quality card beside it. */
function PlatePanel({
  run,
  map,
  analysed,
  view,
  onChangeView,
}: {
  run: PlateRunRow
  map: MapModel
  analysed: boolean
  view: MapView
  onChangeView: (view: MapView) => void
}) {
  return (
    <div className="grid min-w-0 gap-6 px-6 py-4 max-md:px-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-label text-fg-muted">
            {t('plates.run.viewLabel')}
          </span>
          <Select
            size="sm"
            aria-label={t('plates.run.viewLabel')}
            value={view}
            onChange={(e) => {
              const next = optionOf(MAP_VIEWS, e.target.value)

              if (next) onChangeView(next)
            }}
          >
            {MAP_VIEWS.map((option) => (
              <option key={option} value={option}>
                {t(`plates.run.views.${option}`)}
              </option>
            ))}
          </Select>
        </div>
        {!analysed && view !== 'raw' && view !== 'roles' ? (
          <p className="text-label text-fg-muted">
            {t('plates.run.notAnalysed')}
          </p>
        ) : null}
        <div className="overflow-x-auto pb-1">
          <PlateMap
            wells={map.wells}
            rows={map.rows}
            cols={map.cols}
            bands={map.bands}
            roleLegend={map.legend}
            ariaLabel={t(`plates.formats.${run.format}`)}
            readOnly
            selectable
            compact={map.cols > 24}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {analysed ? (
          <QcCard run={run} />
        ) : (
          <p className="text-label text-fg-muted">
            {t('plates.run.notAnalysed')}
          </p>
        )}
      </div>
    </div>
  )
}

/** The analysed run's three tabs: hits, fitted curves and quality control. */
function RunTabs({
  run,
  analysis,
  tab,
  onChangeTab,
  samples,
  curves,
  curve,
  sampleColumns,
  curveColumns,
  onlyHits,
  onOnlyHitsChange,
  onSelectCurve,
}: {
  run: PlateRunRow
  analysis: PlateAnalysis
  tab: DetailTab
  onChangeTab: (tab: DetailTab) => void
  samples: SampleGroupResult[]
  curves: SampleCurve[]
  curve: SampleCurve | undefined
  sampleColumns: RegistryColumn<SampleGroupResult>[]
  curveColumns: RegistryColumn<SampleCurve>[]
  onlyHits: boolean
  onOnlyHitsChange: (onlyHits: boolean) => void
  onSelectCurve: (key: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="border-y border-border-subtle px-6 max-md:px-4">
        <Tabs
          mode="state"
          variant="strip"
          label={t('plates.title')}
          value={tab}
          onValueChange={(value) => {
            const next = optionOf(DETAIL_TABS, value)

            if (next) onChangeTab(next)
          }}
          items={[
            {
              key: 'hits',
              label: t('plates.run.tabs.hits'),
              count: analysis.samples.length,
            },
            {
              key: 'curves',
              label: t('plates.run.tabs.curves'),
              count: curves.length,
            },
            { key: 'qc', label: t('plates.run.tabs.qc') },
          ]}
        />
      </div>
      {tab === 'hits' ? (
        <HitsTab
          analysis={analysis}
          samples={samples}
          columns={sampleColumns}
          onlyHits={onlyHits}
          onOnlyHitsChange={onOnlyHitsChange}
        />
      ) : tab === 'curves' ? (
        <CurvesTab
          analysis={analysis}
          curves={curves}
          curve={curve}
          columns={curveColumns}
          onSelectCurve={onSelectCurve}
        />
      ) : (
        <div className="px-6 py-3 max-md:px-4">
          <QcCard run={run} />
        </div>
      )}
    </div>
  )
}

/** Every tested sample, with the control that narrows the list to the hits. */
function HitsTab({
  analysis,
  samples,
  columns,
  onlyHits,
  onOnlyHitsChange,
}: {
  analysis: PlateAnalysis
  samples: SampleGroupResult[]
  columns: RegistryColumn<SampleGroupResult>[]
  onlyHits: boolean
  onOnlyHitsChange: (onlyHits: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex items-center gap-3 px-6 text-label text-fg-muted max-md:px-4">
        <span className="flex-1">
          {t('plates.hits.summary', {
            hits: analysis.summary.hitSamples,
            tested: analysis.summary.testedSamples,
          })}
        </span>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={onlyHits}
            onCheckedChange={(checked) => onOnlyHitsChange(checked === true)}
          />
          {t('plates.hits.onlyHits')}
        </label>
      </div>
      {samples.length > 0 ? (
        <RegistryGrid
          label={t('plates.hits.label')}
          rows={samples}
          columns={columns}
          getRowId={(sample) => sample.key}
        />
      ) : (
        <EmptyState
          className="items-center py-10 text-center"
          icon="flask"
          title={t('plates.hits.empty')}
        />
      )}
    </div>
  )
}

/** The fitted dose-response curves, and the samples that could not be fitted. */
function CurvesTab({
  analysis,
  curves,
  curve,
  columns,
  onSelectCurve,
}: {
  analysis: PlateAnalysis
  curves: SampleCurve[]
  curve: SampleCurve | undefined
  columns: RegistryColumn<SampleCurve>[]
  onSelectCurve: (key: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 py-3">
      {curve ? (
        <div className="px-6 max-md:px-4">
          <DoseResponsePlot curve={curve} />
        </div>
      ) : (
        <EmptyState
          className="items-center py-10 text-center"
          icon="chart"
          title={t('plates.curves.empty')}
        />
      )}
      {curves.length > 0 ? (
        <RegistryGrid
          label={t('plates.curves.label')}
          rows={curves}
          columns={columns}
          getRowId={(sample) => sample.key}
          selectable
          onRowClick={(sample) => onSelectCurve(sample.key)}
        />
      ) : null}
      {analysis.unfitted.length > 0 ? (
        <ul className="px-6 text-label text-fg-muted max-md:px-4">
          {analysis.unfitted.map((unfitted) => (
            <li key={unfitted.key}>
              {unfitted.reason === 'too_few_doses'
                ? t('plates.curves.tooFew', { label: unfitted.label })
                : t('plates.curves.fitFailed', { label: unfitted.label })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Confirmation before a run is archived; archiving keeps every result. */
function ArchiveDialog({
  reference,
  open,
  pending,
  onOpenChange,
  onArchive,
}: {
  reference: string
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onArchive: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title={t('plates.run.archiveTitle', { reference })} />
        <DialogBody>
          <p className="text-body text-fg-muted">
            {t('plates.run.archiveBody')}
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button variant="danger" disabled={pending} onClick={onArchive}>
            {t('plates.run.archive')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function QcCard({ run }: { run: PlateRunRow }) {
  const a = run.results

  if (!a) return null
  const qc = a.qc

  const rows: Array<[string, typeof qc.positive]> = [
    [t('plates.qc.positive'), qc.positive],
    [t('plates.qc.negative'), qc.negative],
    [t('plates.qc.blank'), qc.blank],
  ]

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-heading text-[15px] font-semibold">
          {t('plates.qc.title')}
        </h2>
        <Status tone={qcTone(qc.status)}>
          {t(`plates.qc.status.${qc.status}`)}
        </Status>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-label sm:grid-cols-4">
        <Metric
          label={t('plates.qc.zPrime')}
          value={fmt(qc.zPrime, 3)}
          title={t('plates.qc.zPrimeHint')}
        />
        <Metric
          label={t('plates.qc.ssmd')}
          value={fmt(qc.ssmd === null ? null : Math.abs(qc.ssmd), 3)}
        />
        <Metric
          label={t('plates.qc.signalToBackground')}
          value={fmt(qc.signalToBackground, 3)}
        />
        <Metric
          label={t('plates.qc.signalToNoise')}
          value={fmt(qc.signalToNoise, 3)}
        />
      </dl>
      <table className="w-full text-label">
        <thead>
          <tr className="text-left text-fg-muted">
            <th className="py-1 font-medium" />
            <th className="py-1 text-right font-medium">
              {t('plates.qc.wells')}
            </th>
            <th className="py-1 text-right font-medium">
              {t('plates.qc.mean')}
            </th>
            <th className="py-1 text-right font-medium">{t('plates.qc.sd')}</th>
            <th className="py-1 text-right font-medium">{t('plates.qc.cv')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, s]) => (
            <tr key={name} className="border-t border-border-subtle">
              <td className="py-1">{name}</td>
              <td className="num py-1 text-right">{s.n}</td>
              <td className="num py-1 text-right">{fmt(s.mean)}</td>
              <td className="num py-1 text-right">{fmt(s.sd)}</td>
              <td className="num py-1 text-right">
                {s.cv !== null ? `${fmt(s.cv, 2)}%` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {qc.checks.length > 0 ? (
        <ul className="flex flex-col gap-1 text-label">
          {qc.checks.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <Status tone={qcTone(c.status)}>
                {t(`plates.qc.status.${c.status}`)}
              </Status>
              <span className="text-fg-muted">
                {t(`plates.qc.checks.${c.id}`, { limit: fmt(c.limit) })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-label text-fg-muted">{t('plates.qc.noControls')}</p>
      )}
      <div className="flex flex-col gap-0.5 text-label">
        <span className="font-medium">{t('plates.qc.edgeTitle')}</span>
        <span className="text-fg-muted">
          {a.edge.differencePct === null
            ? t('plates.qc.edgeUnknown')
            : a.edge.flagged
              ? t('plates.qc.edgeFlagged', {
                  pct: fmt(Math.abs(a.edge.differencePct), 2),
                })
              : t('plates.qc.edgeNone')}
        </span>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div className="flex flex-col" title={title}>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="num font-heading text-[18px] font-semibold">
        {value || '—'}
      </dd>
    </div>
  )
}

function numberOrNull(text: string): number | null {
  const n = Number(text)

  return text.trim() === '' || !Number.isFinite(n) ? null : n
}

function SettingsDialog({
  run,
  open,
  onOpenChange,
}: {
  run: PlateRunRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<PlateAssayConfig>(run.config)
  const [sb, setSb] = useState('')
  const [cv, setCv] = useState('')
  const [lastOpen, setLastOpen] = useState(false)

  if (open && !lastOpen) {
    setLastOpen(true)
    setConfig(run.config)
    setSb(run.config.qc.signalToBackgroundMin?.toString() ?? '')
    setCv(run.config.qc.controlCvMax?.toString() ?? '')
  } else if (!open && lastOpen) {
    setLastOpen(false)
  }

  const save = useMutation({
    mutationFn: async () => {
      const next: PlateAssayConfig = {
        ...config,
        qc: {
          ...config.qc,
          signalToBackgroundMin: numberOrNull(sb),
          controlCvMax: numberOrNull(cv),
        },
      }

      const updated = await updatePlateRun(
        client,
        run.id,
        { config: next },
        run.metadata_version,
      )

      return analyseAndSavePlateRun(client, updated)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      toast.success(t('plates.run.saved'))
      onOpenChange(false)
    },
    onError: (e) => toast.error(messageOf(e, t('plates.run.couldNotAnalyse'))),
  })

  const setHit = (patch: Partial<PlateAssayConfig['hit']>) =>
    setConfig((c) => ({ ...c, hit: { ...c.hit, ...patch } }))

  const setQc = (patch: Partial<PlateAssayConfig['qc']>) =>
    setConfig((c) => ({ ...c, qc: { ...c.qc, ...patch } }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(680px,calc(100vw-32px))]">
        <DialogHeader title={t('plates.settings.title')} />
        <DialogBody>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={t('plates.settings.normalisation')}>
              <Select
                value={config.normalisation}
                onChange={(e) => {
                  const next = optionOf(NORMALISATIONS, e.target.value)

                  if (next) setConfig({ ...config, normalisation: next })
                }}
              >
                {NORMALISATIONS.map((n) => (
                  <option key={n} value={n}>
                    {t(`plates.settings.normalisations.${n}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('plates.settings.effect')}>
              <Select
                value={config.effectDirection}
                onChange={(e) => {
                  const next = optionOf(EFFECT_DIRECTIONS, e.target.value)

                  if (next) setConfig({ ...config, effectDirection: next })
                }}
              >
                <option value="inhibition">
                  {t('plates.settings.effects.inhibition')}
                </option>
                <option value="activation">
                  {t('plates.settings.effects.activation')}
                </option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-label md:col-span-2">
              <Checkbox
                checked={config.subtractBlank}
                onCheckedChange={(v) =>
                  setConfig({ ...config, subtractBlank: v === true })
                }
              />
              {t('plates.settings.subtractBlank')}
            </label>
            <Field
              label={t('plates.settings.hitRule')}
              className="md:col-span-2"
            >
              <Select
                value={config.hit.kind}
                onChange={(e) => {
                  const next = optionOf(HIT_RULE_KINDS, e.target.value)

                  if (next) setHit({ kind: next })
                }}
              >
                {HIT_RULE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`plates.settings.hitKinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('plates.settings.threshold')}
              hint={t('plates.settings.thresholdHint')}
            >
              <Input
                inputMode="decimal"
                value={String(config.hit.threshold)}
                onChange={(e) => {
                  const n = numberOrNull(e.target.value)

                  if (n !== null) setHit({ threshold: n })
                }}
              />
            </Field>
            <Field label={t('plates.settings.direction')}>
              <Select
                value={config.hit.direction}
                onChange={(e) => {
                  const next = optionOf(HIT_DIRECTIONS, e.target.value)

                  if (next) setHit({ direction: next })
                }}
              >
                {HIT_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(`plates.settings.directions.${d}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('plates.settings.minReplicates')}>
              <Select
                value={String(config.hit.minReplicates)}
                onChange={(e) =>
                  setHit({
                    minReplicates:
                      e.target.value === 'all' ? 'all' : Number(e.target.value),
                  })
                }
              >
                <option value="all">
                  {t('plates.settings.allReplicates')}
                </option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('plates.settings.curveModel')}>
              <Select
                value={config.curveModel}
                onChange={(e) => {
                  const next = optionOf(CURVE_MODELS, e.target.value)

                  if (next) setConfig({ ...config, curveModel: next })
                }}
              >
                <option value="4pl">
                  {t('plates.settings.curveModels.4pl')}
                </option>
                <option value="5pl">
                  {t('plates.settings.curveModels.5pl')}
                </option>
              </Select>
            </Field>
            <h3 className="font-medium md:col-span-2">
              {t('plates.settings.qcLimits')}
            </h3>
            <Field label={t('plates.settings.zPrimeMin')}>
              <Input
                inputMode="decimal"
                value={String(config.qc.zPrimeMin)}
                onChange={(e) => {
                  const n = numberOrNull(e.target.value)

                  if (n !== null) setQc({ zPrimeMin: n })
                }}
              />
            </Field>
            <Field label={t('plates.settings.zPrimeFail')}>
              <Input
                inputMode="decimal"
                value={String(config.qc.zPrimeFail)}
                onChange={(e) => {
                  const n = numberOrNull(e.target.value)

                  if (n !== null) setQc({ zPrimeFail: n })
                }}
              />
            </Field>
            <Field
              label={t('plates.settings.sbMin')}
              hint={t('plates.settings.optional')}
            >
              <Input
                inputMode="decimal"
                value={sb}
                onChange={(e) => setSb(e.target.value)}
              />
            </Field>
            <Field
              label={t('plates.settings.cvMax')}
              hint={t('plates.settings.optional')}
            >
              <Input
                inputMode="decimal"
                value={cv}
                onChange={(e) => setCv(e.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('plates.settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
