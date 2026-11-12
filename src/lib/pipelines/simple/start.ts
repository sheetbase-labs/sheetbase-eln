import { RECIPE_SOURCE_INPUT, START_EVENT_TYPES } from './recipe'
import type { PipelineRecipe } from './recipe'
import type { PipelineScheduleWire } from '../types'

type StoredStart = Pick<PipelineScheduleWire, 'kind' | 'spec'>

/** What the scheduler reads from a start: a trigger event, or a cron line and its zone. */
export type StartSpec = {
  eventType?: string
  datasetId?: string
  instrumentId?: string
  inputName?: string
  missedRunPolicy?: string
  cron?: string
  timeZone?: string
}

/** The schedule that makes a recipe start by itself. */
export interface StartPlan {
  kind: 'event' | 'cron'
  spec: StartSpec
}

/**
 * What the recipe's When line asks the scheduler for: a snapshot of a dataset
 * (from an instrument, when one is named), a failed run, a decided review, or a
 * weekday at 9:00 in the given time zone. Nothing until the choices are made.
 */
export function startPlan(
  recipe: PipelineRecipe,
  timeZone: string,
): StartPlan | null {
  const { event, datasetId, instrumentId, weekday } = recipe.when

  if (event === 'weekly')
    return {
      kind: 'cron',
      spec: { cron: `0 9 * * ${weekday ?? 1}`, timeZone },
    }

  if (event)
    return { kind: 'event', spec: { eventType: START_EVENT_TYPES[event] } }

  if (!datasetId) return null

  const spec = {
    eventType: 'dataset.versioned',
    datasetId,
    inputName: RECIPE_SOURCE_INPUT,
    missedRunPolicy: 'run_once',
  }

  return {
    kind: 'event',
    spec: instrumentId ? { ...spec, instrumentId } : spec,
  }
}

/** Whether a stored schedule already starts the recipe the way its When line says. */
export function startsRecipe(
  stored: StoredStart,
  recipe: PipelineRecipe,
): boolean {
  const { event, datasetId, instrumentId, weekday } = recipe.when

  if (event === 'weekly')
    return (
      stored.kind === 'cron' && stored.spec.cron === `0 9 * * ${weekday ?? 1}`
    )

  if (event)
    return (
      stored.kind === 'event' &&
      stored.spec.eventType === START_EVENT_TYPES[event]
    )

  return (
    stored.kind === 'event' &&
    stored.spec.eventType === 'dataset.versioned' &&
    stored.spec.datasetId === datasetId &&
    (stored.spec.instrumentId ?? undefined) === instrumentId
  )
}
