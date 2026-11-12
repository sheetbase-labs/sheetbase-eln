import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Muted } from '#/components/ui/layout'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { PreviewTable } from '#/components/pipelines/preview-table'
import { t } from '#/copy'
import { words } from '#/lib/pipelines/simple/words'
import { formatTime } from '#/lib/format-date'
import { tryPipelineDraft } from '#/lib/pipelines/data'
import { explainRunError } from '#/lib/pipelines/run-errors'
import { allRowsConfig, matchOnlyConfig } from '#/lib/pipelines/simple/compile'
import { RECIPE_SOURCE_INPUT } from '#/lib/pipelines/simple/recipe'
import type {
  PipelineRecipe,
  RecipeAction,
} from '#/lib/pipelines/simple/recipe'
import type { ResultPreview } from '#/lib/pipelines/result-preview'
import { useLatestSnapshot } from './use-simple-data'

const d = words('dry')

interface DryRunResult {
  /** The recipe, as JSON, that this answer is for. */
  recipeKey: string
  snapshotLabel: string
  matched: ResultPreview
  total: number
  failure: string | null
}

interface Would {
  icon: IconName
  text: string
  policy: string
}

/** What each line of the recipe would do with the rows that matched. Nothing runs. */
function wouldList(
  recipe: PipelineRecipe,
  matched: number,
  total: number,
  people: Record<string, string>,
  destinations: (id: string) => string,
  datasetName: (id: string) => string,
): Would[] {
  const rows = (n: number) =>
    t('features.pipelineSimple.dry.flagRows', { count: n })

  return recipe.actions.map((action: RecipeAction): Would => {
    switch (action.kind) {
      case 'flag_rows':
        return {
          icon: 'warn',
          text: d('flag', { count: matched, rows: rows(matched) }),
          policy: t('features.pipelineSimple.catalogue.auto'),
        }
      case 'check_range':
        return {
          icon: 'filter',
          text: d('check', { column: action.column }),
          policy: t('features.pipelineSimple.catalogue.auto'),
        }
      case 'ask':
        return {
          icon: 'user',
          text: d(action.mode === 'confirm' ? 'ask' : 'askChoose', {
            person: people[action.userId] ?? '—',
            count: matched,
            rows: rows(matched),
          }),
          policy: d('waits'),
        }
      case 'notify':
        return {
          icon: 'comment',
          text: d('notify', { where: destinations(action.subscriptionId) }),
          policy: t('features.pipelineSimple.catalogue.auto'),
        }
      case 'eln_action':
        return {
          icon: 'link',
          text: d('action', {
            action: action.operation.replaceAll('_', ' '),
            count: matched,
            rows: rows(matched),
          }),
          policy:
            action.mode === 'propose'
              ? t('features.pipelineSimple.catalogue.propose')
              : t('features.pipelineSimple.catalogue.perPolicy'),
        }
      case 'append':
        return {
          icon: 'download',
          text: d('append', {
            count: total,
            dataset: datasetName(action.datasetId),
          }),
          policy: t('features.pipelineSimple.catalogue.auto'),
        }
      case 'create':
        return {
          icon: 'plus',
          text: d('create', { count: total, dataset: action.datasetName }),
          policy: t('features.pipelineSimple.catalogue.auto'),
        }
    }
  })
}

/** A few columns and rows: the ones the conditions are about, then the first ones. */
function trimmed(
  preview: ResultPreview,
  recipe: PipelineRecipe,
): ResultPreview {
  const wanted = new Set(recipe.conditions.map((c) => c.column))

  // The run's own bookkeeping columns say nothing to a person reading the rows.
  const shown = preview.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !column.startsWith('_sb_'))

  const order = [
    ...shown.filter(({ column }) => !wanted.has(column)).slice(0, 2),
    ...shown.filter(({ column }) => wanted.has(column)),
  ]
    .map(({ index }) => index)
    .slice(0, 4)
    .sort((a, b) => a - b)

  return {
    columns: order.map((i) => preview.columns[i]),
    rows: preview.rows.slice(0, 5).map((row) => order.map((i) => row[i])),
    rowCount: preview.rowCount,
    truncated: preview.rowCount > 5,
  }
}

/**
 * A dry run of the draft on the dataset's latest snapshot: which rows match
 * the conditions and what each line would then do. It reads a temporary copy,
 * flags, saves and sends nothing, and never counts as a run.
 */
export function DryRunPanel({
  workspaceId,
  recipe,
  complete,
  datasetLabel,
  people,
  destinations,
  datasetName,
}: {
  workspaceId: string
  recipe: PipelineRecipe
  /** The recipe has every choice made. */
  complete: boolean
  datasetLabel: string
  people: Record<string, string>
  destinations: (id: string) => string
  datasetName: (id: string) => string
}) {
  const snapshot = useLatestSnapshot(recipe.when.datasetId)
  const [result, setResult] = useState<DryRunResult | null>(null)
  const recipeKey = JSON.stringify(recipe)

  const run = useMutation({
    mutationFn: async (): Promise<DryRunResult> => {
      const latest = snapshot.data

      if (!latest) throw new Error(d('noSnapshot'))
      const inputVersions = { [RECIPE_SOURCE_INPUT]: latest.id }

      const matchConfig = matchOnlyConfig(recipe)

      // The values the recipe set are the parameters' defaults; a try is told them.
      const parameters = Object.fromEntries(
        matchConfig.parameters.flatMap((parameter) =>
          parameter.default === undefined
            ? []
            : [[parameter.name, parameter.default]],
        ),
      )

      const [matched, all] = await Promise.all([
        tryPipelineDraft({
          workspaceId,
          configuration: matchConfig,
          inputVersions,
          parameters,
        }),
        tryPipelineDraft({
          workspaceId,
          configuration: allRowsConfig(),
          inputVersions,
          parameters: {},
        }),
      ])

      if (!matched.ok)
        return {
          recipeKey,
          snapshotLabel: latest.label,
          matched: { columns: [], rows: [], rowCount: 0, truncated: false },
          total: 0,
          failure:
            matched.errorMessage || explainRunError(matched.errorCode).title,
        }

      return {
        recipeKey,
        snapshotLabel: latest.label,
        matched: matched.preview,
        total: all.ok ? all.preview.rowCount : matched.preview.rowCount,
        failure: null,
      }
    },
    onSuccess: setResult,
  })

  const stale = result !== null && result.recipeKey !== recipeKey

  return (
    <section aria-labelledby="simple-dry" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2
          id="simple-dry"
          className="m-0 min-w-0 grow truncate font-sans text-body font-semibold"
        >
          {result ? d('title', { snapshot: result.snapshotLabel }) : d('start')}
        </h2>
        <Button
          size="sm"
          variant="quiet"
          icon="play"
          disabled={!complete || run.isPending || !snapshot.data}
          onClick={() => run.mutate()}
        >
          {run.isPending ? d('trying') : result ? d('tryAgain') : d('start')}
        </Button>
      </div>
      {!complete ? <Muted>{d('empty')}</Muted> : null}
      {complete && snapshot.isSuccess && !snapshot.data ? (
        <Muted>{d('noSnapshot')}</Muted>
      ) : null}
      {run.isError ? (
        <Notice tone="warn" icon="warn">
          {d('failed', {
            message: run.error instanceof Error ? run.error.message : '',
          })}
        </Notice>
      ) : null}
      {result?.failure ? (
        <Notice tone="warn" icon="warn">
          {d('failed', { message: result.failure })}
        </Notice>
      ) : null}
      {result && !result.failure ? (
        <>
          {stale ? (
            <Muted className="text-warn-text">{d('stale')}</Muted>
          ) : null}
          <div>
            <p className="m-0 font-heading text-[20px] font-semibold leading-[26px] tabular-nums">
              {d('matchOf', {
                matched: result.matched.rowCount,
                total: result.total,
              })}
            </p>
            <Muted>
              {d('latest')} {result.snapshotLabel}
              {snapshot.data
                ? `, ${formatTime(snapshot.data.createdAt)}`
                : ''}{' '}
              · {datasetLabel}
            </Muted>
          </div>
          {result.matched.columns.length ? (
            <PreviewTable preview={trimmed(result.matched, recipe)} />
          ) : null}
          <div>
            <h3 className="m-0 mb-1 font-sans text-label font-semibold">
              {d('would')}
            </h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {wouldList(
                recipe,
                result.matched.rowCount,
                result.total,
                people,
                destinations,
                datasetName,
              ).map((item, index) => (
                <li
                  key={index}
                  className="grid min-h-8 grid-cols-[22px_1fr_auto] items-center gap-2 border-b border-border-subtle text-caption last:border-b-0"
                >
                  <Icon
                    name={item.icon}
                    size={14}
                    className="justify-self-center text-fg-muted"
                  />
                  <span>{item.text}</span>
                  <span className="text-[11px] text-fg-muted">
                    {item.policy}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <Muted>{d('nothing', { snapshot: result.snapshotLabel })}</Muted>
        </>
      ) : null}
    </section>
  )
}
