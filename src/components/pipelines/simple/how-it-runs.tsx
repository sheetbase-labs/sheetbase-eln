import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/sonner'
import {
  pipelineDataQueryKeys,
  useSchedules,
} from '#/components/pipelines/pipelines-data'
import { words } from '#/lib/pipelines/simple/words'
import { notebookDataClient } from '#/lib/notebook-data'
import { createPipelineSchedule } from '#/lib/pipelines/data'
import { startPlan, startsRecipe } from '#/lib/pipelines/simple/start'
import type { PipelineRecipe } from '#/lib/pipelines/simple/recipe'
import { TokenInput, TokenSelect } from './token'

const h = words('how')

/** The When line in words, as a pipeline that already starts that way says it. */
function startsText(recipe: PipelineRecipe, datasetLabel: string): string {
  const { event, weekday } = recipe.when

  if (event === 'weekly')
    return h('startsWeekly', {
      day: words('recipe.days')(String(weekday ?? 1)),
    })

  if (event) return h('startsEvent', { event: words('recipe.start')(event) })

  return h('startsSnapshot', { dataset: datasetLabel })
}

/**
 * How the pipeline starts and what a run does about the rest: batching and the
 * run-going rule live with Starts and runs; this says them in words and, for
 * the snapshot the recipe reads, can add the start that listens for it.
 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- the starts, the run rule and the away choice are one card over one recipe.
export function HowItRuns({
  pipelineId,
  workspaceId,
  recipe,
  datasetLabel,
  pipelineLink,
  onChange,
  readOnly = false,
}: {
  pipelineId: string
  workspaceId: string
  recipe: PipelineRecipe
  datasetLabel: string
  /** Where Starts and runs lives; Triggers until that tab lands. */
  pipelineLink: string
  onChange?: (recipe: PipelineRecipe) => void
  readOnly?: boolean
}) {
  const schedules = useSchedules(pipelineId)
  const queryClient = useQueryClient()
  const ask = recipe.actions.find((a) => a.kind === 'ask')

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const plan = startPlan(recipe, timeZone)

  const listening = (schedules.data ?? []).some((s) => startsRecipe(s, recipe))

  const addStart = useMutation({
    mutationFn: () => {
      if (!plan) throw new Error(h('startNone'))

      return createPipelineSchedule(notebookDataClient, {
        workspaceId,
        definitionId: pipelineId,
        kind: plan.kind,
        spec: plan.spec,
      })
    },
    onSuccess: () => {
      toast(h('startAdded'))
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.schedules(pipelineId),
      })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : h('startNone')),
  })

  return (
    <section
      aria-labelledby="simple-how"
      className="rounded-lg border border-border bg-surface px-4 py-3.5"
    >
      <div className="mb-2 flex items-center">
        <h3
          id="simple-how"
          className="m-0 grow font-sans text-label font-semibold"
        >
          {h('title')}
        </h3>
        <Link to={pipelineLink} className="text-caption">
          {h('change')}
        </Link>
      </div>
      <dl className="m-0 grid grid-cols-[132px_1fr] gap-y-2 text-label max-md:grid-cols-1">
        <dt className="text-fg-muted">{h('starts')}</dt>
        <dd className="m-0">
          {listening ? (
            startsText(recipe, datasetLabel)
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              {h('startsNone')}
              {plan ? (
                <Button
                  size="sm"
                  disabled={addStart.isPending}
                  onClick={() => addStart.mutate()}
                >
                  {addStart.isPending ? h('addingStart') : h('addStart')}
                </Button>
              ) : null}
            </span>
          )}
        </dd>
        <dt className="text-fg-muted">{h('runGoing')}</dt>
        <dd className="m-0">{h('runGoingText')}</dd>
        {ask ? (
          <>
            <dt className="text-fg-muted">{h('away')}</dt>
            <dd className="m-0 flex flex-wrap items-center gap-1.5">
              {readOnly || !onChange ? (
                ask.noAnswer === 'reask' ? (
                  h('awayReask', { hours: ask.hours })
                ) : (
                  h('awayFail', { hours: ask.hours })
                )
              ) : (
                <>
                  <TokenSelect
                    label={h('awayChoice')}
                    value={ask.noAnswer}
                    placeholder=""
                    options={[
                      { value: 'reask', label: h('awayReaskShort') },
                      { value: 'fail', label: h('awayFailShort') },
                    ]}
                    onChange={(noAnswer) =>
                      onChange({
                        ...recipe,
                        actions: recipe.actions.map((a) =>
                          a.kind === 'ask'
                            ? // SAFETY: the select offers only these two choices.
                              { ...a, noAnswer: noAnswer as 'reask' | 'fail' }
                            : a,
                        ),
                      })
                    }
                  />
                  <span>{h('awayAfter')}</span>
                  <TokenInput
                    label={h('awayHours')}
                    type="number"
                    value={String(ask.hours)}
                    suffix="h"
                    onChange={(value) =>
                      onChange({
                        ...recipe,
                        actions: recipe.actions.map((a) =>
                          a.kind === 'ask'
                            ? {
                                ...a,
                                hours: Math.min(
                                  168,
                                  Math.max(1, Math.round(Number(value) || 1)),
                                ),
                              }
                            : a,
                        ),
                      })
                    }
                  />
                  <span>
                    {ask.noAnswer === 'reask' ? h('awayThenStop') : ''}
                  </span>
                </>
              )}
            </dd>
          </>
        ) : null}
        <dt className="text-fg-muted">{h('every')}</dt>
        <dd className="m-0">{h('everyText')}</dd>
      </dl>
    </section>
  )
}
