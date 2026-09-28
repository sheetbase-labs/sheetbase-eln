import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Save, Sigma, Trash2, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import {
  ANALYSIS_KINDS,
  COLUMN_TRANSFORMS,
  MAX_DEGREE,
  TRANSFORM_FNS,
  regressionFitCurve,
  runAnalysis,
  validateAnalysisDefinition,
} from '#/lib/analysis-definition'
import type {
  AnalysisDefinition,
  AnalysisError,
  AnalysisResult,
  RegressionFitRow,
} from '#/lib/analysis-definition'
import { CHART_PALETTE, formatScientific } from '#/lib/chart-spec'
import type { ChartSpec, MaterialisedChart } from '#/lib/chart-spec'
import {
  analysisDefinitionQueryKeys,
  captureDefinitionSourceRevisions,
  deleteAnalysisDefinition,
  detectStaleSources,
  fetchAnalysisDefinitions,
  saveAnalysisDefinition,
} from '#/lib/analysis-definitions-data'
import type { AnalysisDefinitionWire } from '#/lib/analysis-definitions-data'
import {
  fetchCanonicalDataset,
  fetchDatasetRows,
  sciDataClient,
} from '#/lib/chart-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { fetchActiveDatasetFlags } from '#/lib/dataset-flags'

/**
 * SCI-02 — reusable analysis definitions in the Analysis Studio.
 *
 * Define, run, save and reload grouped descriptive statistics and polynomial
 * regressions over stable dataset references. Execution is pure TypeScript
 * (`runAnalysis`) so results are deterministic and traceable to explicit
 * inputs; saved definitions record the source revisions captured at save
 * time and surface a stale-source badge when their inputs have evolved.
 */

export interface AnalysisPanelProps {
  datasets: CanonicalDatasetSource[]
  workspaceId: string
  userId: string
}

interface DefinitionDraft {
  editingId: string | null
  name: string
  definition: AnalysisDefinition | null
}

const emptyDraft: DefinitionDraft = {
  editingId: null,
  name: '',
  definition: null,
}

export function AnalysisPanel({
  datasets,
  workspaceId,
  userId,
}: AnalysisPanelProps) {
  const queryClient = useQueryClient()
  const [selectedDatasetId, setSelectedDatasetId] = useState('')
  const [draft, setDraft] = useState<DefinitionDraft>(emptyDraft)

  const definitionsQuery = useQuery({
    queryKey: analysisDefinitionQueryKeys.all,
    queryFn: () => fetchAnalysisDefinitions(),
    staleTime: 10_000,
  })
  const definitions = definitionsQuery.data ?? []

  const selectedDataset = useMemo(
    () => datasets.find((d) => d.datasetId === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId],
  )

  // Dataset rows for execution — read-only canonical rows through the same
  // /api/db boundary as every chart surface.
  const rowsQuery = useQuery({
    queryKey: ['analysis-definition-rows', selectedDatasetId] as const,
    queryFn: async () => {
      const source = await fetchCanonicalDataset(
        sciDataClient,
        selectedDatasetId,
      )
      if (!source) return null
      const [paged, flags] = await Promise.all([
        fetchDatasetRows(sciDataClient, source.datasetId),
        fetchActiveDatasetFlags(sciDataClient, source.datasetId),
      ])
      return { source, ...paged, flags }
    },
    enabled: Boolean(selectedDatasetId),
    staleTime: 10_000,
  })

  // A definition is runnable once it validates structurally and its dataset
  // is selected; execution errors surface per-run below.
  const validation = useMemo(
    () =>
      draft.definition
        ? validateAnalysisDefinition(draft.definition)
        : [{ code: 'missing_field' as const, message: 'No definition yet' }],
    [draft.definition],
  )
  const runnable =
    draft.definition !== null &&
    validation.length === 0 &&
    Boolean(selectedDatasetId) &&
    !rowsQuery.isLoading

  const execution = useMemo(() => {
    const resolved = rowsQuery.data
    if (!runnable || !draft.definition || !resolved) return null
    // Over-ceiling datasets refuse execution honestly instead of computing
    // statistics over a truncated sample.
    if (resolved.truncated) return null
    return runAnalysis(
      draft.definition,
      resolved.source.columns,
      resolved.rows,
      resolved.flags,
    )
  }, [runnable, draft.definition, rowsQuery.data])

  function updateDefinition(patch: Partial<AnalysisDefinition>) {
    setDraft((prev) => {
      if (!prev.definition) return prev
      return {
        ...prev,
        definition: { ...prev.definition, ...patch } as AnalysisDefinition,
      }
    })
  }

  function startDraft(kind: (typeof ANALYSIS_KINDS)[number]) {
    if (!selectedDataset) return
    const numeric = selectedDataset.columns.filter((c) =>
      ['decimal', 'integer'].includes(c.logicalType),
    )
    const category = selectedDataset.columns.filter((c) =>
      ['category', 'text', 'boolean'].includes(c.logicalType),
    )
    const bind = (column?: { id: string }) =>
      column ? { fieldId: column.id } : null
    const first = numeric[0]
    const base = {
      definitionVersion: 1 as const,
      datasets: [{ datasetId: selectedDataset.datasetId }],
    }
    const definition: AnalysisDefinition =
      kind === 'descriptive'
        ? {
            ...base,
            kind: 'descriptive',
            value: bind(first)!,
            group: bind(category[0]),
          }
        : {
            ...base,
            kind: 'regression',
            outcome: bind(numeric[1] ?? first)!,
            predictor: bind(first)!,
            degree: 1,
          }
    setDraft({ editingId: null, name: '', definition })
  }

  function loadDefinition(saved: AnalysisDefinitionWire) {
    const def = saved.definition as AnalysisDefinition
    setDraft({
      editingId: saved.id,
      name: saved.name,
      definition: def,
    })
    setSelectedDatasetId(def.datasets[0]?.datasetId ?? '')
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.definition || !draft.name.trim()) return null
      return saveAnalysisDefinition(
        sciDataClient,
        {
          id: draft.editingId ?? undefined,
          name: draft.name.trim(),
          definition: draft.definition,
          source_revisions: captureDefinitionSourceRevisions(
            datasets.filter((d) =>
              draft.definition!.datasets.some(
                (ref) => ref.datasetId === d.datasetId,
              ),
            ),
            draft.definition,
          ),
        },
        workspaceId,
        userId,
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: analysisDefinitionQueryKeys.all,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAnalysisDefinition(sciDataClient, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: analysisDefinitionQueryKeys.all,
      })
    },
  })

  // SCI-02 → SCI-01 link: overlay the fitted curve on its observations.
  const fitChart = useMemo(() => {
    const resolved = rowsQuery.data
    if (
      !execution ||
      !execution.ok ||
      execution.result.kind !== 'regression' ||
      !draft.definition ||
      draft.definition.kind !== 'regression' ||
      // Grouped runs produce one fit per group; a single overlay would draw
      // one group's model over every group's points.
      draft.definition.group ||
      !resolved ||
      resolved.truncated ||
      resolved.rows.length === 0
    )
      return null
    const fit: RegressionFitRow =
      execution.result.rows.find((row) => row.group === 'all') ??
      execution.result.rows[0]
    return buildRegressionFitChart({
      definition: draft.definition,
      fit,
      rows: resolved.rows,
    })
  }, [execution, draft.definition, rowsQuery.data])

  const staleDetail = useMemo(() => {
    if (!draft.editingId) return null
    const saved = definitions.find((d) => d.id === draft.editingId)
    if (!saved) return null
    return detectStaleSources(saved.source_revisions, datasets)
  }, [draft.editingId, definitions, datasets])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <Card className="space-y-3 p-3">
        <FieldGroup className="flex flex-wrap items-end gap-3">
          <Field className="min-w-44 flex-1">
            <FieldLabel htmlFor="analysis-definition-dataset">
              Dataset
            </FieldLabel>
            <Select
              id="analysis-definition-dataset"
              aria-label="Analysis dataset"
              value={selectedDatasetId}
              onChange={(event) => {
                setSelectedDatasetId(event.target.value)
              }}
              className="h-8 bg-background"
            >
              <option value="">Select a dataset</option>
              {datasets.map((d) => (
                <option key={d.datasetId} value={d.datasetId}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field className="min-w-40 flex-1">
            <FieldLabel htmlFor="analysis-kind">Analysis</FieldLabel>
            <ButtonGroup>
              {ANALYSIS_KINDS.map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={
                    draft.definition?.kind === kind ? 'default' : 'outline'
                  }
                  disabled={!selectedDataset}
                  aria-pressed={draft.definition?.kind === kind}
                  onClick={() => startDraft(kind)}
                >
                  <Sigma className="size-3.5" aria-hidden />
                  {kind === 'descriptive'
                    ? 'Descriptive statistics'
                    : 'Regression fit'}
                </Button>
              ))}
            </ButtonGroup>
          </Field>
        </FieldGroup>

        {draft.definition ? (
          <AnalysisDefinitionControls
            definition={draft.definition}
            table={selectedDataset!}
            onChange={updateDefinition}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!runnable}
            onClick={() => rowsQuery.refetch()}
          >
            <Play /> Run
          </Button>
          <Input
            aria-label="Analysis name"
            placeholder="Name this analysis…"
            value={draft.name}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, name: event.target.value }))
            }
            className="h-8 w-48 bg-background"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={
              !draft.definition ||
              validation.length > 0 ||
              draft.name.trim() === '' ||
              saveMutation.isPending
            }
            onClick={() => saveMutation.mutate()}
          >
            <Save /> {draft.editingId ? 'Update' : 'Save'}
          </Button>
          {staleDetail ? (
            <Badge variant="warning">
              <TriangleAlert className="size-3" aria-hidden />
              Stale source
            </Badge>
          ) : null}
        </div>
        {staleDetail ? (
          <p role="status" className="text-xs text-muted-foreground">
            {staleDetail}
          </p>
        ) : null}
      </Card>

      {execution && execution.ok ? (
        <AnalysisResultTable result={execution.result} />
      ) : execution ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive"
        >
          {describeExecutionError(execution.error)}
        </div>
      ) : (
        <div
          role="status"
          className="rounded-md border border-dashed border-input bg-muted/20 p-6 text-sm text-muted-foreground"
        >
          Pick a dataset, choose an analysis, then Run to compute against the
          current rows. Saved analyses are listed below.
        </div>
      )}

      {fitChart ? (
        <div className="rounded-md border p-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Fitted curve over observations
          </p>
          <ChartRenderer
            title="Fit preview"
            hideTitle
            spec={fitChart.spec}
            materialised={fitChart.materialised}
            frozen={null}
            showTableAlternative={false}
            plotHeight={220}
          />
        </div>
      ) : execution &&
        execution.ok &&
        draft.definition?.kind === 'regression' &&
        draft.definition.group ? (
        <p className="rounded-md border border-dashed border-input bg-muted/20 p-3 text-xs text-muted-foreground">
          Grouped fits produce one model per group; a single overlay would
          misrepresent them, so no curve is drawn for grouped regressions.
        </p>
      ) : null}

      <SavedDefinitionsList
        definitions={definitions}
        loading={definitionsQuery.isLoading}
        activeId={draft.editingId}
        onLoad={loadDefinition}
        onDelete={(id) => deleteMutation.mutate(id)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Definition controls
// ---------------------------------------------------------------------------

type NumericColumn = { id: string; label: string }

function columnOptions(columns: NumericColumn[]) {
  return columns.map((column) => (
    <option key={column.id} value={column.id}>
      {column.label}
    </option>
  ))
}

function bindingValue(binding: { fieldId: string } | null | undefined): string {
  return binding?.fieldId ?? ''
}

function AnalysisDefinitionControls({
  definition,
  table,
  onChange,
}: {
  definition: AnalysisDefinition
  table: CanonicalDatasetSource
  onChange: (patch: Partial<AnalysisDefinition>) => void
}) {
  const numeric = table.columns.filter((c) =>
    ['decimal', 'integer'].includes(c.logicalType),
  )
  const category = table.columns.filter((c) =>
    ['category', 'text', 'boolean'].includes(c.logicalType),
  )

  function setBinding(key: string, fieldId: string, required: boolean) {
    const column = [...numeric, ...category].find((c) => c.id === fieldId)
    const value =
      column === undefined && !required
        ? null
        : column
          ? { fieldId: column.id }
          : undefined
    onChange({ [key]: value })
  }

  function setTransform(
    key: 'outcomeTransform' | 'predictorTransform',
    value: string,
  ) {
    const transform =
      value === '' || !(COLUMN_TRANSFORMS as readonly string[]).includes(value)
        ? undefined
        : (value as (typeof COLUMN_TRANSFORMS)[number])
    onChange({ [key]: transform })
  }

  return (
    <FieldGroup className="flex flex-wrap items-end gap-3">
      {definition.kind === 'descriptive' ? (
        <>
          <Field className="min-w-36 flex-1">
            <FieldLabel htmlFor="analysis-value">Measured value</FieldLabel>
            <Select
              id="analysis-value"
              aria-label="Measured value column"
              value={bindingValue(definition.value)}
              onChange={(e) => setBinding('value', e.target.value, true)}
              className="h-8 bg-background"
            >
              {columnOptions(numeric)}
            </Select>
          </Field>
          <Field className="min-w-36 flex-1">
            <FieldLabel htmlFor="analysis-group">
              Group by (optional)
            </FieldLabel>
            <Select
              id="analysis-group"
              aria-label="Group by column"
              value={bindingValue(definition.group)}
              onChange={(e) => setBinding('group', e.target.value, false)}
              className="h-8 bg-background"
            >
              <option value="">(one group)</option>
              {columnOptions(category)}
            </Select>
          </Field>
        </>
      ) : (
        <>
          <Field className="min-w-36 flex-1">
            <FieldLabel htmlFor="analysis-outcome">Outcome (y)</FieldLabel>
            <Select
              id="analysis-outcome"
              aria-label="Outcome column"
              value={bindingValue(definition.outcome)}
              onChange={(e) => setBinding('outcome', e.target.value, true)}
              className="h-8 bg-background"
            >
              {columnOptions(numeric)}
            </Select>
          </Field>
          <Field className="min-w-36 flex-1">
            <FieldLabel htmlFor="analysis-predictor">Predictor (x)</FieldLabel>
            <Select
              id="analysis-predictor"
              aria-label="Predictor column"
              value={bindingValue(definition.predictor)}
              onChange={(e) => setBinding('predictor', e.target.value, true)}
              className="h-8 bg-background"
            >
              {columnOptions(numeric)}
            </Select>
          </Field>
          <Field className="min-w-24">
            <FieldLabel htmlFor="analysis-degree">Degree</FieldLabel>
            <Select
              id="analysis-degree"
              aria-label="Polynomial degree"
              value={String(definition.degree ?? 1)}
              onChange={(e) =>
                onChange({
                  degree: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="h-8 bg-background"
            >
              {Array.from({ length: MAX_DEGREE }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field className="min-w-32">
            <FieldLabel htmlFor="analysis-y-transform">y transform</FieldLabel>
            <Select
              id="analysis-y-transform"
              aria-label="Outcome transform"
              value={definition.outcomeTransform ?? ''}
              onChange={(e) => setTransform('outcomeTransform', e.target.value)}
              className="h-8 bg-background"
            >
              <option value="">None</option>
              <option value="log10">log₁₀</option>
              <option value="ln">ln</option>
            </Select>
          </Field>
          <Field className="min-w-32">
            <FieldLabel htmlFor="analysis-x-transform">x transform</FieldLabel>
            <Select
              id="analysis-x-transform"
              aria-label="Predictor transform"
              value={definition.predictorTransform ?? ''}
              onChange={(e) =>
                setTransform('predictorTransform', e.target.value)
              }
              className="h-8 bg-background"
            >
              <option value="">None</option>
              <option value="log10">log₁₀</option>
              <option value="ln">ln</option>
            </Select>
          </Field>
          <Field className="min-w-36 flex-1">
            <FieldLabel htmlFor="analysis-regression-group">
              Group fits by (optional)
            </FieldLabel>
            <Select
              id="analysis-regression-group"
              aria-label="Regression grouping column"
              value={bindingValue(definition.group)}
              onChange={(e) => setBinding('group', e.target.value, false)}
              className="h-8 bg-background"
            >
              <option value="">(one fit)</option>
              {columnOptions(category)}
            </Select>
          </Field>
        </>
      )}
    </FieldGroup>
  )
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function describeExecutionError(error: AnalysisError): string {
  switch (error.code) {
    case 'missing_field':
      return `The definition is missing input column(s): ${error.fields.join(', ')}.`
    case 'empty_dataset':
      return 'The dataset has no rows to analyse.'
    case 'insufficient_data':
      return `Group “${error.group}” has too few rows for this fit (needs at least ${error.needed}).`
    case 'singular_fit':
      return `Group “${error.group}” has a constant predictor; the fit is singular.`
    case 'nonpositive_transform':
      return `${error.count} row(s) have non-positive ${error.field} values and cannot be log-transformed. Filter them out or drop the transform.`
    case 'no_numeric_values':
      return `Column “${error.field}” has no numeric values to analyse.`
  }
}

export function AnalysisResultTable({ result }: { result: AnalysisResult }) {
  if (result.kind === 'descriptive') {
    const stats = [
      ['n', (r: (typeof result.rows)[number]) => String(r.stats.n)],
      ['missing', (r: (typeof result.rows)[number]) => String(r.missing)],
      [
        'mean',
        (r: (typeof result.rows)[number]) => formatScientific(r.stats.mean),
      ],
      ['sd', (r: (typeof result.rows)[number]) => formatScientific(r.stats.sd)],
      ['se', (r: (typeof result.rows)[number]) => formatScientific(r.stats.se)],
      [
        'min',
        (r: (typeof result.rows)[number]) => formatScientific(r.stats.min),
      ],
      ['q1', (r: (typeof result.rows)[number]) => formatScientific(r.stats.q1)],
      [
        'median',
        (r: (typeof result.rows)[number]) => formatScientific(r.stats.median),
      ],
      ['q3', (r: (typeof result.rows)[number]) => formatScientific(r.stats.q3)],
      [
        'max',
        (r: (typeof result.rows)[number]) => formatScientific(r.stats.max),
      ],
    ] as const
    return (
      <div className="overflow-auto rounded-md border">
        <Table>
          <caption className="sr-only">
            Descriptive statistics per group
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Group</TableHead>
              {stats.map(([label]) => (
                <TableHead key={label} scope="col">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.group}>
                <TableCell className="font-medium">{row.group}</TableCell>
                {stats.map(([label, get]) => (
                  <TableCell key={label} className="font-mono tabular-nums">
                    {get(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="overflow-auto rounded-md border">
      <Table>
        <caption className="sr-only">Regression fits per group</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Group</TableHead>
            <TableHead scope="col">n</TableHead>
            <TableHead scope="col">degree</TableHead>
            <TableHead scope="col">R²</TableHead>
            <TableHead scope="col">RMSE</TableHead>
            <TableHead scope="col">Equation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row) => (
            <TableRow key={row.group}>
              <TableCell className="font-medium">{row.group}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.n}</TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.degree}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {formatScientific(row.r2)}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {formatScientific(row.rmse)}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.equation}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Saved definitions
// ---------------------------------------------------------------------------

function SavedDefinitionsList({
  definitions,
  loading,
  activeId,
  onLoad,
  onDelete,
}: {
  definitions: AnalysisDefinitionWire[]
  loading: boolean
  activeId: string | null
  onLoad: (saved: AnalysisDefinitionWire) => void
  onDelete: (id: string) => void
}) {
  if (loading)
    return (
      <div className="p-3 text-xs text-muted-foreground" role="status">
        Loading saved analyses…
      </div>
    )
  if (definitions.length === 0)
    return (
      <div className="p-3 text-xs text-muted-foreground" role="status">
        No saved analyses yet.
      </div>
    )
  return (
    <ul className="space-y-1 overflow-auto" aria-label="Saved analyses">
      {definitions.map((saved) => (
        <li
          key={saved.id}
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
        >
          <span className="truncate font-medium">{saved.name}</span>
          <span className="flex items-center gap-2">
            <Badge variant="outline">v{saved.version}</Badge>
            {activeId === saved.id ? <Badge>Saving edits here</Badge> : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onLoad(saved)}
            >
              Load
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${saved.name}`}
              onClick={() => onDelete(saved.id)}
            >
              <Trash2 />
            </Button>
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// SCI-02 → SCI-01 link: plot a fitted regression curve over its observations
// ---------------------------------------------------------------------------

interface FitChartSpecInput {
  definition: Extract<AnalysisDefinition, { kind: 'regression' }>
  fit: RegressionFitRow
  rows: Record<string, unknown>[]
}

/**
 * Build the observed-points + fitted-curve materialisation for a regression
 * run. Pure so the studio preview and future surfaces share one construction.
 *
 * Correctness contract: the plotted space IS the fitted space. Coefficients
 * describe the transformed coordinates (ADR 0040 §6 — never back-transformed),
 * so observations are drawn with the same monotonic transforms applied and
 * axis labels name the transform. Ungrouped runs only: grouped fits produce
 * one model per group, which a single overlay cannot represent honestly.
 */
export function buildRegressionFitChart(input: FitChartSpecInput): {
  spec: ChartSpec
  materialised: MaterialisedChart
} | null {
  const { definition, fit } = input
  if (definition.group) return null

  const predictorTransform = definition.predictorTransform ?? 'none'
  const outcomeTransform = definition.outcomeTransform ?? 'none'
  const transformLabel: Record<
    Exclude<(typeof COLUMN_TRANSFORMS)[number], 'none'>,
    string
  > = { log10: 'log10', ln: 'ln' }
  const applyTransform = (
    value: number,
    kind: (typeof COLUMN_TRANSFORMS)[number],
  ): number | null => {
    if (kind === 'none') return value
    // A non-positive observation cannot exist in the fitted log space; the
    // execution kernel already refused these, so this is belt-and-braces.
    if (value <= 0) return null
    return TRANSFORM_FNS[kind](value)
  }

  const pairs: Array<{ x: number; y: number }> = []
  for (const row of input.rows) {
    const rawX = toNumberValue(row[definition.predictor.fieldId])
    const rawY = toNumberValue(row[definition.outcome.fieldId])
    if (rawX === null || rawY === null) continue
    const px = applyTransform(rawX, predictorTransform)
    const py = applyTransform(rawY, outcomeTransform)
    if (px !== null && py !== null) pairs.push({ x: px, y: py })
  }
  if (pairs.length === 0) return null
  const xs = pairs.map((p) => p.x)
  const min = Math.min(...xs)
  const max = Math.max(...xs)

  const observed = CHART_PALETTE[0].toLowerCase()
  const fitColor = CHART_PALETTE[1].toLowerCase()
  const xLabel =
    predictorTransform === 'none'
      ? 'Predictor'
      : `${transformLabel[predictorTransform]}(Predictor)`
  const yLabel =
    outcomeTransform === 'none'
      ? 'Outcome'
      : `${transformLabel[outcomeTransform]}(Outcome)`

  return {
    spec: {
      specVersion: 1,
      type: 'scatter',
      datasets: [],
      fields: {
        x: null,
        y: { fieldId: '' },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
      filters: [],
      transformations: [],
      typeParams: {},
      display: {
        axes: {
          x: { label: xLabel, scale: 'linear' },
          y: { label: yLabel, scale: 'linear' },
        },
        series: [
          { identifier: 'observed', label: 'Observed', color: '#006edc' },
          {
            identifier: 'fit',
            label: `Fit · ${fit.equation}`,
            color: '#00a659',
          },
        ],
        legend: { visible: true },
        annotations: [],
      },
      overlays: { errorBars: null },
    },
    materialised: {
      state: { kind: 'ok' },
      columns: [],
      rows: [],
      series: [
        {
          identifier: 'observed',
          label: 'Observed',
          color: observed,
          points: pairs.map((p) => ({
            x: p.x,
            y: p.y,
            yError: null,
            label: 'Observed',
          })),
        },
        {
          identifier: 'fit',
          label: `Fit · ${formatScientific(fit.r2)}`,
          color: fitColor,
          renderAs: 'line',
          points: regressionFitCurve(fit.coefficients, { min, max }).map(
            (pt) => ({ x: pt.x, y: pt.y, yError: null, label: 'Fit' }),
          ),
        },
      ],
      xLabel,
      yLabel,
      xUnit: undefined,
      yUnit: undefined,
      droppedPoints: 0,
    },
  }
}

function toNumberValue(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}
