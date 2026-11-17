/**
 * A plate read by its standard curve: what each sample came to, and the curve
 * it was read off. The answer is a concentration per sample, not a hit.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { ObjectLink } from '#/components/ui/object-link'
import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import { t } from '#/copy'
import { formatQuantity } from '#/lib/format-quantity'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  messageOf,
  plateRunKeys,
  publishPlateRunMeasurements,
} from '#/lib/plate-runs'
import type {
  QuantifiedSample,
  QuantifyResult,
  StandardPoint,
} from '#/lib/plate-quantify'

import { fmt } from './plates-shared'
import { StandardCurvePlot } from './standard-curve-plot'

function resultColumns(
  unit: string | null,
): RegistryColumn<QuantifiedSample>[] {
  return [
    {
      id: 'sample',
      header: t('features.plateRuns.quantify.sample'),
      cell: ({ row }) =>
        row.original.sampleId ? (
          <ObjectLink
            kind="sample"
            id={row.original.sampleId}
            mono={false}
            className="truncate font-medium"
          >
            {row.original.label}
          </ObjectLink>
        ) : (
          <span className="truncate font-medium text-fg">
            {row.original.label}
          </span>
        ),
    },
    {
      id: 'result',
      header: t('features.plateRuns.quantify.result'),
      size: 200,
      cell: ({ row }) =>
        row.original.result !== null ? (
          <span className="num font-medium text-fg">
            {formatQuantity(row.original.result)}
            {unit ? ` ${unit}` : ''}
          </span>
        ) : (
          <Status tone="warn">
            {t(`features.plateRuns.quantify.status.${row.original.status}`)}
          </Status>
        ),
    },
    {
      id: 'reading',
      header: t('features.plateRuns.quantify.reading'),
      size: 100,
      cell: ({ row }) => (
        <span className="num text-fg-muted">{fmt(row.original.response)}</span>
      ),
    },
    {
      id: 'dilution',
      header: t('features.plateRuns.quantify.dilution'),
      size: 90,
      cell: ({ row }) => (
        <span className="num text-fg-muted">
          {row.original.dilution === 1 ? '' : `× ${row.original.dilution}`}
        </span>
      ),
    },
    {
      id: 'wells',
      header: t('features.plateRuns.quantify.wells'),
      size: 80,
      cell: ({ row }) => (
        <span className="num">
          {row.original.n}/{row.original.wells.length}
        </span>
      ),
    },
    {
      id: 'cv',
      header: t('features.plateRuns.quantify.cv'),
      size: 80,
      cell: ({ row }) => (
        <span className="num text-fg-muted">
          {row.original.cv !== null ? `${fmt(row.original.cv, 1)}%` : ''}
        </span>
      ),
    },
  ]
}

/** What each sample came to, in the assay's own unit. */
export function QuantifyResultsTab({
  result,
  action,
}: {
  result: QuantifyResult
  /** The way to give the results to the samples, when the person may. */
  action?: React.ReactNode
}) {
  const unlinked = result.samples.some((s) => s.sampleId === null)
  const partly = result.samples.some((s) => s.partlyOutOfRange)

  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex items-center gap-3 px-6 text-label text-fg-muted max-md:px-4">
        <span className="flex-1">
          {result.curve
            ? t('features.plateRuns.quantify.summary', {
                count: result.samples.filter((s) => s.result !== null).length,
                r2: fmt(result.curve.r2, 3),
              })
            : null}
        </span>
        {action}
      </div>
      {result.failure ? (
        <div className="px-6 max-md:px-4">
          <Notice tone="warn">
            {t(`features.plateRuns.quantify.failure.${result.failure}`)}
          </Notice>
        </div>
      ) : null}
      {result.samples.length > 0 ? (
        <RegistryGrid
          label={t('features.plateRuns.quantify.tabs.results')}
          rows={result.samples}
          columns={resultColumns(result.curve?.unit ?? null)}
          getRowId={(sample) => sample.key}
        />
      ) : null}
      {partly ? (
        <p className="m-0 px-6 text-label text-fg-muted max-md:px-4">
          {t('features.plateRuns.quantify.partlyOutOfRange')}
        </p>
      ) : null}
      {unlinked ? (
        <p className="m-0 px-6 text-label text-fg-muted max-md:px-4">
          {t('features.plateRuns.quantify.unlinked')}
        </p>
      ) : null}
    </div>
  )
}

const standardColumns: RegistryColumn<StandardPoint>[] = [
  {
    id: 'conc',
    header: t('features.plateRuns.quantify.standardConc'),
    cell: ({ row }) => (
      <span className="num">{formatQuantity(row.original.x)}</span>
    ),
  },
  {
    id: 'reading',
    header: t('features.plateRuns.quantify.standardReading'),
    size: 140,
    cell: ({ row }) => <span className="num">{fmt(row.original.y)}</span>,
  },
  {
    id: 'wells',
    header: t('features.plateRuns.quantify.standardWells'),
    size: 90,
    cell: ({ row }) => <span className="num">{row.original.n}</span>,
  },
]

/** The standard curve and the standards it was fitted to. */
export function StandardCurveTab({ result }: { result: QuantifyResult }) {
  const curve = result.curve

  return (
    <div className="flex flex-col gap-3 py-3">
      {curve ? (
        <>
          <div className="flex flex-col gap-1 px-6 max-md:px-4">
            <p className="m-0 text-label text-fg-muted">
              {t('features.plateRuns.quantify.curveTitle', {
                model: t(`plates.settings.curveModels.${curve.model}`),
              })}
              {' · R² '}
              {fmt(curve.r2, 3)}
            </p>
            <StandardCurvePlot result={result} />
          </div>
          <RegistryGrid
            label={t('features.plateRuns.quantify.standardsTable')}
            rows={curve.points}
            columns={standardColumns}
            getRowId={(point) => String(point.x)}
          />
        </>
      ) : result.failure ? (
        <div className="px-6 max-md:px-4">
          <Notice tone="warn">
            {t(`features.plateRuns.quantify.failure.${result.failure}`)}
          </Notice>
        </div>
      ) : null}
    </div>
  )
}

/** Give each sample its result as a measurement, so the sample's page shows it. */
export function PublishMeasurementsButton({ runId }: { runId: string }) {
  const queryClient = useQueryClient()

  const publish = useMutation({
    mutationFn: () => publishPlateRunMeasurements(notebookDataClient, runId),
    onSuccess: ({ published, skipped }) => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      toast.success(
        skipped > 0
          ? t('features.plateRuns.quantify.publishedSome', {
              count: published,
              skipped,
            })
          : t('features.plateRuns.quantify.published', { count: published }),
      )
    },
    onError: (error) =>
      toast.error(
        messageOf(error, t('features.plateRuns.quantify.couldNotPublish')),
      ),
  })

  return (
    <Button
      size="sm"
      variant="primary"
      disabled={publish.isPending}
      title={t('features.plateRuns.quantify.publishHint')}
      onClick={() => publish.mutate()}
    >
      {t('features.plateRuns.quantify.publish')}
    </Button>
  )
}
