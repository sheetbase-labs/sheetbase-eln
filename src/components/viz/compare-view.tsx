/**
 * VIEW-03 — Compare inspection surface.
 *
 * Groups already-materialised canonical rows by explicit source fields for
 * time-series / replicate-distribution inspection, previews the grouping
 * through the existing chart renderer, and hands off into the canonical
 * ChartSpec path via `promoteToChartSpec`. No new graph engine: the preview
 * is a `ChartRenderer` over a promoted draft spec, and the promote action
 * delivers that spec to the caller (the Analysis Studio loads it into the
 * chart builder, where save/export/freeze already live).
 */
import * as React from 'react'

import { Button } from '#/components/v3/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { NativeSelect } from '#/components/v3/projects/select'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import {
  CHART_SPEC_VERSION,
  materialiseChart,
  formatScientific,
} from '#/lib/chart-spec'
import type { ChartColumn, ChartSpec } from '#/lib/chart-spec'
import { createRepresentationHandle } from '#/lib/representations'
import {
  COMPARATIVE_MATCH_MODES,
  COMPARATIVE_MATCH_MODE_LABELS,
  COMPARATIVE_VIEW_TYPES,
  describeComparativeMatchRule,
  pairComparativeSides,
  promoteToChartSpec,
  shapeComparativeView,
  swapComparativeSides,
  validateComparativeViewConfig,
} from '#/lib/comparative-view'
import type {
  ComparativeMatchMode,
  ComparativeSides,
  ComparativeViewConfig,
} from '#/lib/comparative-view'
import { ChartRenderer } from './chart-renderer'
import { RepresentationFrame } from './representation-frame'

export interface CompareViewProps {
  source: CanonicalDatasetSource
  columns: ChartColumn[]
  rows: Record<string, unknown>[]
  loading?: boolean
  error?: string | null
  config: ComparativeViewConfig
  onConfigChange: (next: ComparativeViewConfig) => void
  /** Hand-off: receives the promoted ChartSpec through the canonical path. */
  onPromote: (spec: ChartSpec) => void
}

const NUMERIC_TYPES = new Set(['decimal', 'integer'])

function columnOptions(columns: ChartColumn[], numericOnly: boolean) {
  return numericOnly
    ? columns.filter((c) => NUMERIC_TYPES.has(c.logicalType))
    : columns
}

export function CompareView({
  source,
  columns,
  rows,
  loading = false,
  error = null,
  config,
  onConfigChange,
  onPromote,
}: CompareViewProps) {
  const errors = validateComparativeViewConfig(config)
  const draft: ChartSpec | null =
    errors.length === 0 ? promoteToChartSpec(config, columns) : null
  const shaped = React.useMemo(
    () =>
      errors.length === 0
        ? shapeComparativeView(rows, config)
        : {
            groups: [],
            emptyGroupKeys: [],
            totalRows: rows.length,
            droppedNullValues: 0,
          },
    [rows, config, errors.length],
  )
  const materialised = React.useMemo(
    () => (draft ? materialiseChart(draft, columns, rows) : null),
    [draft, columns, rows],
  )
  const handle = React.useMemo(
    () =>
      draft
        ? createRepresentationHandle({
            source: {
              datasetId: config.datasetId,
              versionId: config.versionId,
            },
            config: {
              kind: 'chart',
              configVersion: CHART_SPEC_VERSION,
              config: draft,
            },
            title: 'Compare',
          })
        : null,
    [draft, config.datasetId, config.versionId],
  )

  const numericColumns = columnOptions(columns, true)
  const valueColumns = numericColumns.length > 0 ? numericColumns : columns

  // R5-STUDIO-03: the two compared sides are session state, never persisted —
  // the saved ComparativeViewConfig stays the inspection config it always was.
  const [sides, setSides] = React.useState<ComparativeSides>({
    a: null,
    b: null,
  })
  const [matchBy, setMatchBy] = React.useState<ComparativeMatchMode>('row_key')
  const [matchFieldId, setMatchFieldId] = React.useState<string | null>(null)

  const groupKeys = shaped.groups.map((group) => group.key)
  React.useEffect(() => {
    setSides((current) => {
      const next: ComparativeSides = {
        a:
          current.a && groupKeys.includes(current.a)
            ? current.a
            : (groupKeys[0] ?? null),
        b:
          current.b && groupKeys.includes(current.b)
            ? current.b
            : (groupKeys[1] ?? null),
      }
      return next.a === current.a && next.b === current.b ? current : next
    })
    // groupKeys is derived from shaped.groups; keying on its join means the
    // effect only runs when the available sides actually change.
  }, [groupKeys.join('\u0000')])

  React.useEffect(() => {
    setMatchFieldId((current) => {
      if (current && columns.some((column) => column.id === current)) {
        return current
      }
      const fallback =
        columns.find((column) => !config.groupBy.includes(column.id)) ??
        columns.at(0)
      return fallback ? fallback.id : null
    })
  }, [columns, config.groupBy.join('\u0000')])

  const matchFieldLabel =
    columns.find((column) => column.id === matchFieldId)?.label ?? matchFieldId
  const pairing = React.useMemo(
    () =>
      pairComparativeSides(
        rows,
        config,
        sides,
        matchBy,
        matchFieldId,
        matchFieldLabel,
      ),
    [rows, config, sides, matchBy, matchFieldId, matchFieldLabel],
  )
  // Frozen side labels: after a swap the sides (and therefore the Δ sign and
  // every presence flag) follow the new assignment; the labels come from the
  // group labels so a swapped table cannot mislabel its columns.
  const sideALabel =
    shaped.groups.find((group) => group.key === sides.a)?.label ??
    sides.a ??
    'not selected'
  const sideBLabel =
    shaped.groups.find((group) => group.key === sides.b)?.label ??
    sides.b ??
    'not selected'

  function toggleGroupField(fieldId: string) {
    const next = config.groupBy.includes(fieldId)
      ? config.groupBy.filter((f) => f !== fieldId)
      : [...config.groupBy, fieldId]
    onConfigChange({ ...config, groupBy: next })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <label
            className="text-label text-fg-muted"
            htmlFor="compare-view-type"
          >
            View type
          </label>
          <NativeSelect
            id="compare-view-type"
            value={config.viewType}
            onChange={(event) =>
              onConfigChange({
                ...config,
                viewType: event.target
                  .value as ComparativeViewConfig['viewType'],
              })
            }
          >
            {COMPARATIVE_VIEW_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === 'time_series'
                  ? 'Grouped time series'
                  : 'Distribution'}
              </option>
            ))}
          </NativeSelect>
        </div>
        {config.viewType === 'time_series' ? (
          <div className="space-y-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="compare-time-field"
            >
              Time field
            </label>
            <NativeSelect
              id="compare-time-field"
              value={config.timeField ?? ''}
              onChange={(event) =>
                onConfigChange({
                  ...config,
                  timeField: event.target.value || null,
                })
              }
            >
              <option value="">Select a field</option>
              {valueColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="space-y-1">
          <label
            className="text-label text-fg-muted"
            htmlFor="compare-value-field"
          >
            Value field
          </label>
          <NativeSelect
            id="compare-value-field"
            value={config.valueField}
            onChange={(event) =>
              onConfigChange({ ...config, valueField: event.target.value })
            }
          >
            {valueColumns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label
            className="text-label text-fg-muted"
            htmlFor="compare-facet-field"
          >
            Facet field
          </label>
          <NativeSelect
            id="compare-facet-field"
            value={config.facetBy ?? ''}
            onChange={(event) =>
              onConfigChange({
                ...config,
                facetBy: event.target.value || null,
              })
            }
          >
            <option value="">None</option>
            {columns
              .filter((column) => !config.groupBy.includes(column.id))
              .map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
          </NativeSelect>
        </div>
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-fg-muted">
          Group by (explicit source fields)
        </legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {columns.map((column) => (
            <label
              key={column.id}
              className="flex items-center gap-1.5 text-xs"
            >
              <input
                type="checkbox"
                aria-label={`Group by ${column.label}`}
                checked={config.groupBy.includes(column.id)}
                onChange={() => toggleGroupField(column.id)}
              />
              {column.label}
            </label>
          ))}
        </div>
      </fieldset>
      {errors.length > 0 ? (
        <p role="alert" className="text-xs text-danger-text">
          {errors.join('; ')}
        </p>
      ) : null}
      <fieldset
        className="rounded-md border border-border p-3"
        aria-labelledby="compare-ab-title"
      >
        <legend id="compare-ab-title" className="px-1 text-xs font-medium">
          A/B compare
        </legend>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="compare-side-a"
            >
              Side A
            </label>
            <NativeSelect
              id="compare-side-a"
              value={sides.a ?? ''}
              onChange={(event) =>
                setSides((current) => ({
                  ...current,
                  a: event.target.value || null,
                }))
              }
            >
              <option value="">Select a group</option>
              {shaped.groups.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="compare-side-b"
            >
              Side B
            </label>
            <NativeSelect
              id="compare-side-b"
              value={sides.b ?? ''}
              onChange={(event) =>
                setSides((current) => ({
                  ...current,
                  b: event.target.value || null,
                }))
              }
            >
              <option value="">Select a group</option>
              {shaped.groups.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="compare-match-by"
            >
              Match rows by
            </label>
            <NativeSelect
              id="compare-match-by"
              aria-label="Match rows by"
              value={matchBy}
              onChange={(event) =>
                setMatchBy(event.target.value as ComparativeMatchMode)
              }
            >
              {COMPARATIVE_MATCH_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {COMPARATIVE_MATCH_MODE_LABELS[mode]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {matchBy === 'field' ? (
          <div className="mt-2 max-w-xs space-y-1">
            <label
              className="text-label text-fg-muted"
              htmlFor="compare-match-field"
            >
              Match field
            </label>
            <NativeSelect
              id="compare-match-field"
              value={matchFieldId ?? ''}
              onChange={(event) => setMatchFieldId(event.target.value || null)}
            >
              <option value="">Select a field</option>
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="quiet"
            onClick={() => setSides((current) => swapComparativeSides(current))}
          >
            Swap A/B
          </Button>
          <span className="text-xs text-fg-muted" data-compare-match-rule>
            {describeComparativeMatchRule(matchBy, matchFieldLabel)}
          </span>
        </div>
      </fieldset>
      {handle && draft && materialised ? (
        <RepresentationFrame
          title="Compare"
          handle={handle}
          loading={loading}
          error={error}
          actions={
            <Button type="button" size="sm" onClick={() => onPromote(draft)}>
              Promote to chart/analysis
            </Button>
          }
        >
          <ChartRenderer
            title="Compare preview"
            hideTitle
            spec={draft}
            materialised={materialised}
            frozen={null}
            loading={loading}
            error={error}
            plotHeight={220}
            showTableAlternative={false}
          />
          <Table aria-label="Compare group summary" data-density="compact">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Group</TableHead>
                <TableHead>n</TableHead>
                <TableHead>Nulls</TableHead>
                <TableHead>Min</TableHead>
                <TableHead>Mean</TableHead>
                <TableHead>Median</TableHead>
                <TableHead>Max</TableHead>
                {config.facetBy ? <TableHead>Facet</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shaped.groups.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={config.facetBy ? 8 : 7}
                    className="text-center text-xs text-fg-muted"
                  >
                    No groups — select at least one grouping field.
                  </TableCell>
                </TableRow>
              ) : (
                shaped.groups.map((group) => (
                  <TableRow key={group.key}>
                    <TableCell>{group.label}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {group.stats?.n ?? 0}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {group.nullCount}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {group.stats ? formatScientific(group.stats.min) : '—'}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {group.stats ? formatScientific(group.stats.mean) : '—'}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {group.stats ? formatScientific(group.stats.median) : '—'}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {group.stats ? formatScientific(group.stats.max) : '—'}
                    </TableCell>
                    {config.facetBy ? (
                      <TableCell>{group.facet ?? 'mixed'}</TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-fg-muted">
            {shaped.totalRows} rows · {shaped.groups.length} groups ·{' '}
            {shaped.droppedNullValues} null values excluded from statistics
            (never binned as zero) · source {source.name}
          </p>
          <Table aria-label="A/B comparison" data-density="compact">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Key</TableHead>
                <TableHead>A · {sideALabel}</TableHead>
                <TableHead>B · {sideBLabel}</TableHead>
                <TableHead>Δ (B − A)</TableHead>
                <TableHead>Present</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairing.rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-xs text-fg-muted"
                  >
                    {shaped.groups.length < 2
                      ? 'At least two groups are needed to compare A against B.'
                      : 'Select side A and side B to compare them.'}
                  </TableCell>
                </TableRow>
              ) : (
                pairing.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="mono">{row.label}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {row.aValue === null ? '—' : formatScientific(row.aValue)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {row.bValue === null ? '—' : formatScientific(row.bValue)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {row.delta === null
                        ? '—'
                        : row.delta > 0
                          ? `+${formatScientific(row.delta)}`
                          : formatScientific(row.delta)}
                    </TableCell>
                    <TableCell className="text-xs text-fg-muted">
                      {row.presence === 'both'
                        ? 'both'
                        : row.presence === 'a-only'
                          ? `A only (${sideALabel})`
                          : `B only (${sideBLabel})`}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-fg-muted" data-compare-pairing-summary>
            {pairing.matchedCount} rows matched · {pairing.changedCount} changed
            · {pairing.onlyACount + pairing.onlyBCount} unmatched ·{' '}
            {pairing.rule}
          </p>
        </RepresentationFrame>
      ) : null}
    </div>
  )
}
