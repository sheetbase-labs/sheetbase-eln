/**
 * Compare one measure across two sources: two datasets, or a dataset and one of
 * its snapshots. Each side names its own value field, and rows are paired by a
 * rule the panel states in words (see `pairComparativeSources`); nothing is
 * matched by guessing at labels.
 *
 * Side A is the source the studio is already on. Side B is chosen here and read
 * the same way as any studio source, so a snapshot is the fixed rows it holds.
 */
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

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
  const nameB = `${sourceB?.name ?? 'Choose a dataset'}${snapshotB ? ' (snapshot)' : ''}`

  return (
    <section aria-label="Compare sources" className="mt-6 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-fg">
          Compare with another source
        </h3>
        <p className="text-xs text-fg-muted">
          Put one measure beside the same measure in another dataset, or in a
          snapshot of this one. A is the source above.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <label
            className="text-label text-fg-muted"
            htmlFor="source-b-dataset"
          >
            B dataset
          </label>
          <Select
            id="source-b-dataset"
            value={datasetB}
            onChange={(event) => {
              setDatasetB(event.target.value)
              setSnapshotB(LIVE)
            }}
          >
            {sources.map((s) => (
              <option key={s.datasetId} value={s.datasetId}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label
            className="text-label text-fg-muted"
            htmlFor="source-b-snapshot"
          >
            B rows
          </label>
          <Select
            id="source-b-snapshot"
            value={snapshotB}
            onChange={(event) => setSnapshotB(event.target.value)}
          >
            <option value={LIVE}>Live rows</option>
            {(versions.data ?? [])
              .filter((v) => !v.rowsRemovedAt)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  Snapshot {v.label} · {formatDate(v.createdAt)}
                </option>
              ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-label text-fg-muted" htmlFor="source-a-value">
            A measure
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
            B measure
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
            Match rows by
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
                A match field
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
                B match field
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
          Could not read source B: {String(rowsB.error)}
        </Notice>
      ) : null}
      {rowsB.isSuccess && resolvedB === null ? (
        <Notice tone="warn">Source B is no longer available.</Notice>
      ) : null}
      {resolvedB?.truncated ? (
        <Notice tone="warn">
          Source B has more rows than the studio reads at once; the comparison
          covers the first {resolvedB.rows.length}.
        </Notice>
      ) : null}
      {columnsA.length === 0 || (sourceB && columnsB.length === 0) ? (
        <Notice tone="info">
          Both sources need a numeric field to compare.
        </Notice>
      ) : null}

      {pairing ? (
        <>
          <Table aria-label="Source summary" data-density="compact">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Source</TableHead>
                <TableHead>n</TableHead>
                <TableHead>Min</TableHead>
                <TableHead>Mean</TableHead>
                <TableHead>Median</TableHead>
                <TableHead>Max</TableHead>
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
                <TableCell>Difference in means (B − A)</TableCell>
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
            {pairing.rule} {pairing.matchedCount} matched · {pairing.onlyACount}{' '}
            only in A · {pairing.onlyBCount} only in B · {pairing.changedCount}{' '}
            differ.
          </p>
          <Table aria-label="Paired rows" data-density="compact">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Key</TableHead>
                <TableHead>A</TableHead>
                <TableHead>B</TableHead>
                <TableHead>Δ (B − A)</TableHead>
                <TableHead>Present</TableHead>
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
                        ? 'A only'
                        : 'B only'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pairing.rows.length > MAX_PAIR_ROWS ? (
            <p className="text-xs text-fg-muted">
              Showing the first {MAX_PAIR_ROWS} of {pairing.rows.length} pairs.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
