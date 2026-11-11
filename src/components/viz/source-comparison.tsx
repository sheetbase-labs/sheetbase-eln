/**
 * Compare one measure across two sources: two datasets, or a dataset and one of
 * its snapshots. Each side names its own value field, and rows are paired by a
 * rule the panel states in words (see `pairComparativeSources`); nothing is
 * matched by guessing at labels.
 *
 * Side A is the source the studio is already on. Side B is chosen here and read
 * the same way as any studio source, so a snapshot is the fixed rows it holds.
 */
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { datasetOption } from '#/components/record-picker/entity-options'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { Notice } from '#/components/ui/alert'
import { Select } from '#/components/ui/select'
import { StatGrid } from '#/components/viz/stat-grid'
import { resolveDatasetRef, sciDataClient } from '#/lib/chart-data'
import type { CanonicalDatasetSource, ResolvedDataset } from '#/lib/chart-data'
import {
  COMPARATIVE_MATCH_MODE_LABELS,
  COMPARATIVE_MATCH_MODES,
  pairComparativeSources,
  summarizeValues,
  toComparableNumber,
} from '#/lib/comparative-view'
import type { ComparativeMatchMode } from '#/lib/comparative-view'
import { listDatasetVersionSummaries } from '#/lib/dataset-explorer-data'
import { formatDate } from '#/lib/format-date'
import type { DataClient } from '#/lib/data-client'

const LIVE = ''
const MAX_PAIR_ROWS = 50

function numericColumns(source: CanonicalDatasetSource | undefined) {
  return (source?.columns ?? []).filter(
    (column) =>
      column.logicalType === 'decimal' || column.logicalType === 'integer',
  )
}

function format(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'

  return Number.isInteger(value) ? String(value) : value.toPrecision(5)
}

function selectedField(
  columns: CanonicalDatasetSource['columns'],
  value: string,
) {
  return columns.some((column) => column.id === value)
    ? value
    : (columns.at(0)?.id ?? '')
}

function statsOf(rows: ResolvedDataset['rows'], field: string) {
  return summarizeValues(
    rows.flatMap((row) => {
      const value = toComparableNumber(row[field])

      return value === null ? [] : [value]
    }),
  )
}

export interface SourceComparisonProps {
  /** Side A: the studio's current source, its rows and the snapshot it reads. */
  sourceA: CanonicalDatasetSource
  rowsA: ResolvedDataset['rows']
  snapshotA: string | null
  /** Every dataset side B can come from. */
  sources: CanonicalDatasetSource[]
  client?: DataClient
}

function useSourceComparison({
  sourceA,
  rowsA,
  snapshotA,
  sources,
  client = sciDataClient,
}: SourceComparisonProps) {
  const [datasetB, setDatasetB] = React.useState(() => sourceA.datasetId)
  const [snapshotB, setSnapshotB] = React.useState<string>(LIVE)
  const [valueA, setValueA] = React.useState('')
  const [valueB, setValueB] = React.useState('')
  const [matchBy, setMatchBy] = React.useState<ComparativeMatchMode>('row_key')
  const [matchA, setMatchA] = React.useState('')
  const [matchB, setMatchB] = React.useState('')

  const sameDataset = datasetB === sourceA.datasetId
  const sourceB = sources.find((s) => s.datasetId === datasetB)

  const versions = useQuery({
    queryKey: ['dataset-version-summaries', datasetB],
    queryFn: () => listDatasetVersionSummaries(client, datasetB),
    staleTime: 30_000,
  })

  const rowsB = useQuery({
    queryKey: ['source-comparison-rows', datasetB, snapshotB],
    queryFn: () =>
      resolveDatasetRef(
        client,
        snapshotB
          ? { datasetId: datasetB, datasetVersionId: snapshotB }
          : { datasetId: datasetB },
      ),
  })

  const columnsA = numericColumns(sourceA)
  const columnsB = numericColumns(sourceB)

  const valueFieldA = selectedField(columnsA, valueA)
  const valueFieldB = selectedField(columnsB, valueB)

  // Row keys are only shared within one dataset's lineage.
  const effectiveMatch: ComparativeMatchMode =
    !sameDataset && matchBy === 'row_key' ? 'field' : matchBy

  const matchFieldA = selectedField(sourceA.columns, matchA)
  const matchFieldB = selectedField(sourceB?.columns ?? [], matchB)

  const matchLabel =
    sourceA.columns.find((c) => c.id === matchFieldA)?.label ?? null

  const resolvedB = rowsB.data

  const pairing = React.useMemo(() => {
    if (!resolvedB || !valueFieldA || !valueFieldB) return null

    return pairComparativeSources(
      { rows: rowsA, valueField: valueFieldA, matchField: matchFieldA },
      {
        rows: resolvedB.rows,
        valueField: valueFieldB,
        matchField: matchFieldB,
      },
      effectiveMatch,
      matchLabel,
    )
  }, [
    resolvedB,
    rowsA,
    valueFieldA,
    valueFieldB,
    matchFieldA,
    matchFieldB,
    effectiveMatch,
    matchLabel,
  ])

  const statsA = valueFieldA ? statsOf(rowsA, valueFieldA) : null

  const statsB =
    resolvedB && valueFieldB ? statsOf(resolvedB.rows, valueFieldB) : null

  const nameA = `${sourceA.name}${snapshotA ? ' (snapshot)' : ''}`
  const nameB = `${sourceB?.name ?? t('data.sourceComparison.chooseDataset')}${snapshotB ? ' (snapshot)' : ''}`

  return {
    datasetB,
    setDatasetB,
    snapshotB,
    setSnapshotB,
    valueFieldA,
    setValueA,
    valueFieldB,
    setValueB,
    matchFieldA,
    setMatchA,
    matchFieldB,
    setMatchB,
    effectiveMatch,
    setMatchBy,
    sameDataset,
    sourceA,
    sourceB,
    sources,
    columnsA,
    columnsB,
    versions,
    rowsB,
    resolvedB,
    pairing,
    statsA,
    statsB,
    nameA,
    nameB,
  }
}

type SourceComparisonModel = ReturnType<typeof useSourceComparison>

export function SourceComparison(props: SourceComparisonProps) {
  const model = useSourceComparison(props)

  return (
    <section
      aria-label={t('data.sourceComparison.ariaCompareSources')}
      className="mt-6 space-y-3"
    >
      <div>
        <h3 className="text-sm font-medium text-fg">
          {t('data.sourceComparison.compareAnotherSource')}
        </h3>
        <p className="text-xs text-fg-muted">
          {t('data.sourceComparison.putOneMeasureBeside')}
        </p>
      </div>
      <SourceControls model={model} />
      <SourceResults model={model} />
    </section>
  )
}

function SourceControls({ model }: { model: SourceComparisonModel }) {
  const {
    datasetB,
    setDatasetB,
    snapshotB,
    setSnapshotB,
    sources,
    versions,
    valueFieldA,
    setValueA,
    valueFieldB,
    setValueB,
    columnsA,
    columnsB,
  } = model

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <label
            className="text-label text-fg-muted"
            htmlFor="source-b-dataset"
          >
            {t('data.sourceComparison.bDataset')}
          </label>
          <PickerSelect
            noun="dataset"
            id="source-b-dataset"
            value={datasetB}
            onChange={(id) => {
              setDatasetB(id)
              setSnapshotB(LIVE)
            }}
            options={sources.map((s) =>
              datasetOption({ id: s.datasetId, name: s.name }),
            )}
          />
        </div>
        <div className="space-y-1">
          <label
            className="text-label text-fg-muted"
            htmlFor="source-b-snapshot"
          >
            {t('data.sourceComparison.bRows')}
          </label>
          <Select
            id="source-b-snapshot"
            value={snapshotB}
            onChange={(event) => setSnapshotB(event.target.value)}
          >
            <option value={LIVE}>{t('data.sourceComparison.liveRows')}</option>
            {(versions.data ?? [])
              .filter((v) => !v.rowsRemovedAt)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {t('data.sourceComparison.snapshot', {
                    label: v.label,
                    value: formatDate(v.createdAt),
                  })}
                </option>
              ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-label text-fg-muted" htmlFor="source-a-value">
            {t('data.sourceComparison.aMeasure')}
          </label>
          <Select
            id="source-a-value"
            value={valueFieldA}
            onChange={(event) => setValueA(event.target.value)}
          >
            {columnsA.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-label text-fg-muted" htmlFor="source-b-value">
            {t('data.sourceComparison.bMeasure')}
          </label>
          <Select
            id="source-b-value"
            value={valueFieldB}
            onChange={(event) => setValueB(event.target.value)}
          >
            {columnsB.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <SourceMatching model={model} />
      </div>
    </>
  )
}

function SourceMatching({ model }: { model: SourceComparisonModel }) {
  const {
    effectiveMatch,
    setMatchBy,
    sameDataset,
    matchFieldA,
    setMatchA,
    matchFieldB,
    setMatchB,
    sourceA,
    sourceB,
  } = model

  return (
    <>
      <div className="space-y-1">
        <label className="text-label text-fg-muted" htmlFor="source-match">
          {t('data.sourceComparison.matchRows')}
        </label>
        <Select
          id="source-match"
          value={effectiveMatch}
          onChange={(event) => {
            const mode = COMPARATIVE_MATCH_MODES.find(
              (candidate) => candidate === event.target.value,
            )

            if (mode) setMatchBy(mode)
          }}
        >
          {COMPARATIVE_MATCH_MODES.flatMap((mode) =>
            mode === 'row_key' && !sameDataset
              ? []
              : [
                  <option key={mode} value={mode}>
                    {COMPARATIVE_MATCH_MODE_LABELS[mode]}
                  </option>,
                ],
          )}
        </Select>
      </div>
      {effectiveMatch === 'field' ? (
        <>
          <div className="space-y-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="source-a-match"
            >
              {t('data.sourceComparison.matchField')}
            </label>
            <Select
              id="source-a-match"
              value={matchFieldA}
              onChange={(event) => setMatchA(event.target.value)}
            >
              {sourceA.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="source-b-match"
            >
              {t('data.sourceComparison.bMatchField')}
            </label>
            <Select
              id="source-b-match"
              value={matchFieldB}
              onChange={(event) => setMatchB(event.target.value)}
            >
              {(sourceB?.columns ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        </>
      ) : null}
    </>
  )
}

function SourceResults({ model }: { model: SourceComparisonModel }) {
  const { rowsB, resolvedB, columnsA, columnsB, sourceB, pairing } = model

  return (
    <>
      {rowsB.error ? (
        <Notice tone="bad">
          {t('data.sourceComparison.couldReadSourceB', {
            value: String(rowsB.error),
          })}
        </Notice>
      ) : null}
      {rowsB.isSuccess && resolvedB === null ? (
        <Notice tone="warn">
          {t('data.sourceComparison.sourceBLongerAvailable')}
        </Notice>
      ) : null}
      {resolvedB?.truncated ? (
        <Notice tone="warn">
          {t('data.sourceComparison.sourceBHasMore', {
            length: resolvedB.rows.length,
          })}
        </Notice>
      ) : null}
      {columnsA.length === 0 || (sourceB && columnsB.length === 0) ? (
        <Notice tone="info">
          {t('data.sourceComparison.bothSourcesNeedNumeric')}
        </Notice>
      ) : null}

      {pairing ? (
        <>
          <SourceStatistics model={model} />
          <SourcePairs pairing={pairing} />
        </>
      ) : null}
    </>
  )
}

function SourceStatistics({ model }: { model: SourceComparisonModel }) {
  const { statsA, statsB, nameA, nameB } = model

  return (
    <StatGrid
      label={t('data.sourceComparison.ariaSourceSummary')}
      rows={[
        ...([
          ['A', nameA, statsA],
          ['B', nameB, statsB],
        ] as const).map(([side, name, stats]) => ({
          id: side,
          label: `${side} · ${name}`,
          n: stats ? String(stats.n) : '0',
          min: format(stats?.min),
          mean: format(stats?.mean),
          median: format(stats?.median),
          max: format(stats?.max),
        })),
        {
          id: 'difference',
          label: t('data.sourceComparison.differenceMeansB'),
          n: '',
          min: '',
          mean: statsA && statsB ? format(statsB.mean - statsA.mean) : '—',
          median: '',
          max: '',
        },
      ]}
      getRowId={(row) => row.id}
      columns={[
        {
          id: 'source',
          header: t('data.sourceComparison.source'),
          value: (row) => row.label,
          text: true,
        },
        { id: 'n', header: 'n', value: (row) => row.n },
        { id: 'min', header: t('data.sourceComparison.min'), value: (row) => row.min },
        { id: 'mean', header: t('data.sourceComparison.mean'), value: (row) => row.mean },
        {
          id: 'median',
          header: t('data.sourceComparison.median'),
          value: (row) => row.median,
        },
        { id: 'max', header: t('data.sourceComparison.max'), value: (row) => row.max },
      ]}
    />
  )
}

function SourcePairs({
  pairing,
}: {
  pairing: ReturnType<typeof pairComparativeSources>
}) {
  return (
    <>
      <p className="text-xs text-fg-muted">
        {t('data.sourceComparison.matchedOnlyOnlyB', {
          rule: pairing.rule,
          matchedCount: pairing.matchedCount,
          onlyACount: pairing.onlyACount,
          onlyBCount: pairing.onlyBCount,
          changedCount: pairing.changedCount,
        })}
      </p>
      <StatGrid
        label={t('data.sourceComparison.ariaPairedRows')}
        rows={pairing.rows.slice(0, MAX_PAIR_ROWS)}
        getRowId={(row) => row.key}
        maxHeight={420}
        columns={[
          {
            id: 'key',
            header: t('data.sourceComparison.key'),
            value: (row) => row.label,
            text: true,
          },
          {
            id: 'a',
            header: t('data.sourceComparison.sideA'),
            value: (row) => format(row.aValue),
            sortBy: (row) => row.aValue,
          },
          {
            id: 'b',
            header: t('data.sourceComparison.sideB'),
            value: (row) => format(row.bValue),
            sortBy: (row) => row.bValue,
          },
          {
            id: 'difference',
            header: t('data.sourceComparison.differenceHeader'),
            value: (row) => format(row.delta),
            sortBy: (row) => row.delta,
          },
          {
            id: 'present',
            header: t('data.sourceComparison.present'),
            value: (row) =>
              row.presence === 'both'
                ? 'both'
                : row.presence === 'a-only'
                  ? t('data.sourceComparison.aOnly')
                  : t('data.sourceComparison.bOnly'),
            text: true,
          },
        ]}
      />
      {pairing.rows.length > MAX_PAIR_ROWS ? (
        <p className="text-xs text-fg-muted">
          {t('data.sourceComparison.showingFirstPairs', {
            MAX_PAIR_ROWS,
            length: pairing.rows.length,
          })}
        </p>
      ) : null}
    </>
  )
}
