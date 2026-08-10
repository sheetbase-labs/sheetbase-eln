/**
 * ANALYSIS-001 — Analysis Studio route (`/analysis`).
 *
 * A reproducible chart-authoring surface built from typed ChartSpec controls
 * (SCI-004 decision 0029). The studio composes a data-source, chart-type,
 * axis, grouping, normalisation, aggregation and statistical-overlay
 * controls; a live preview that reads source data through the same `/api/db`
 * boundary and RLS as the rest of the application WITHOUT mutating the source
 * datasets; saved named analysis views (owner, version, source revisions)
 * persisted in `api.analysis_views`; and export with explicit format,
 * dimensions, theme and provenance metadata.
 *
 * Every chart has an accessible data-table alternative rendered beneath it.
 * Missing columns, stale sources, invalid log values and excessive result
 * sizes are surfaced as explicit, recoverable states rather than blank axes.
 *
 * PostgreSQL and RLS remain authoritative (decisions 0019/0029/0034).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Database,
  Download,
  LineChart as LineChartIcon,
  Loader2,
  Save,
  ScatterChart,
  Sigma,
  Trash2,
  TriangleAlert,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import {
  Badge,
  Button,
  ButtonGroup,
  Card,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { Inspector } from '#/components/record/inspector'
import {
  InspectorSection,
  InspectorSectionStack,
  Property,
  PropertyList,
} from '#/components/record'
import { materialiseLiveChart, useLiveChartDataset } from '#/lib/chart-data'
import {
  AXIS_SCALES,
  CHART_PALETTE,
  CHART_SPEC_VERSION,
  CHART_TYPES,
  formatScientific,
} from '#/lib/chart-spec'
import type {
  AxisScale,
  ChartSpec,
  ChartType,
  FieldBinding,
} from '#/lib/chart-spec'
import {
  ANALYSIS_MAX_FILTERS,
  ANALYSIS_MAX_RESULT_ROWS,
  analysisStudioDataClient,
  analysisStudioQueryKeys,
  buildExportProvenance,
  captureSourceRevisions,
  DEFAULT_EXPORT_SETTINGS,
  deleteAnalysisView,
  detectStaleSources,
  exportChartSvg,
  exportDataCsv,
  exportViewJson,
  fetchAnalysisViews,
  fetchDatasetSummaries,
  materialiseAnalysisChart,
  saveAnalysisView,
  validateAnalysisSpec,
} from '#/lib/analysis-studio-data'
import type {
  AnalysisViewWire,
  ExportSettings,
} from '#/lib/analysis-studio-data'
import { buildDefaultChartSpec } from '#/lib/dataset-explorer-data'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'
import { formatCount } from '#/lib/format-numbers'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/analysis')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: AnalysisStudioRoute,
})

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

function AnalysisStudioRoute() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? 'no-workspace'
  const userId = context.user.id

  const summariesQuery = useQuery({
    queryKey: analysisStudioQueryKeys.datasets,
    queryFn: () => fetchDatasetSummaries(),
    staleTime: 30_000,
  })
  const datasets = summariesQuery.data ?? []

  const viewsQuery = useQuery({
    queryKey: analysisStudioQueryKeys.views,
    queryFn: () => fetchAnalysisViews(analysisStudioDataClient),
    staleTime: 10_000,
  })
  const views = viewsQuery.data ?? []

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [spec, setSpec] = useState<ChartSpec | null>(null)
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
  const [viewName, setViewName] = useState('')
  const [exportSettings, setExportSettings] = useState<ExportSettings>(
    DEFAULT_EXPORT_SETTINGS,
  )

  // Auto-select the first dataset once the list loads.
  useEffect(() => {
    if (!selectedTableId && datasets.length > 0) {
      setSelectedTableId(datasets[0].id)
    }
    if (
      selectedTableId &&
      datasets.length > 0 &&
      !datasets.some((d) => d.id === selectedTableId)
    ) {
      setSelectedTableId(datasets[0].id)
    }
  }, [datasets, selectedTableId])

  const selectedTable = useMemo(
    () => datasets.find((d) => d.id === selectedTableId) ?? null,
    [datasets, selectedTableId],
  )

  // Build a default spec when the dataset changes (or load a saved view).
  useEffect(() => {
    if (selectedTable) {
      setSpec(buildDefaultChartSpec(selectedTable))
      setSelectedViewId(null)
      setViewName('')
    }
  }, [selectedTableId])

  // Live preview resolution: read source data read-only (never mutate). The
  // materialised chart is lifted here so the preview and the export panel
  // share one authoritative materialisation.
  const { datasetQuery, calcQuery } = useLiveChartDataset(spec)
  const liveMaterialised = useMemo(
    () =>
      spec
        ? materialiseLiveChart(
            spec,
            datasetQuery.data ?? null,
            calcQuery.data ?? null,
          )
        : missingDatasetChart(),
    [spec, datasetQuery.data, calcQuery.data],
  )
  const analysisMaterialised = useMemo(() => {
    if (!spec || !datasetQuery.data) return liveMaterialised
    const columns = datasetQuery.data.columns.map((c) => ({
      id: c.id,
      fieldName: c.field_name,
      label: c.label,
      logicalType: c.logical_type,
      unit: c.unit,
    }))
    return materialiseAnalysisChart(spec, columns, datasetQuery.data.rows)
  }, [spec, datasetQuery.data, liveMaterialised])

  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!spec || !viewName.trim()) return
      const sourceRevisions = captureSourceRevisions(datasets, spec)
      return saveAnalysisView(
        analysisStudioDataClient,
        {
          id: selectedViewId ?? undefined,
          name: viewName.trim(),
          spec,
          source_revisions: sourceRevisions,
          export_settings: exportSettings,
        },
        workspaceId,
        userId,
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisStudioQueryKeys.views })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      deleteAnalysisView(analysisStudioDataClient, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisStudioQueryKeys.views })
    },
  })

  function loadView(view: AnalysisViewWire) {
    setSelectedViewId(view.id)
    setViewName(view.name)
    setSpec(view.spec)
    if (view.export_settings) setExportSettings(view.export_settings)
    const tableId = view.spec.datasets[0]?.tableId ?? null
    if (tableId && datasets.some((d) => d.id === tableId)) {
      setSelectedTableId(tableId)
    }
  }

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Analysis' }],
    fullBleed: true,
    inspectorCollapsible: true,
    inspectorLabel: 'Chart settings',
    inspector:
      selectedTable && spec ? (
        <AnalysisInspector
          table={selectedTable}
          spec={spec}
          onSpecChange={setSpec}
          views={views}
          selectedViewId={selectedViewId}
          viewName={viewName}
          onViewNameChange={setViewName}
          onLoad={loadView}
          onSave={() => saveMutation.mutate()}
          onDelete={(id) => deleteMutation.mutate(id)}
          saving={saveMutation.isPending}
          exportSettings={exportSettings}
          onExportSettingsChange={setExportSettings}
          datasets={datasets}
          user={{ id: userId, name: context.user.name }}
          materialised={analysisMaterialised}
        />
      ) : undefined,
  })

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        <AnalysisStudioHeader
          datasets={datasets}
          loading={summariesQuery.isLoading}
          error={summariesQuery.error}
          selectedTableId={selectedTableId}
          onSelect={setSelectedTableId}
        />
        {selectedTable && spec ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <AnalysisControls
              table={selectedTable}
              spec={spec}
              onSpecChange={setSpec}
            />
            <AnalysisPreview
              table={selectedTable}
              spec={spec}
              datasets={datasets}
              selectedViewId={selectedViewId}
              views={views}
              datasetQuery={datasetQuery}
              materialised={analysisMaterialised}
            />
          </div>
        ) : (
          <EmptyAnalysisState
            loading={summariesQuery.isLoading}
            error={summariesQuery.error}
          />
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Header + dataset selector
// ---------------------------------------------------------------------------

interface AnalysisStudioHeaderProps {
  datasets: ScientificTableWire[]
  loading: boolean
  error: unknown
  selectedTableId: string | null
  onSelect: (id: string) => void
}

export function AnalysisStudioHeader({
  datasets,
  loading,
  error,
  selectedTableId,
  onSelect,
}: AnalysisStudioHeaderProps) {
  return (
    <header
      className="flex shrink-0 flex-wrap items-center justify-between gap-3"
      aria-labelledby="analysis-title"
    >
      <div className="flex min-w-0 items-center gap-2">
        <LineChartIcon className="size-4 text-violet-500" aria-hidden="true" />
        <h1
          id="analysis-title"
          className="text-sm font-semibold tracking-tight"
        >
          Analysis Studio
        </h1>
        <span className="text-xs text-muted-foreground">
          Visualise scientific data, compare conditions, and export
          publication-ready charts
        </span>
      </div>
      <div className="flex items-center gap-2">
        {error ? (
          <Badge variant="danger">Could not load datasets</Badge>
        ) : loading ? (
          <Skeleton className="h-7 w-48" />
        ) : datasets.length === 0 ? (
          <Badge variant="outline">No datasets</Badge>
        ) : (
          <Field className="flex items-center gap-2">
            <FieldLabel htmlFor="analysis-data-source" className="sr-only">
              Data source
            </FieldLabel>
            <Select
              id="analysis-data-source"
              aria-label="Select data source"
              value={selectedTableId ?? ''}
              onChange={(e) => onSelect(e.target.value)}
              className="h-8 w-56 bg-background"
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.dataset_schema ? ` · ${d.dataset_schema.slug}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Controls — data-source, chart-type, axis, grouping, normalisation,
// aggregation and statistical-overlay controls from typed specifications.
// ---------------------------------------------------------------------------

interface AnalysisControlsProps {
  table: ScientificTableWire
  spec: ChartSpec
  onSpecChange: (spec: ChartSpec) => void
}

export function AnalysisControls({
  table,
  spec,
  onSpecChange,
}: AnalysisControlsProps) {
  const numericColumns = table.columns.filter(
    (c) => c.logical_type === 'decimal' || c.logical_type === 'integer',
  )
  const categoryColumns = table.columns.filter(
    (c) =>
      c.logical_type === 'category' ||
      c.logical_type === 'text' ||
      c.logical_type === 'boolean',
  )
  const errorColumns = numericColumns.filter(
    (column) =>
      column.id !== spec.fields.x?.columnId &&
      column.id !== spec.fields.y.columnId &&
      /\b(sd|se|sem|error|ci|confidence|deviation)\b/i.test(
        `${column.label} ${column.field_name}`,
      ),
  )

  function update(patch: Partial<ChartSpec>): void {
    onSpecChange({ ...spec, ...patch })
  }

  function setField(
    key: 'x' | 'y' | 'series' | 'color' | 'size',
    columnId: string,
  ): void {
    const column = table.columns.find((c) => c.id === columnId) ?? null
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
    // Keep axis labels in sync with the mapped columns.
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

  function setType(type: ChartType): void {
    onSpecChange({ ...spec, type })
  }

  // --- Aggregation + normalisation transformations -----------------------
  const aggregateTransform = spec.transformations.find(
    (t) => t.kind === 'aggregate',
  )
  const normaliseTransform = spec.transformations.find(
    (t) => t.kind === 'normalise',
  )

  function setAggregate(fn: string): void {
    const others = spec.transformations.filter((t) => t.kind !== 'aggregate')
    if (!fn) {
      update({ transformations: others })
      return
    }
    update({
      transformations: [
        ...others,
        {
          kind: 'aggregate',
          params: {
            function: fn,
            xField: spec.fields.x?.fieldName ?? null,
            yField: spec.fields.y.fieldName,
            seriesField: spec.fields.series?.fieldName ?? null,
          },
        },
      ],
    })
  }

  function setNormalise(method: string): void {
    const others = spec.transformations.filter((t) => t.kind !== 'normalise')
    if (!method) {
      update({ transformations: others })
      return
    }
    update({
      transformations: [
        ...others,
        {
          kind: 'normalise',
          params: {
            method,
            yField: spec.fields.y.fieldName,
            seriesField: spec.fields.series?.fieldName ?? null,
          },
        },
      ],
    })
  }

  // Only explicit uncertainty columns can be used as error values. Choosing
  // an arbitrary numeric measure (for example, Time) produces a valid but
  // scientifically meaningless chart.
  function setErrorBarColumn(columnId: string): void {
    if (!columnId) {
      update({ overlays: { ...spec.overlays, errorBars: null } })
      return
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
  const currentErrorColumn = spec.overlays.errorBars?.columnId ?? ''

  return (
    <div
      className="shrink-0 space-y-2.5 border-b pb-3"
      aria-labelledby="controls-title"
    >
      <h2 id="controls-title" className="sr-only">
        Chart configuration
      </h2>
      <FieldGroup className="flex flex-wrap items-end gap-3">
        <Field className="min-w-fit shrink-0">
          <FieldLabel>Chart type</FieldLabel>
          <ButtonGroup role="radiogroup" aria-label="Chart type">
            {CHART_TYPES.map((t) => (
              <Button
                key={t}
                type="button"
                variant={spec.type === t ? 'default' : 'outline'}
                size="sm"
                role="radio"
                aria-checked={spec.type === t}
                onClick={() => setType(t)}
                className="gap-1.5 capitalize"
              >
                {t === 'line' ? (
                  <LineChartIcon className="size-3.5" aria-hidden="true" />
                ) : t === 'scatter' ? (
                  <ScatterChart className="size-3.5" aria-hidden="true" />
                ) : (
                  <BarChart3 className="size-3.5" aria-hidden="true" />
                )}
                {t}
              </Button>
            ))}
          </ButtonGroup>
        </Field>
        <Field className="min-w-36 flex-1">
          <FieldLabel htmlFor="analysis-x-axis">X-axis</FieldLabel>
          <Select
            id="analysis-x-axis"
            aria-label="X axis field"
            value={spec.fields.x?.columnId ?? ''}
            onChange={(e) => setField('x', e.target.value)}
            className="h-8 bg-background"
          >
            <option value="">(none — row index)</option>
            {numericColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field className="min-w-36 flex-1">
          <FieldLabel htmlFor="analysis-y-axis">Y-axis</FieldLabel>
          <Select
            id="analysis-y-axis"
            aria-label="Y axis field"
            value={spec.fields.y.columnId}
            onChange={(e) => setField('y', e.target.value)}
            className="h-8 bg-background"
          >
            {numericColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field className="min-w-36 flex-1">
          <FieldLabel htmlFor="analysis-series">Series</FieldLabel>
          <Select
            id="analysis-series"
            aria-label="Group by series"
            value={spec.fields.series?.columnId ?? ''}
            onChange={(e) => setField('series', e.target.value)}
            className="h-8 bg-background"
          >
            <option value="">No split</option>
            {categoryColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </FieldGroup>
      <FieldGroup className="flex flex-wrap items-end gap-3 pt-2.5">
        <Field className="min-w-36 flex-1">
          <FieldLabel htmlFor="analysis-aggregation">Aggregation</FieldLabel>
          <Select
            id="analysis-aggregation"
            aria-label="Aggregation function"
            value={
              typeof aggregateTransform?.params.function === 'string'
                ? aggregateTransform.params.function
                : ''
            }
            onChange={(e) => setAggregate(e.target.value)}
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
          <FieldLabel htmlFor="analysis-normalisation">
            Normalisation
          </FieldLabel>
          <Select
            id="analysis-normalisation"
            aria-label="Normalisation method"
            value={
              typeof normaliseTransform?.params.method === 'string'
                ? normaliseTransform.params.method
                : ''
            }
            onChange={(e) => setNormalise(e.target.value)}
            className="h-8 bg-background"
          >
            <option value="">None</option>
            <option value="percent_of_max">Percent of maximum</option>
            <option value="z_score">Z-score</option>
          </Select>
        </Field>
        {errorColumns.length > 0 ? (
          <Field className="min-w-40 flex-1">
            <FieldLabel htmlFor="analysis-error-column">Error bars</FieldLabel>
            <Select
              id="analysis-error-column"
              aria-label="Error bar column"
              value={currentErrorColumn}
              onChange={(e) => setErrorBarColumn(e.target.value)}
              className="h-8 bg-background"
            >
              <option value="">None</option>
              {errorColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </FieldGroup>
    </div>
  )
}

export function FilterControls({
  table,
  spec,
  onSpecChange,
}: {
  table: ScientificTableWire
  spec: ChartSpec
  onSpecChange: (spec: ChartSpec) => void
}) {
  function setFilter(index: number, value: string): void {
    const filters = [...spec.filters]
    if (filters[index]) {
      filters[index] = { ...filters[index], value }
      onSpecChange({ ...spec, filters })
    }
  }
  function addFilter(): void {
    if (spec.filters.length >= ANALYSIS_MAX_FILTERS) return
    const column = table.columns.find(
      (c) => !spec.filters.some((f) => f.columnId === c.id),
    )
    if (!column) return
    onSpecChange({
      ...spec,
      filters: [
        ...spec.filters,
        {
          columnId: column.id,
          fieldName: column.field_name,
          op: 'eq',
          value: '',
        },
      ],
    })
  }
  function removeFilter(index: number): void {
    onSpecChange({
      ...spec,
      filters: spec.filters.filter((_, i) => i !== index),
    })
  }
  return (
    <div className="space-y-1.5">
      {spec.filters.map((filter, i) => {
        const column = table.columns.find((c) => c.id === filter.columnId)
        return (
          <div key={filter.columnId + i} className="flex items-center gap-1.5">
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {column?.label ?? filter.fieldName}
            </span>
            <Field className="w-24">
              <FieldLabel
                className="sr-only"
                htmlFor={`filter-${filter.columnId}-${i}`}
              >
                Filter value
              </FieldLabel>
              <Input
                id={`filter-${filter.columnId}-${i}`}
                aria-label={`Filter value for ${column?.label ?? filter.fieldName}`}
                value={String(filter.value ?? '')}
                onChange={(e) => setFilter(i, e.target.value)}
                placeholder="eq…"
                className="h-7 bg-background text-xs"
              />
            </Field>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove filter"
              onClick={() => removeFilter(i)}
            >
              <Trash2 />
            </Button>
          </div>
        )
      })}
      {spec.filters.length < ANALYSIS_MAX_FILTERS ? (
        <Button variant="outline" size="sm" onClick={addFilter}>
          + Add filter
        </Button>
      ) : null}
    </div>
  )
}

function AnalysisInspector({
  table,
  spec,
  onSpecChange,
  views,
  selectedViewId,
  viewName,
  onViewNameChange,
  onLoad,
  onSave,
  onDelete,
  saving,
  exportSettings,
  onExportSettingsChange,
  datasets,
  user,
  materialised,
}: {
  table: ScientificTableWire
  spec: ChartSpec
  onSpecChange: (spec: ChartSpec) => void
  views: AnalysisViewWire[]
  selectedViewId: string | null
  viewName: string
  onViewNameChange: (name: string) => void
  onLoad: (view: AnalysisViewWire) => void
  onSave: () => void
  onDelete: (id: string) => void
  saving: boolean
  exportSettings: ExportSettings
  onExportSettingsChange: (settings: ExportSettings) => void
  datasets: ScientificTableWire[]
  user: { id: string; name: string }
  materialised: ReturnType<typeof materialiseLiveChart>
}) {
  function setScale(axis: 'x' | 'y', scale: AxisScale) {
    onSpecChange({
      ...spec,
      display: {
        ...spec.display,
        axes: {
          ...spec.display.axes,
          [axis]: { ...spec.display.axes[axis], scale },
        },
      },
    })
  }

  const settings = (
    <InspectorSectionStack>
      <InspectorSection title="Axis scaling">
        <FieldGroup>
          {(['x', 'y'] as const).map((axis) => (
            <Field key={axis}>
              <FieldLabel htmlFor={`inspector-${axis}-scale`}>
                {axis.toUpperCase()}-axis scale
              </FieldLabel>
              <Select
                id={`inspector-${axis}-scale`}
                value={spec.display.axes[axis].scale}
                onChange={(event) =>
                  setScale(axis, event.target.value as AxisScale)
                }
              >
                {AXIS_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale === 'log' ? 'Logarithmic' : 'Linear'}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </FieldGroup>
      </InspectorSection>
      <InspectorSection title="Appearance">
        <PropertyList>
          <Property label="Palette">Publication</Property>
          <Property label="Font">Instrument Sans</Property>
          <Property label="Series">{materialised.series.length}</Property>
        </PropertyList>
      </InspectorSection>
    </InspectorSectionStack>
  )

  return (
    <Inspector
      recordType="Analysis configuration"
      title="Chart settings"
      state="loaded"
      tabs={[
        { id: 'settings', label: 'Settings', content: settings },
        {
          id: 'views',
          label: 'Views',
          badge: views.length > 0 ? views.length : undefined,
          content: (
            <SavedViewsPanel
              views={views}
              selectedViewId={selectedViewId}
              viewName={viewName}
              onViewNameChange={onViewNameChange}
              onLoad={onLoad}
              onSave={onSave}
              onDelete={onDelete}
              saving={saving}
              canSave={Boolean(viewName.trim())}
            />
          ),
        },
        {
          id: 'calculations',
          label: 'Calculations',
          content: (
            <InspectorSectionStack>
              <InspectorSection title="Filters">
                <FilterControls
                  table={table}
                  spec={spec}
                  onSpecChange={onSpecChange}
                />
              </InspectorSection>
              <InspectorSection title="Summary">
                <PropertyList>
                  <Property label="Transformations">
                    {spec.transformations.length}
                  </Property>
                  <Property label="Filters">{spec.filters.length}</Property>
                </PropertyList>
              </InspectorSection>
            </InspectorSectionStack>
          ),
        },
        {
          id: 'export',
          label: 'Export',
          content: (
            <ExportPanel
              spec={spec}
              settings={exportSettings}
              onSettingsChange={onExportSettingsChange}
              table={table}
              datasets={datasets}
              viewName={viewName}
              selectedViewId={selectedViewId}
              views={views}
              user={user}
              materialised={materialised}
            />
          ),
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// Saved views panel
// ---------------------------------------------------------------------------

interface SavedViewsPanelProps {
  views: AnalysisViewWire[]
  selectedViewId: string | null
  viewName: string
  onViewNameChange: (name: string) => void
  onLoad: (view: AnalysisViewWire) => void
  onSave: () => void
  onDelete: (id: string) => void
  saving: boolean
  canSave: boolean
}

export function SavedViewsPanel({
  views,
  selectedViewId,
  viewName,
  onViewNameChange,
  onLoad,
  onSave,
  onDelete,
  saving,
  canSave,
}: SavedViewsPanelProps) {
  return (
    <section className="space-y-3" aria-labelledby="saved-views-title">
      <h2 id="saved-views-title" className="text-sm font-semibold">
        Saved analysis views
      </h2>
      <p className="text-xs text-muted-foreground">
        Save a named configuration with its source revisions so others can
        reproduce the chart.
      </p>
      <div className="flex items-end gap-1.5">
        <Field className="flex-1">
          <FieldLabel htmlFor="analysis-view-name">Name</FieldLabel>
          <Input
            id="analysis-view-name"
            aria-label="Analysis view name"
            value={viewName}
            onChange={(e) => onViewNameChange(e.target.value)}
            placeholder="e.g. pH vs stability"
            className="h-8 bg-background"
          />
        </Field>
        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={!canSave || saving}
          aria-label="Save analysis view"
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {selectedViewId ? 'Update' : 'Save'}
        </Button>
      </div>
      {views.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          No saved views yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {views.map((view) => {
            const selected = view.id === selectedViewId
            return (
              <li
                key={view.id}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs',
                  selected &&
                    'border-violet-400 bg-violet-50 dark:bg-violet-950/30',
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col text-left"
                  onClick={() => onLoad(view)}
                  aria-label={`Load view ${view.name}`}
                >
                  <span className="truncate font-medium">{view.name}</span>
                  <span className="text-xs text-muted-foreground">
                    v{view.version} ·{' '}
                    {formatCount(view.source_revisions.length)} source
                    {view.source_revisions.length === 1 ? '' : 's'}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete view ${view.name}`}
                  onClick={() => onDelete(view.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Export panel
// ---------------------------------------------------------------------------

interface ExportPanelProps {
  spec: ChartSpec
  settings: ExportSettings
  onSettingsChange: (settings: ExportSettings) => void
  table: ScientificTableWire
  datasets: ScientificTableWire[]
  viewName: string
  selectedViewId: string | null
  views: AnalysisViewWire[]
  user: { id: string; name: string }
  materialised: ReturnType<typeof materialiseLiveChart>
}

export function ExportPanel({
  spec,
  settings,
  onSettingsChange,
  datasets,
  viewName,
  selectedViewId,
  views,
  user,
  materialised,
}: ExportPanelProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)

  function setSetting<TKey extends keyof ExportSettings>(
    key: TKey,
    value: ExportSettings[TKey],
  ): void {
    onSettingsChange({ ...settings, [key]: value })
  }

  function doExport(): void {
    const selectedView = views.find((v) => v.id === selectedViewId) ?? null
    const sourceRevisions = captureSourceRevisions(datasets, spec)
    const provenance = buildExportProvenance(
      {
        name: viewName || selectedView?.name || 'Untitled analysis',
        id: selectedViewId,
        version: selectedView?.version ?? null,
      },
      user,
      sourceRevisions,
      spec,
    )
    let content: string
    let mime: string
    let ext: string
    if (settings.format === 'json') {
      content = exportViewJson(spec, settings, provenance)
      mime = 'application/json'
      ext = 'json'
    } else if (settings.format === 'csv') {
      content = exportDataCsv(materialised)
      mime = 'text/csv'
      ext = 'csv'
    } else {
      content = exportChartSvg(svgRef.current, settings, provenance)
      mime = 'image/svg+xml'
      ext = 'svg'
    }
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(viewName || 'analysis').replace(/[^a-z0-9_-]+/gi, '_')}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="space-y-2 p-4" aria-labelledby="export-title">
      <h2 id="export-title" className="text-sm font-semibold">
        Export
      </h2>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field>
          <FieldLabel htmlFor="analysis-export-format">Format</FieldLabel>
          <Select
            id="analysis-export-format"
            aria-label="Export format"
            value={settings.format}
            onChange={(e) =>
              setSetting('format', e.target.value as ExportSettings['format'])
            }
            className="h-8 bg-background"
          >
            <option value="json">JSON (spec + provenance)</option>
            <option value="csv">CSV (data table)</option>
            <option value="svg">SVG (chart image)</option>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="analysis-export-theme">Theme</FieldLabel>
          <Select
            id="analysis-export-theme"
            aria-label="Export theme"
            value={settings.theme}
            onChange={(e) =>
              setSetting('theme', e.target.value as ExportSettings['theme'])
            }
            className="h-8 bg-background"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="analysis-export-width">Width (px)</FieldLabel>
          <Input
            id="analysis-export-width"
            aria-label="Export width"
            type="number"
            min={320}
            max={4096}
            value={settings.width}
            onChange={(e) =>
              setSetting('width', Number(e.target.value) || settings.width)
            }
            className="h-8 bg-background"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="analysis-export-height">Height (px)</FieldLabel>
          <Input
            id="analysis-export-height"
            aria-label="Export height"
            type="number"
            min={240}
            max={4096}
            value={settings.height}
            onChange={(e) =>
              setSetting('height', Number(e.target.value) || settings.height)
            }
            className="h-8 bg-background"
          />
        </Field>
      </div>
      <Field className="flex grid-cols-[auto_1fr] items-center gap-2">
        <input
          id="analysis-export-provenance"
          type="checkbox"
          checked={settings.includeProvenance}
          onChange={(e) => setSetting('includeProvenance', e.target.checked)}
        />
        <FieldLabel htmlFor="analysis-export-provenance">
          Include provenance metadata (owner, version, sources)
        </FieldLabel>
      </Field>
      <Button size="sm" onClick={doExport} className="w-full">
        <Download /> Export {settings.format.toUpperCase()}
      </Button>
      <SvgExporterAnchor svgRef={svgRef} />
    </Card>
  )
}

/**
 * Captures a reference to the rendered chart SVG so the export panel can
 * serialise it. The preview renders the SVG inside the
 * `[data-analysis-chart]` container; this resolves it after every render.
 */
export function SvgExporterAnchor({
  svgRef,
}: {
  svgRef: React.MutableRefObject<SVGSVGElement | null>
}) {
  useEffect(() => {
    const container = document.querySelector('[data-analysis-chart]')
    svgRef.current =
      (container?.querySelector('svg') as SVGSVGElement | null) ?? null
  })
  return null
}

// ---------------------------------------------------------------------------
// Preview — live chart + accessible data table + error states
// ---------------------------------------------------------------------------

interface AnalysisPreviewProps {
  table: ScientificTableWire
  spec: ChartSpec
  datasets: ScientificTableWire[]
  selectedViewId: string | null
  views: AnalysisViewWire[]
  datasetQuery: ReturnType<typeof useLiveChartDataset>['datasetQuery']
  materialised: ReturnType<typeof materialiseLiveChart>
}

export function AnalysisPreview({
  table,
  spec,
  datasets,
  selectedViewId,
  views,
  datasetQuery,
  materialised: analysisMaterialised,
}: AnalysisPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const chartHeight = expanded ? 460 : 340
  const plotHeight = expanded ? 390 : 270
  const validation = useMemo(
    () => validateAnalysisSpec(spec, datasetQuery.data?.rows.length ?? 0),
    [spec, datasetQuery.data],
  )

  // Stale-source detection against the saved view's stored revisions.
  const staleDetail = useMemo(() => {
    if (!selectedViewId) return null
    const view = views.find((v) => v.id === selectedViewId)
    if (!view) return null
    return detectStaleSources(view.source_revisions, datasets)
  }, [selectedViewId, views, datasets])

  const resultRowCount = datasetQuery.data?.rows.length ?? 0
  const excessiveSize = resultRowCount > ANALYSIS_MAX_RESULT_ROWS
  const summaries = useMemo(
    () =>
      analysisMaterialised.series.flatMap((series) => {
        const valid = series.points.filter(
          (point): point is typeof point & { x: number; y: number } =>
            point.x !== null && point.y !== null,
        )
        if (valid.length === 0) return []
        const firstX = Math.min(...valid.map((point) => point.x))
        const lastX = Math.max(...valid.map((point) => point.x))
        const first = valid.filter((point) => point.x === firstX)
        const last = valid.filter((point) => point.x === lastX)
        const firstMean =
          first.reduce((sum, point) => sum + point.y, 0) / first.length
        const lastMean =
          last.reduce((sum, point) => sum + point.y, 0) / last.length
        return [
          {
            identifier: series.identifier,
            label: series.label,
            colour: series.color,
            lastX,
            lastMean,
            foldChange:
              firstMean > 0 && lastMean > 0
                ? Math.max(firstMean, lastMean) / Math.min(firstMean, lastMean)
                : null,
            direction: lastMean <= firstMean ? 'decrease' : 'increase',
          },
        ]
      }),
    [analysisMaterialised.series],
  )

  return (
    <div
      className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-rows]"
      style={{
        gridTemplateRows: `${chartHeight}px minmax(0, 1fr)`,
      }}
      data-preview-size={expanded ? 'expanded' : 'standard'}
      data-analysis-chart
    >
      <div className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">
              {datasetQuery.isLoading
                ? 'Loading…'
                : `${formatCount(resultRowCount)} rows`}
            </Badge>
            {spec.transformations.length > 0 ? (
              <Badge variant="outline">
                <Sigma className="size-3" aria-hidden="true" />
                {spec.transformations.length} transform
                {spec.transformations.length === 1 ? '' : 's'}
              </Badge>
            ) : null}
            {summaries.slice(0, 3).map((summary) => (
              <span
                key={summary.identifier}
                className="inline-flex items-center gap-1 text-xs"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: summary.colour }}
                />
                <span className="truncate">{summary.label}</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatScientific(summary.lastMean)}
                </span>
              </span>
            ))}
            {summaries[0]?.foldChange ? (
              <span className="text-xs text-muted-foreground">
                Fold change: {summaries[0].foldChange.toFixed(1)}×{' '}
                {summaries[0].direction}
              </span>
            ) : null}
          </div>
        </div>

        {/* Recoverable error / warning states surfaced clearly. */}
        {!validation.ok ? (
          <div
            role="alert"
            className="mx-4 mb-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
          >
            <p className="font-semibold">Specification problems</p>
            <ul className="mt-1 list-disc pl-4">
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {staleDetail ? (
          <div
            role="status"
            className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs"
          >
            <TriangleAlert
              className="mt-0.5 size-4 text-warning"
              aria-hidden="true"
            />
            <span>{staleDetail}</span>
          </div>
        ) : null}
        {excessiveSize ? (
          <div
            role="status"
            className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs"
          >
            <TriangleAlert
              className="mt-0.5 size-4 text-warning"
              aria-hidden="true"
            />
            <span>
              The source dataset has {formatCount(resultRowCount)} rows, above
              the {formatCount(ANALYSIS_MAX_RESULT_ROWS)}-row analysis limit.
              Add filters or aggregation before relying on this preview.
            </span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden px-4 pb-2">
          <ChartRenderer
            title={`${table.name} — ${spec.type} chart`}
            spec={spec}
            materialised={analysisMaterialised}
            frozen={null}
            loading={datasetQuery.isLoading}
            plotHeight={plotHeight}
            expanded={expanded}
            onExpandedChange={setExpanded}
            className="h-full rounded-none border-0 bg-transparent shadow-none"
          />
        </div>
      </div>

      {/* Accessible data table that underlies every chart. */}
      <DataTableAlternative
        materialised={analysisMaterialised}
        loading={datasetQuery.isLoading}
      />
    </div>
  )
}

/**
 * The full accessible data table that underlies every chart. Renders the
 * exact rows the chart plots so the data is reachable without the visual.
 * This is the studio-level table; the chart's own collapsed alternative
 * lives inside ChartRenderer.
 */
export function DataTableAlternative({
  materialised,
  loading,
}: {
  materialised: ReturnType<typeof materialiseLiveChart>
  loading: boolean
}) {
  if (loading) {
    return <Skeleton className="h-32 w-full" />
  }
  if (
    materialised.state.kind !== 'ok' &&
    materialised.state.kind !== 'log_scale_invalid'
  ) {
    return (
      <div className="rounded-lg border bg-card p-4 text-center text-xs text-muted-foreground">
        No plottable data table for the current state.
      </div>
    )
  }
  const chartRows = materialised.series.flatMap((s) =>
    s.points.map((p) => ({
      series: s.label,
      x: p.x,
      y: p.y,
      yError: p.yError,
    })),
  )
  const hasSourceRows =
    materialised.columns.length > 0 && materialised.rows.length > 0
  const columns = hasSourceRows
    ? materialised.columns.map((column) => ({
        key: column.fieldName,
        label: column.unit
          ? `${column.label} (${typeof column.unit === 'object' && 'symbol' in column.unit ? String((column.unit as { symbol: string }).symbol) : String(column.unit)})`
          : column.label,
      }))
    : [
        { key: 'series', label: 'Series' },
        { key: 'x', label: materialised.xLabel },
        { key: 'y', label: materialised.yLabel },
        { key: 'yError', label: 'Error' },
      ]
  const rows: Record<string, unknown>[] = hasSourceRows
    ? materialised.rows.slice(0, 50)
    : chartRows
  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden border-t"
      aria-labelledby="data-table-title"
    >
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <h2 id="data-table-title" className="text-sm font-semibold">
          Data preview
          <span className="ml-2 font-normal text-muted-foreground">
            First {Math.min(rows.length, 50)} rows
          </span>
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="link" size="sm">
            Open in data table
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Download data preview"
          >
            <Download />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table aria-label="Chart data table" data-density="compact">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-center text-xs text-muted-foreground"
                >
                  No rows.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className="scientific-nums whitespace-nowrap font-mono tabular-nums"
                    >
                      {typeof row[column.key] === 'number'
                        ? formatScientific(row[column.key] as number)
                        : String(row[column.key] ?? '—')}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function missingDatasetChart() {
  return {
    state: { kind: 'missing_dataset' as const },
    columns: [],
    rows: [],
    series: [],
    xLabel: 'x',
    yLabel: 'y',
    xUnit: undefined,
    yUnit: undefined,
  }
}

export function EmptyAnalysisState({
  loading,
  error,
}: {
  loading: boolean
  error: unknown
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center text-sm text-destructive"
      >
        Could not load datasets. Check the connection and try again.
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border bg-card p-10 text-center">
      {loading ? (
        <Skeleton className="h-8 w-48" />
      ) : (
        <>
          <Database
            className="size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="max-w-md text-sm text-muted-foreground">
            No datasets yet. Create a notebook with a sheet block, or bind a
            dataset schema on the Schemas page, to start building analysis
            views.
          </p>
        </>
      )}
    </div>
  )
}

export { CHART_PALETTE, CHART_SPEC_VERSION }
