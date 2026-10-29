/**
 * Compare one measure across two sources: two datasets, or a dataset and one of
 * its snapshots. Each side names its own value field, and rows are paired by a
 * rule the panel states in words (see `pairComparativeSources`); nothing is
 * matched by guessing at labels.
 *
 * Side A is the source the studio is already on. Side B is chosen here and read
 * the same way as any studio source, so a snapshot is the fixed rows it holds.
 */
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { datasetOption } from '#/components/v3/record-picker/entity-options'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { Notice } from '#/components/v3/ui/alert'
import { Select } from '#/components/v3/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { resolveDatasetRef, sciDataClient } from '#/lib/chart-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import {
  COMPARATIVE_MATCH_MODE_LABELS,
  pairComparativeSources,
  summarizeValues,
  toComparableNumber,
} from '#/lib/comparative-view'
import type { ComparativeMatchMode } from '#/lib/comparative-view'
import { listDatasetVersionSummaries } from '#/lib/dataset-explorer-data'
import { formatDate } from '#/lib/format-date'

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

export interface SourceComparisonProps {
  /** Side A: the studio's current source, its rows and the snapshot it reads. */
  sourceA: CanonicalDatasetSource
  rowsA: Record<string, unknown>[]
  snapshotA: string | null
  /** Every dataset side B can come from. */
  sources: CanonicalDatasetSource[]
}

export function SourceComparison({
  sourceA,
  rowsA,
  snapshotA,
  sources,
}: SourceComparisonProps) {
  const [datasetB, setDatasetB] = React.useState(sourceA.datasetId)
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
    queryFn: () => listDatasetVersionSummaries(sciDataClient, datasetB),
    staleTime: 30_000,
  })
  const rowsB = useQuery({
    queryKey: ['source-comparison-rows', datasetB, snapshotB],
    queryFn: () =>
      resolveDatasetRef(sciDataClient, {
        datasetId: datasetB,
        ...(snapshotB ? { datasetVersionId: snapshotB } : {}),
      }),
  })

  const columnsA = numericColumns(sourceA)
  const columnsB = numericColumns(sourceB)
  const valueFieldA = columnsA.some((c) => c.id === valueA)
    ? valueA
    : (columnsA[0]?.id ?? '')
  const valueFieldB = columnsB.some((c) => c.id === valueB)
    ? valueB
    : (columnsB[0]?.id ?? '')
  // Row keys are only shared within one dataset's lineage.
  const effectiveMatch: ComparativeMatchMode =
    !sameDataset && matchBy === 'row_key' ? 'field' : matchBy
  const matchFieldA = sourceA.columns.some((c) => c.id === matchA)
    ? matchA
    : (sourceA.columns[0]?.id ?? '')
  const matchFieldB = (sourceB?.columns ?? []).some((c) => c.id === matchB)
    ? matchB
    : (sourceB?.columns[0]?.id ?? '')
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

  const statsOf = (rows: Record<string, unknown>[], field: string) =>
    summarizeValues(
      rows
        .map((row) => toComparableNumber(row[field]))
        .filter((v): v is number => v !== null),
    )
  const statsA = valueFieldA ? statsOf(rowsA, valueFieldA) : null
  const statsB =
    resolvedB && valueFieldB ? statsOf(resolvedB.rows, valueFieldB) : null

  const nameA = `${sourceA.name}${snapshotA ? ' (snapshot)' : ''}`
  const nameB = `${sourceB?.name ?? t('data.sourceComparison.chooseDataset')}${snapshotB ? ' (snapshot)' : ''}`

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
        <div className="space-y-1">
          <label className="text-label text-fg-muted" htmlFor="source-match">
            {t('data.sourceComparison.matchRows')}
          </label>
          <Select
            id="source-match"
            value={effectiveMatch}
            onChange={(event) =>
              setMatchBy(event.target.value as ComparativeMatchMode)
            }
          >
            {(['row_key', 'field', 'position'] as const)
              .filter((mode) => mode !== 'row_key' || sameDataset)
              .map((mode) => (
                <option key={mode} value={mode}>
                  {COMPARATIVE_MATCH_MODE_LABELS[mode]}
                </option>
              ))}
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
      </div>

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
          <Table
            aria-label={t('data.sourceComparison.ariaSourceSummary')}
            data-density="compact"
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('data.sourceComparison.source')}</TableHead>
                <TableHead>n</TableHead>
                <TableHead>{t('data.sourceComparison.min')}</TableHead>
                <TableHead>{t('data.sourceComparison.mean')}</TableHead>
                <TableHead>{t('data.sourceComparison.median')}</TableHead>
                <TableHead>{t('data.sourceComparison.max')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(
                [
                  ['A', nameA, statsA],
                  ['B', nameB, statsB],
                ] as const
              ).map(([side, name, stats]) => (
                <TableRow key={side}>
                  <TableCell>
                    {side} · {name}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {stats?.n ?? 0}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {format(stats?.min)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {format(stats?.mean)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {format(stats?.median)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {format(stats?.max)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  {t('data.sourceComparison.differenceMeansB')}
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="font-mono tabular-nums">
                  {statsA && statsB ? format(statsB.mean - statsA.mean) : '—'}
                </TableCell>
                <TableCell />
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-xs text-fg-muted">
            {t('data.sourceComparison.matchedOnlyOnlyB', {
              rule: pairing.rule,
              matchedCount: pairing.matchedCount,
              onlyACount: pairing.onlyACount,
              onlyBCount: pairing.onlyBCount,
              changedCount: pairing.changedCount,
            })}
          </p>
          <Table
            aria-label={t('data.sourceComparison.ariaPairedRows')}
            data-density="compact"
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('data.sourceComparison.key')}</TableHead>
                <TableHead>{t('data.sourceComparison.sideA')}</TableHead>
                <TableHead>{t('data.sourceComparison.sideB')}</TableHead>
                <TableHead>
                  {t('data.sourceComparison.differenceHeader')}
                </TableHead>
                <TableHead>{t('data.sourceComparison.present')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairing.rows.slice(0, MAX_PAIR_ROWS).map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {format(row.aValue)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {format(row.bValue)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {format(row.delta)}
                  </TableCell>
                  <TableCell>
                    {row.presence === 'both'
                      ? 'both'
                      : row.presence === 'a-only'
                        ? t('data.sourceComparison.aOnly')
                        : t('data.sourceComparison.bOnly')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pairing.rows.length > MAX_PAIR_ROWS ? (
            <p className="text-xs text-fg-muted">
              {t('data.sourceComparison.showingFirstPairs', {
                MAX_PAIR_ROWS,
                length: pairing.rows.length,
              })}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
