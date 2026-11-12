import { useState } from 'react'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'

import { cn } from '#/lib/utils'
import { Avatar } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Muted } from '#/components/ui/layout'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { t } from '#/copy'
import { words } from '#/lib/pipelines/simple/words'
import { formatTime } from '#/lib/format-date'
import { tryPipelineDraft } from '#/lib/pipelines/data'
import { explainRunError } from '#/lib/pipelines/run-errors'
import {
  allRowsConfig,
  matchOnlyConfig,
  stripConfig,
} from '#/lib/pipelines/simple/compile'
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
  /** Points for the strip: where each row sits in the snapshot, its value and whether it matched. */
  strip: StripPoint[]
}

interface StripPoint {
  place: number
  of: number
  value: number
  hit: boolean
}

interface Would {
  icon: IconName
  /** A person this line is about; shown as their avatar. */
  person?: string
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
          person: people[action.userId],
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

/** The rows that matched, a few columns wide; the column the condition is about stands out. */
function MatchTable({
  preview,
  hitColumn,
  unit,
}: {
  preview: ResultPreview
  hitColumn: string
  unit?: string
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse text-[12px] tabular-nums">
        <thead>
          <tr className="bg-surface-muted text-left text-fg-muted">
            {preview.columns.map((column) => (
              <th
                key={column}
                className={cn(
                  'h-7 px-2 font-medium',
                  column === hitColumn && 'text-right',
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, index) => (
            <tr key={index} className="border-t border-border-subtle">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    'h-7 px-2',
                    preview.columns[cellIndex] === hitColumn &&
                      'text-right font-semibold text-warning-text',
                  )}
                >
                  {cell === null ? '—' : String(cell)}
                  {preview.columns[cellIndex] === hitColumn && unit
                    ? ` ${unit}`
                    : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.truncated ? (
        <p className="m-0 border-t border-border-subtle px-2 py-1 text-[11px] text-fg-muted">
          {d('firstRows', {
            shown: preview.rows.length,
            total: preview.rowCount,
          })}
        </p>
      ) : null}
    </div>
  )
}

/** The strip's points out of the sampled rows: value, place in the snapshot, hit or not. */
function stripPoints(preview: ResultPreview): StripPoint[] {
  const at = (name: string) => preview.columns.indexOf(name)
  const [v, hit, rn, n] = ['v', 'hit', 'rn', 'n'].map(at)

  return preview.rows.flatMap((row) => {
    const value = Number(row[v])
    const place = Number(row[rn])
    const of = Number(row[n])

    return Number.isFinite(value) && Number.isFinite(place) && of > 0
      ? [{ value, place, of, hit: row[hit] === true }]
      : []
  })
}

/** The condition value the strip draws its reference line at. */
function thresholdOf(
  recipe: PipelineRecipe,
): { value: number; label: string } | null {
  for (const condition of recipe.conditions) {
    const value = z.number().safeParse(condition.value)

    if (value.success)
      return {
        value: value.data,
        label: `${value.data}${condition.unit ? ` ${condition.unit}` : ''}`,
      }
  }

  return null
}

/** Every sampled row as a dot in order, the matching ones in the warning colour, with the limit as a dashed line. */
function Strip({
  points,
  threshold,
  column,
}: {
  points: StripPoint[]
  threshold: { value: number; label: string }
  column: string
}) {
  if (points.length === 0 || threshold.value <= 0) return null

  const scale = 30 / threshold.value
  const y = (value: number) => Math.max(6, Math.min(52.5, 54 - value * scale))

  return (
    <svg
      className="my-2.5 mb-1 block overflow-visible"
      width="100%"
      viewBox="0 0 278 64"
      role="img"
      aria-label={d('stripLabel', { column, count: points.at(0)?.of ?? 0 })}
    >
      <line
        x1="0"
        x2="278"
        y1="24"
        y2="24"
        className="stroke-border-strong"
        strokeDasharray="3 3"
      />
      <text x="0" y="21" className="fill-fg-muted font-sans text-[10px]">
        {threshold.label}
      </text>
      <line x1="0" x2="278" y1="54" y2="54" className="stroke-border" />
      {points.map((point) => (
        <circle
          key={point.place}
          cx={4 + ((point.place - 1) / Math.max(1, point.of - 1)) * 270}
          cy={y(point.value)}
          r={point.hit ? 3 : 1.9}
          className={point.hit ? 'fill-warning' : 'fill-fg-faint'}
        />
      ))}
      <text x="0" y="63" className="fill-fg-muted font-sans text-[10px]">
        {d('rowFirst')}
      </text>
      <text
        x="278"
        y="63"
        textAnchor="end"
        className="fill-fg-muted font-sans text-[10px]"
      >
        {d('rowLast', { count: points.at(0)?.of ?? 0 })}
      </text>
    </svg>
  )
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

      const strip = stripConfig(recipe)

      const [matched, all, points] = await Promise.all([
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
        strip
          ? tryPipelineDraft({
              workspaceId,
              configuration: strip,
              inputVersions,
              parameters,
            })
          : Promise.resolve(null),
      ])

      if (!matched.ok)
        return {
          recipeKey,
          snapshotLabel: latest.label,
          matched: { columns: [], rows: [], rowCount: 0, truncated: false },
          total: 0,
          failure:
            matched.errorMessage || explainRunError(matched.errorCode).title,
          strip: [],
        }

      return {
        recipeKey,
        snapshotLabel: latest.label,
        matched: matched.preview,
        total: all.ok ? all.preview.rowCount : matched.preview.rowCount,
        failure: null,
        strip: points?.ok ? stripPoints(points.preview) : [],
      }
    },
    onSuccess: setResult,
  })

  const stale = result !== null && result.recipeKey !== recipeKey
  const threshold = thresholdOf(recipe)
  const conditionColumn = recipe.conditions.at(0)?.column ?? ''

  return (
    <>
      <section aria-labelledby="simple-dry" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2
            id="simple-dry"
            className="m-0 min-w-0 grow truncate font-sans text-[14px] font-semibold"
          >
            {result
              ? d('title', { snapshot: result.snapshotLabel })
              : d('start')}
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
              <p className="mx-0 mb-0.5 mt-1 font-heading text-[20px] font-semibold leading-[26px] tabular-nums">
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
            {threshold ? (
              <Strip
                points={result.strip}
                threshold={threshold}
                column={conditionColumn}
              />
            ) : null}
            {result.matched.columns.length ? (
              <MatchTable
                preview={trimmed(result.matched, recipe)}
                hitColumn={conditionColumn}
                unit={recipe.conditions.at(0)?.unit}
              />
            ) : null}
          </>
        ) : null}
      </section>
      {result && !result.failure ? (
        <WouldHappen
          result={{
            matched: result.matched.rowCount,
            total: result.total,
            snapshotLabel: result.snapshotLabel,
          }}
          recipe={recipe}
          people={people}
          destinations={destinations}
          datasetName={datasetName}
        />
      ) : null}
    </>
  )
}

/** What each line of the recipe would do with the rows that matched; nothing runs. */
function WouldHappen({
  result,
  recipe,
  people,
  destinations,
  datasetName,
}: {
  result: { matched: number; total: number; snapshotLabel: string }
  recipe: PipelineRecipe
  people: Record<string, string>
  destinations: (id: string) => string
  datasetName: (id: string) => string
}) {
  return (
    <section aria-labelledby="simple-would">
      <h3
        id="simple-would"
        className="m-0 mb-2 font-sans text-[12px] font-semibold"
      >
        {d('would')}
      </h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {wouldList(
          recipe,
          result.matched,
          result.total,
          people,
          destinations,
          datasetName,
        ).map((item, index) => (
          <li
            key={index}
            className="grid min-h-8 grid-cols-[22px_1fr_auto] items-center gap-2 border-b border-border-subtle text-[12px] last:border-b-0"
          >
            {item.person ? (
              <Avatar
                name={item.person}
                size="xs"
                tone="review"
                className="justify-self-center"
              />
            ) : (
              <Icon
                name={item.icon}
                size={14}
                className="justify-self-center text-fg-muted"
              />
            )}
            <span>{item.text}</span>
            <span className="text-[11px] text-fg-muted">{item.policy}</span>
          </li>
        ))}
      </ul>
      <Notice tone="info" icon={false} className="mt-2.5">
        {d('nothing', { snapshot: result.snapshotLabel })}
      </Notice>
    </section>
  )
}
