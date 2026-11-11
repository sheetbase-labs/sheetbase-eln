import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import { Select } from '#/components/ui/select'
import { PreviewGrid } from '#/components/inventory/preview-grid'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { t } from '#/copy'
import { sciDataClient } from '#/lib/chart-data'
import type { CanonicalDatasetSource, ResolvedDataset } from '#/lib/chart-data'
import { filterRowsByFlags } from '#/lib/dataset-flags'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import type { DataClient } from '#/lib/data-client'
import { extensionQueryKeys, listExtensions } from '#/lib/extensions/client'
import { resolveRunnerPoints } from '#/lib/extensions/runner-points'
import type { RunnerItem } from '#/lib/extensions/runner-points'
import type { ExtensionAnalysisKindDeclaration } from '#/lib/extensions/points'
import {
  buildExtensionChart,
  extensionAnalysisNumber,
  readExtensionAnalysisResult,
} from './extension-analysis-result'
import type { ExtensionAnalysisOutcome } from './extension-analysis-result'

/**
 * Analyses an installed extension adds, offered beside the built-in ones in the
 * analysis studio. The person matches each input the extension declared to a
 * column of the chosen dataset and runs it; the rows go to the isolated Python
 * runner and the declared result comes back as a table and, when the extension
 * says how, a chart. Nothing is saved: it is a way to look at the data.
 */

type Kind = RunnerItem<ExtensionAnalysisKindDeclaration>

const NUMERIC = new Set(['decimal', 'integer'])
const CATEGORY = new Set(['category', 'text', 'boolean'])

export function ExtensionAnalysisSection({
  dataset,
  rows,
  flags,
  truncated,
  dataClient = sciDataClient,
}: {
  /** The chosen dataset's columns, or null before one is chosen. */
  dataset: CanonicalDatasetSource | null
  rows: ResolvedDataset['rows'] | undefined
  /** Values the lab flagged; they are left out, as in the built-in analyses. */
  flags?: DatasetValueFlag[]
  truncated: boolean
  dataClient?: DataClient
}) {
  const installs = useQuery({
    queryKey: [...extensionQueryKeys.extensions, 'analysis'],
    queryFn: () => listExtensions(dataClient),
    staleTime: 30_000,
  })

  const kinds = useMemo(
    () => resolveRunnerPoints(installs.data ?? []).analysisKinds,
    [installs.data],
  )

  const [activeName, setActiveName] = useState<string | null>(null)
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const active: Kind | undefined = kinds.find((k) => k.name === activeName)

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- This runs an ephemeral Python calculation and audits it; no dataset or saved analysis changes, so no dataset/analysis query becomes stale. HTTP success/refusal tests cover the returned action state.
  const run = useMutation<ExtensionAnalysisOutcome, Error, void>({
    mutationFn: async () => {
      if (!active || !rows) throw new Error(t('plugins.analysis.needsDataset'))

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
                  ? extensionAnalysisNumber(row[bindings[input.name]])
                  : (row[bindings[input.name]] ?? null),
              ]),
          ),
        ),
      }

      const response = await fetch('/api/plugins/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      return readExtensionAnalysisResult(response)
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
          {t('plugins.analysis.heading')}
        </h3>
        <p className="text-xs text-fg-muted">{t('plugins.analysis.intro')}</p>
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
              (input.type === 'number' ? NUMERIC : CATEGORY).has(
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
                      ? t('plugins.analysis.pickColumn')
                      : t('plugins.analysis.notNeeded')}
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
              ? t('plugins.analysis.running')
              : t('plugins.analysis.run')}
          </Button>
        </div>
      ) : null}
      {active && truncated ? (
        <p role="status" className="text-xs text-fg-muted">
          {t('plugins.analysis.truncated')}
        </p>
      ) : null}
      {run.isError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-danger-text"
        >
          {t('plugins.analysis.failed', { reason: run.error.message })}
        </div>
      ) : null}
      {run.data && active ? (
        <ExtensionAnalysisResult outcome={run.data} kind={active} />
      ) : null}
    </section>
  )
}

function ExtensionAnalysisResult({
  outcome,
  kind,
}: {
  outcome: ExtensionAnalysisOutcome
  kind: Kind
}) {
  const chart = buildExtensionChart(outcome)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-fg-muted">
        {t('plugins.analysis.resultFrom', {
          name: kind.declaration.title,
        })}{' '}
        · {t('plugins.analysis.timing', { ms: outcome.durationMs })}
      </p>
      {chart ? (
        <div className="rounded-md border p-2">
          <ChartRenderer
            title={kind.declaration.title}
            hideTitle
            spec={chart.spec}
            materialised={chart.materialised}
            frozen={null}
            showTableAlternative={false}
            plotHeight={220}
          />
        </div>
      ) : null}
      {outcome.rows.length === 0 ? (
        <p className="text-xs text-fg-muted">{t('plugins.analysis.noRows')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <PreviewGrid
            label={kind.declaration.title}
            columns={outcome.columns.map((column) => column.name)}
            rows={outcome.rows.slice(0, 200).map((row) =>
              Object.fromEntries(
                outcome.columns.map((column) => [
                  column.name,
                  String(row[column.name] ?? '—'),
                ]),
              ),
            )}
            numericColumns={outcome.columns
              .filter((column) => column.type === 'number')
              .map((column) => column.name)}
            maxHeight={320}
          />
        </div>
      )}
    </div>
  )
}
