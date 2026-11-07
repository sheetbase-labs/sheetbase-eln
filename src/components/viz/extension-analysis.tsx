import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import { Select } from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { t } from '#/copy'
import { sciDataClient } from '#/lib/chart-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import type { ChartSpec, MaterialisedChart } from '#/lib/chart-spec'
import { filterRowsByFlags } from '#/lib/dataset-flags'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import { extensionQueryKeys, listExtensions } from '#/lib/extensions/client'
import { resolveRunnerPoints } from '#/lib/extensions/runner-points'
import type { RunnerItem } from '#/lib/extensions/runner-points'
import type { ExtensionAnalysisKindDeclaration } from '#/lib/extensions/points'

/**
 * Analyses an installed extension adds, offered beside the built-in ones in the
 * analysis studio. The person matches each input the extension declared to a
 * column of the chosen dataset and runs it; the rows go to the isolated Python
 * runner and the declared result comes back as a table and, when the extension
 * says how, a chart. Nothing is saved: it is a way to look at the data.
 */

type Kind = RunnerItem<ExtensionAnalysisKindDeclaration>

interface Outcome {
  columns: ExtensionAnalysisKindDeclaration['result']['columns']
  rows: Array<Record<string, unknown>>
  chart: ExtensionAnalysisKindDeclaration['result']['chart'] | null
  durationMs: number
}

const NUMERIC = ['decimal', 'integer']
const CATEGORY = ['category', 'text', 'boolean']

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** The chart the extension declared, built from its result rows. */
export function buildExtensionChart(outcome: Outcome): {
  spec: ChartSpec
  materialised: MaterialisedChart
} | null {
  const chart = outcome.chart
  if (!chart || outcome.rows.length === 0) return null
  const xIsText =
    outcome.columns.find((column) => column.name === chart.x)?.type === 'text'
  const groups = new Map<string, Array<Record<string, unknown>>>()
  for (const row of outcome.rows) {
    const key = chart.group ? String(row[chart.group] ?? '') : ''
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const colours = [
    'var(--series-a)',
    'var(--series-b)',
    'var(--series-c)',
    'var(--series-d)',
  ]
  const series = [...groups.entries()].map(([group, rows], index) => ({
    identifier: group || 'result',
    label: group || chart.y,
    color: colours[index % colours.length],
    points: rows.map((row, position) => ({
      x: xIsText ? position + 1 : numberOrNull(row[chart.x]),
      y: numberOrNull(row[chart.y]),
      yError: null,
      label: xIsText ? String(row[chart.x] ?? '') : group || chart.y,
    })),
  }))
  return {
    spec: {
      specVersion: 1,
      type: chart.type,
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
          x: { label: chart.x, scale: 'linear' },
          y: { label: chart.y, scale: 'linear' },
        },
        series: series.map((s) => ({
          identifier: s.identifier,
          label: s.label,
          color: s.color,
        })),
        legend: { visible: series.length > 1 },
        annotations: [],
      },
      overlays: { errorBars: null },
    },
    materialised: {
      state: { kind: 'ok' },
      columns: [],
      rows: [],
      series,
      xLabel: chart.x,
      yLabel: chart.y,
      xUnit: undefined,
      yUnit: undefined,
      droppedPoints: 0,
    },
  }
}

export function ExtensionAnalysisSection({
  dataset,
  rows,
  flags,
  truncated,
}: {
  /** The chosen dataset's columns, or null before one is chosen. */
  dataset: CanonicalDatasetSource | null
  rows: Array<Record<string, unknown>> | undefined
  /** Values the lab flagged; they are left out, as in the built-in analyses. */
  flags?: DatasetValueFlag[]
  truncated: boolean
}) {
  const installs = useQuery({
    queryKey: [...extensionQueryKeys.extensions, 'analysis'],
    queryFn: () => listExtensions(sciDataClient),
    staleTime: 30_000,
  })
  const kinds = useMemo(
    () => resolveRunnerPoints(installs.data ?? []).analysisKinds,
    [installs.data],
  )
  const [activeName, setActiveName] = useState<string | null>(null)
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const active: Kind | undefined = kinds.find((k) => k.name === activeName)

  const run = useMutation<Outcome, Error, void>({
    mutationFn: async () => {
      if (!active || !rows)
        throw new Error(t('extensions.analysis.needsDataset'))
      const body = {
        kind: 'analysis',
        extensionKey: active.extensionKey,
        kindId: active.id,
        // The declared input names, so the extension never sees the dataset's own column ids.
        rows: filterRowsByFlags(
          rows,
          flags ?? [],
          Object.values(bindings).filter(Boolean),
        ).map((row) =>
          Object.fromEntries(
            active.declaration.inputs
              .filter((input) => bindings[input.name])
              .map((input) => [
                input.name,
                input.type === 'number'
                  ? numberOrNull(row[bindings[input.name]])
                  : (row[bindings[input.name]] ?? null),
              ]),
          ),
        ),
      }
      const response = await fetch('/api/extensions/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const answer = (await response.json().catch(() => null)) as
        (Outcome & { error?: string }) | null
      if (!response.ok || !answer)
        throw new Error(answer?.error ?? t('common.errors.generic'))
      return answer
    },
  })

  if (kinds.length === 0) return null

  const columns = dataset?.columns ?? []
  const ready =
    active !== undefined &&
    dataset !== null &&
    rows !== undefined &&
    !truncated &&
    active.declaration.inputs.every(
      (input) => !input.required || Boolean(bindings[input.name]),
    )
  const chart = run.data ? buildExtensionChart(run.data) : null

  return (
    <section
      aria-labelledby="extension-analysis-heading"
      className="flex flex-col gap-3 rounded-md border p-3"
    >
      <div>
        <h3
          id="extension-analysis-heading"
          className="text-body font-semibold text-fg"
        >
          {t('extensions.analysis.heading')}
        </h3>
        <p className="text-xs text-fg-muted">
          {t('extensions.analysis.intro')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {kinds.map((kind) => (
          <Button
            key={kind.name}
            type="button"
            size="sm"
            variant={activeName === kind.name ? 'primary' : 'secondary'}
            aria-pressed={activeName === kind.name}
            title={`${kind.declaration.description ?? kind.declaration.title} (${kind.extensionName})`}
            onClick={() => {
              setActiveName(kind.name)
              setBindings({})
              run.reset()
            }}
          >
            <Icon name="sigma" className="size-3.5" aria-hidden />
            {kind.declaration.title}
          </Button>
        ))}
      </div>
      {active ? (
        <div className="flex flex-wrap items-end gap-3">
          {active.declaration.inputs.map((input) => {
            const options = columns.filter((column) =>
              (input.type === 'number' ? NUMERIC : CATEGORY).includes(
                column.logicalType,
              ),
            )
            const id = `extension-input-${input.name}`
            return (
              <div
                key={input.name}
                className="flex min-w-36 flex-1 flex-col gap-1"
              >
                <label className="text-label text-fg-muted" htmlFor={id}>
                  {input.label}
                </label>
                <Select
                  id={id}
                  size="sm"
                  value={bindings[input.name] ?? ''}
                  onChange={(event) =>
                    setBindings((prev) => ({
                      ...prev,
                      [input.name]: event.target.value,
                    }))
                  }
                  className="bg-surface"
                >
                  <option value="">
                    {input.required
                      ? t('extensions.analysis.pickColumn')
                      : t('extensions.analysis.notNeeded')}
                  </option>
                  {options.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.label}
                    </option>
                  ))}
                </Select>
              </div>
            )
          })}
          <Button
            type="button"
            size="sm"
            disabled={!ready || run.isPending}
            onClick={() => run.mutate()}
          >
            <Icon name="play" />{' '}
            {run.isPending
              ? t('extensions.analysis.running')
              : t('extensions.analysis.run')}
          </Button>
        </div>
      ) : null}
      {active && truncated ? (
        <p role="status" className="text-xs text-fg-muted">
          {t('extensions.analysis.truncated')}
        </p>
      ) : null}
      {run.isError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-danger-text"
        >
          {t('extensions.analysis.failed', { reason: run.error.message })}
        </div>
      ) : null}
      {run.data && active ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium text-fg-muted">
            {t('extensions.analysis.resultFrom', {
              name: active.declaration.title,
            })}{' '}
            · {t('extensions.analysis.timing', { ms: run.data.durationMs })}
          </p>
          {chart ? (
            <div className="rounded-md border p-2">
              <ChartRenderer
                title={active.declaration.title}
                hideTitle
                spec={chart.spec}
                materialised={chart.materialised}
                frozen={null}
                showTableAlternative={false}
                plotHeight={220}
              />
            </div>
          ) : null}
          {run.data.rows.length === 0 ? (
            <p className="text-xs text-fg-muted">
              {t('extensions.analysis.noRows')}
            </p>
          ) : (
            <div className="max-h-80 overflow-auto rounded-md border">
              <Table>
                <caption className="sr-only">
                  {active.declaration.title}
                </caption>
                <TableHeader>
                  <TableRow>
                    {run.data.columns.map((column) => (
                      <TableHead key={column.name} scope="col">
                        {column.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.data.rows.slice(0, 200).map((row, index) => (
                    <TableRow key={index}>
                      {run.data.columns.map((column) => (
                        <TableCell
                          key={column.name}
                          className={
                            column.type === 'number'
                              ? 'font-mono tabular-nums'
                              : undefined
                          }
                        >
                          {row[column.name] === null ||
                          row[column.name] === undefined
                            ? '—'
                            : String(row[column.name])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
