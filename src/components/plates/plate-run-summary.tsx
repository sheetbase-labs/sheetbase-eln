/**
 * A plate run at a glance: how the plate did against its own controls, the
 * plate coloured by what the person wants to see, the samples that are hits and
 * the fitted potencies. The notebook block, the experiment's Data tab and the
 * plate run dialog's preview all show a run this way.
 */
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { Select } from '#/components/ui/select'
import { PlateMap } from '#/components/viz/plate-map'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import type {
  AssayWell,
  PlateAnalysis,
  PlateReadout,
  SampleCurve,
  SampleGroupResult,
} from '#/lib/plate-assay'
import type { PlateFormat } from '#/lib/plate-map'
import { plateRunReference } from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'
import { PLATE_RUN_BLOCK_VIEWS } from '#/lib/blocks/validators'

import { fmt, mapModel, qcTone, qualityLabel } from './plates-shared'
import type { MapView } from './plates-shared'

/** How many hits and potencies the summary lists before sending the reader to the run. */
const LISTED = 6

function isView(value: string): value is MapView {
  return PLATE_RUN_BLOCK_VIEWS.some((view) => view === value)
}

/** One headline number: what it is, its value and, when it has one, a verdict. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'ok' | 'warn' | 'bad'
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={hint}>
      <dt className="truncate text-label text-fg-muted">{label}</dt>
      <dd className="m-0 flex items-baseline gap-1.5">
        <span className="num font-heading text-[22px] font-semibold leading-none">
          {value || '—'}
        </span>
        {tone ? (
          <span
            aria-hidden="true"
            className={
              tone === 'ok'
                ? 'size-2 rounded-full bg-success'
                : tone === 'warn'
                  ? 'size-2 rounded-full bg-warning'
                  : 'size-2 rounded-full bg-danger'
            }
          />
        ) : null}
      </dd>
    </div>
  )
}

/** The four headline numbers of an analysed plate. */
export function PlateStats({ analysis }: { analysis: PlateAnalysis }) {
  const qc = analysis.qc

  const zTone =
    qc.zPrime === null
      ? undefined
      : qc.zPrime >= 0.5
        ? 'ok'
        : qc.zPrime >= 0
          ? 'warn'
          : 'bad'

  return (
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      <Stat
        label={t('plates.qc.zPrime')}
        value={fmt(qc.zPrime, 2)}
        hint={t('plates.qc.zPrimeHint')}
        tone={zTone}
      />
      <Stat
        label={t('plates.qc.signalToBackground')}
        value={fmt(qc.signalToBackground, 3)}
      />
      <Stat
        label={t('features.plateRuns.summary.hits')}
        value={t('features.plateRuns.summary.hitsOf', {
          hits: analysis.summary.hitSamples,
          tested: analysis.summary.testedSamples,
        })}
      />
      <Stat
        label={t('features.plateRuns.summary.readWells')}
        value={String(analysis.summary.readWells)}
      />
    </dl>
  )
}

/** The plate, coloured by one of four views, with the view picker above it. */
export function PlateMapPanel({
  format,
  wells,
  readout,
  analysis,
  view,
  onViewChange,
}: {
  format: PlateFormat
  wells: AssayWell[]
  readout: PlateReadout
  analysis: PlateAnalysis | null
  view: MapView
  onViewChange?: (view: MapView) => void
}) {
  const map = useMemo(
    () => mapModel(format, wells, readout, analysis, view),
    [format, wells, readout, analysis, view],
  )

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {onViewChange ? (
        <div className="flex items-center gap-2">
          <span className="text-label text-fg-muted">
            {t('plates.run.viewLabel')}
          </span>
          <Select
            size="sm"
            aria-label={t('plates.run.viewLabel')}
            value={view}
            onChange={(e) => {
              if (isView(e.target.value)) onViewChange(e.target.value)
            }}
          >
            {PLATE_RUN_BLOCK_VIEWS.map((option) => (
              <option key={option} value={option}>
                {t(`plates.run.views.${option}`)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="overflow-x-auto pb-1">
        <PlateMap
          wells={map.wells}
          rows={map.rows}
          cols={map.cols}
          bands={map.bands}
          roleLegend={map.legend}
          ariaLabel={t(`plates.formats.${format}`)}
          readOnly
          selectable
          compact={map.cols > 12}
        />
      </div>
    </div>
  )
}

function hitColumns(): RegistryColumn<SampleGroupResult>[] {
  return [
    {
      id: 'sample',
      header: t('plates.hits.sample'),
      cell: ({ row }) => (
        <span className="truncate font-medium">{row.original.label}</span>
      ),
    },
    {
      id: 'dose',
      header: t('plates.hits.dose'),
      size: 110,
      cell: ({ row }) => (
        <span className="num text-fg-muted">
          {row.original.concentration !== null
            ? `${fmt(row.original.concentration)} ${row.original.concentrationUnit ?? ''}`.trim()
            : ''}
        </span>
      ),
    },
    {
      id: 'mean',
      header: t('plates.hits.mean'),
      size: 90,
      cell: ({ row }) => <span className="num">{fmt(row.original.mean)}</span>,
    },
    {
      id: 'hit',
      header: t('plates.hits.hit'),
      size: 70,
      cell: ({ row }) =>
        row.original.hit ? (
          <Status tone="bad">{t('plates.hits.yes')}</Status>
        ) : null,
    },
  ]
}

function curveColumns(): RegistryColumn<SampleCurve>[] {
  return [
    {
      id: 'sample',
      header: t('plates.hits.sample'),
      cell: ({ row }) => (
        <span className="truncate font-medium">{row.original.label}</span>
      ),
    },
    {
      id: 'ec50',
      header: t('features.plateRuns.summary.potency'),
      size: 150,
      cell: ({ row }) => (
        <span className="num">
          {`${fmt(row.original.ec50)} ${row.original.concentrationUnit ?? ''}`.trim()}
        </span>
      ),
    },
    {
      id: 'r2',
      header: t('features.plateRuns.summary.rSquared'),
      size: 70,
      cell: ({ row }) => <span className="num">{fmt(row.original.r2, 3)}</span>,
    },
  ]
}

/** The samples that hit, most first, and the fitted potencies. */
export function PlateFindings({
  analysis,
  openHref,
}: {
  analysis: PlateAnalysis
  openHref?: { runId: string }
}) {
  const hits = useMemo(
    () => analysis.samples.filter((s) => s.hit),
    [analysis.samples],
  )

  const shown = hits.slice(0, LISTED)
  const curves = analysis.curves.slice(0, LISTED)
  const hitCols = useMemo(() => hitColumns(), [])
  const curveCols = useMemo(() => curveColumns(), [])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <h3 className="m-0 font-heading text-[14px] font-semibold">
          {t('features.plateRuns.summary.hitsTitle')}
        </h3>
        {shown.length > 0 ? (
          <TableBox>
            <RegistryGrid
              label={t('plates.hits.label')}
              rows={shown}
              columns={hitCols}
              getRowId={(sample) => sample.key}
              selectable={false}
            />
          </TableBox>
        ) : (
          <p className="m-0 text-label text-fg-muted">
            {t('features.plateRuns.summary.noHits')}
          </p>
        )}
      </div>
      {curves.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 font-heading text-[14px] font-semibold">
            {t('features.plateRuns.summary.curvesTitle')}
          </h3>
          <TableBox>
            <RegistryGrid
              label={t('plates.curves.label')}
              rows={curves}
              columns={curveCols}
              getRowId={(curve) => curve.key}
              selectable={false}
            />
          </TableBox>
        </div>
      ) : null}
      {hits.length > LISTED || analysis.curves.length > LISTED ? (
        <p className="m-0 text-label text-fg-muted">
          {openHref ? (
            <Link
              to="/plates"
              search={{ run: openHref.runId }}
              className="text-link underline-offset-2 hover:underline"
            >
              {t('features.plateRuns.summary.seeAll')}
            </Link>
          ) : (
            t('features.plateRuns.summary.seeAll')
          )}
        </p>
      ) : null}
    </div>
  )
}

/** A run's name line: reference, name, format, when it was read and its quality. */
export function PlateRunHeading({ run }: { run: PlateRunRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link
        to="/plates"
        search={{ run: run.id }}
        className="mono text-link underline-offset-2 hover:underline"
      >
        {plateRunReference(run.number)}
      </Link>
      <span className="min-w-0 truncate font-heading text-[15px] font-semibold">
        {run.name}
      </span>
      <span className="text-label text-fg-muted">
        {t(`plates.formats.${run.format}`)}
        {run.analysed_at
          ? ` · ${t('plates.run.analysedOn', { date: formatDate(run.analysed_at) })}`
          : ''}
      </span>
      <Status tone={qcTone(run.status === 'draft' ? null : run.qc_status)}>
        {qualityLabel(run)}
      </Status>
    </div>
  )
}

/**
 * Everything a run says, in one block: heading, headline numbers, the plate and
 * what it found. A run that has not been analysed shows the plate by its
 * readings and says so.
 */
export function PlateRunSummary({
  run,
  view,
  onViewChange,
}: {
  run: PlateRunRow
  view: MapView
  onViewChange?: (view: MapView) => void
}) {
  const analysis = run.results

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PlateRunHeading run={run} />
      {analysis ? <PlateStats analysis={analysis} /> : null}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <PlateMapPanel
          format={run.format}
          wells={run.wells}
          readout={run.readout}
          analysis={analysis}
          view={
            analysis
              ? view
              : view === 'hits' || view === 'normalised'
                ? 'raw'
                : view
          }
          onViewChange={analysis ? onViewChange : undefined}
        />
        {analysis ? (
          <PlateFindings analysis={analysis} openHref={{ runId: run.id }} />
        ) : (
          <p className="m-0 text-label text-fg-muted">
            {t('features.plateRuns.summary.notAnalysed')}
          </p>
        )}
      </div>
    </div>
  )
}
