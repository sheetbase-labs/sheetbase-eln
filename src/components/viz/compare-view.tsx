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

import {
  Button,
  Field,
  FieldLabel,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import {
  CHART_SPEC_VERSION,
  materialiseChart,
  formatScientific,
} from '#/lib/chart-spec'
import type { ChartColumn, ChartSpec } from '#/lib/chart-spec'
import { createRepresentationHandle } from '#/lib/representations'
import {
  COMPARATIVE_VIEW_TYPES,
  promoteToChartSpec,
  shapeComparativeView,
  validateComparativeViewConfig,
} from '#/lib/comparative-view'
import type { ComparativeViewConfig } from '#/lib/comparative-view'
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

  function toggleGroupField(fieldId: string) {
    const next = config.groupBy.includes(fieldId)
      ? config.groupBy.filter((f) => f !== fieldId)
      : [...config.groupBy, fieldId]
    onConfigChange({ ...config, groupBy: next })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="compare-view-type">View type</FieldLabel>
          <Select
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
          </Select>
        </Field>
        {config.viewType === 'time_series' ? (
          <Field>
            <FieldLabel htmlFor="compare-time-field">Time field</FieldLabel>
            <Select
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
            </Select>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="compare-value-field">Value field</FieldLabel>
          <Select
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
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="compare-facet-field">Facet field</FieldLabel>
          <Select
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
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-muted-foreground">
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
        <p role="alert" className="text-xs text-destructive">
          {errors.join('; ')}
        </p>
      ) : null}
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
                    className="text-center text-xs text-muted-foreground"
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
          <p className="text-xs text-muted-foreground">
            {shaped.totalRows} rows · {shaped.groups.length} groups ·{' '}
            {shaped.droppedNullValues} null values excluded from statistics
            (never binned as zero) · source {source.name}
          </p>
        </RepresentationFrame>
      ) : null}
    </div>
  )
}
