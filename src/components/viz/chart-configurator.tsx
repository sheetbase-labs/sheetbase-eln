import {
  BarChart3,
  LineChart as LineChartIcon,
  ScatterChart,
} from 'lucide-react'

import {
  Button,
  ButtonGroup,
  Field,
  FieldGroup,
  FieldLabel,
  Select,
} from '#/components/ui'
import { CHART_TYPES } from '#/lib/chart-spec'
import type { ChartSpec, FieldBinding } from '#/lib/chart-spec'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'

export interface ChartConfiguratorProps {
  table: ScientificTableWire
  spec: ChartSpec
  onSpecChange: (spec: ChartSpec) => void
  idPrefix?: string
}

/** Controlled chart authoring controls shared by every full-size chart surface. */
export function ChartConfigurator({
  table,
  spec,
  onSpecChange,
  idPrefix = 'chart',
}: ChartConfiguratorProps) {
  const numericColumns = table.columns.filter(
    (column) =>
      column.logical_type === 'decimal' || column.logical_type === 'integer',
  )
  const categoryColumns = table.columns.filter((column) =>
    ['category', 'text', 'boolean'].includes(column.logical_type),
  )
  const errorColumns = numericColumns.filter(
    (column) =>
      column.id !== spec.fields.x?.columnId &&
      column.id !== spec.fields.y.columnId &&
      /\b(sd|se|sem|error|ci|confidence|deviation)\b/i.test(
        `${column.label} ${column.field_name}`,
      ),
  )
  const aggregateTransform = spec.transformations.find(
    (transformation) => transformation.kind === 'aggregate',
  )
  const normaliseTransform = spec.transformations.find(
    (transformation) => transformation.kind === 'normalise',
  )

  function update(patch: Partial<ChartSpec>) {
    onSpecChange({ ...spec, ...patch })
  }

  function setField(
    key: 'x' | 'y' | 'series' | 'color' | 'size',
    columnId: string,
  ) {
    const column = table.columns.find((candidate) => candidate.id === columnId)
    const binding: FieldBinding | null = column
      ? { columnId: column.id, fieldName: column.field_name }
      : null
    const fields = { ...spec.fields, [key]: binding }
    const transformations = spec.transformations.map((transformation) => {
      if (transformation.kind === 'aggregate') {
        return {
          ...transformation,
          params: {
            ...transformation.params,
            xField: fields.x?.fieldName ?? null,
            yField: fields.y.fieldName,
            seriesField: fields.series?.fieldName ?? null,
          },
        }
      }
      if (transformation.kind === 'normalise') {
        return {
          ...transformation,
          params: {
            ...transformation.params,
            yField: fields.y.fieldName,
            seriesField: fields.series?.fieldName ?? null,
          },
        }
      }
      return transformation
    })
    const display = { ...spec.display }
    if (key === 'x') {
      display.axes = {
        ...display.axes,
        x: {
          ...display.axes.x,
          label: column?.label ?? 'Row',
          unit: column ? display.axes.x.unit : undefined,
        },
      }
    }
    if (key === 'y' && column) {
      display.axes = {
        ...display.axes,
        y: { ...display.axes.y, label: column.label },
      }
    }
    const overlays =
      spec.overlays.errorBars &&
      (spec.overlays.errorBars.columnId === fields.x?.columnId ||
        spec.overlays.errorBars.columnId === fields.y.columnId)
        ? { ...spec.overlays, errorBars: null }
        : spec.overlays
    onSpecChange({ ...spec, fields, transformations, display, overlays })
  }

  function setTransformation(kind: 'aggregate' | 'normalise', value: string) {
    const others = spec.transformations.filter(
      (transformation) => transformation.kind !== kind,
    )
    if (!value) return update({ transformations: others })
    update({
      transformations: [
        ...others,
        kind === 'aggregate'
          ? {
              kind,
              params: {
                function: value,
                xField: spec.fields.x?.fieldName ?? null,
                yField: spec.fields.y.fieldName,
                seriesField: spec.fields.series?.fieldName ?? null,
              },
            }
          : {
              kind,
              params: {
                method: value,
                yField: spec.fields.y.fieldName,
                seriesField: spec.fields.series?.fieldName ?? null,
              },
            },
      ],
    })
  }

  function setErrorBarColumn(columnId: string) {
    if (!columnId) {
      return update({ overlays: { ...spec.overlays, errorBars: null } })
    }
    const column = errorColumns.find((candidate) => candidate.id === columnId)
    if (!column) return
    update({
      overlays: {
        ...spec.overlays,
        errorBars: {
          columnId: column.id,
          fieldName: column.field_name,
          basis: 'custom',
          multiplier: 1,
        },
      },
    })
  }

  const fields = [
    {
      key: 'x' as const,
      label: 'X-axis',
      ariaLabel: 'X axis field',
      columns: numericColumns,
      empty: '(none — row index)',
      value: spec.fields.x?.columnId ?? '',
    },
    {
      key: 'y' as const,
      label: 'Y-axis',
      ariaLabel: 'Y axis field',
      columns: numericColumns,
      value: spec.fields.y.columnId,
    },
    {
      key: 'series' as const,
      label: 'Series',
      ariaLabel: 'Group by series',
      columns: categoryColumns,
      empty: 'No split',
      value: spec.fields.series?.columnId ?? '',
    },
  ]

  return (
    <div
      className="shrink-0 space-y-2.5 border-b pb-3"
      aria-labelledby={`${idPrefix}-controls-title`}
    >
      <h2 id={`${idPrefix}-controls-title`} className="sr-only">
        Chart configuration
      </h2>
      <FieldGroup className="flex flex-wrap items-end gap-3">
        <Field className="min-w-fit shrink-0">
          <FieldLabel>Chart type</FieldLabel>
          <ButtonGroup role="radiogroup" aria-label="Chart type">
            {CHART_TYPES.map((type) => (
              <Button
                key={type}
                type="button"
                variant={spec.type === type ? 'default' : 'outline'}
                size="sm"
                role="radio"
                aria-checked={spec.type === type}
                onClick={() => update({ type })}
                className="gap-1.5 capitalize"
              >
                {type === 'line' ? (
                  <LineChartIcon className="size-3.5" aria-hidden />
                ) : type === 'scatter' ? (
                  <ScatterChart className="size-3.5" aria-hidden />
                ) : (
                  <BarChart3 className="size-3.5" aria-hidden />
                )}
                {type}
              </Button>
            ))}
          </ButtonGroup>
        </Field>
        {fields.map((field) => (
          <Field key={field.key} className="min-w-36 flex-1">
            <FieldLabel htmlFor={`${idPrefix}-${field.key}`}>
              {field.label}
            </FieldLabel>
            <Select
              id={`${idPrefix}-${field.key}`}
              aria-label={field.ariaLabel}
              value={field.value}
              onChange={(event) => setField(field.key, event.target.value)}
              className="h-8 bg-background"
            >
              {field.empty ? <option value="">{field.empty}</option> : null}
              {field.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </FieldGroup>
      <FieldGroup className="flex flex-wrap items-end gap-3 pt-2.5">
        <Field className="min-w-36 flex-1">
          <FieldLabel htmlFor={`${idPrefix}-aggregation`}>
            Aggregation
          </FieldLabel>
          <Select
            id={`${idPrefix}-aggregation`}
            aria-label="Aggregation function"
            value={
              typeof aggregateTransform?.params.function === 'string'
                ? aggregateTransform.params.function
                : ''
            }
            onChange={(event) =>
              setTransformation('aggregate', event.target.value)
            }
            className="h-8 bg-background"
          >
            <option value="">None (raw rows)</option>
            <option value="mean">Mean (by x)</option>
            <option value="sum">Sum (by x)</option>
            <option value="min">Minimum (by x)</option>
            <option value="max">Maximum (by x)</option>
            <option value="count">Count (by x)</option>
          </Select>
        </Field>
        <Field className="min-w-36 flex-1">
          <FieldLabel htmlFor={`${idPrefix}-normalisation`}>
            Normalisation
          </FieldLabel>
          <Select
            id={`${idPrefix}-normalisation`}
            aria-label="Normalisation method"
            value={
              typeof normaliseTransform?.params.method === 'string'
                ? normaliseTransform.params.method
                : ''
            }
            onChange={(event) =>
              setTransformation('normalise', event.target.value)
            }
            className="h-8 bg-background"
          >
            <option value="">None</option>
            <option value="percent_of_max">Percent of maximum</option>
            <option value="z_score">Z-score</option>
          </Select>
        </Field>
        {errorColumns.length ? (
          <Field className="min-w-40 flex-1">
            <FieldLabel htmlFor={`${idPrefix}-error-column`}>
              Error bars
            </FieldLabel>
            <Select
              id={`${idPrefix}-error-column`}
              aria-label="Error bar column"
              value={spec.overlays.errorBars?.columnId ?? ''}
              onChange={(event) => setErrorBarColumn(event.target.value)}
              className="h-8 bg-background"
            >
              <option value="">None</option>
              {errorColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </FieldGroup>
    </div>
  )
}
