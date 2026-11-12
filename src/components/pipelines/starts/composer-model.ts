import { t } from '#/copy'
import type { IconName } from '#/components/icons'
import type { StartRules } from '#/lib/pipelines/start-rules'
import { startKind } from '#/lib/pipelines/starts-view'
import type { StartKind } from '#/lib/pipelines/starts-view'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

import type { StartWay } from './starts-readback'

export const DEFAULT_WINDOW = {
  days: 'weekdays',
  from: '07:00',
  to: '19:00',
  timeZone: 'Europe/London',
} as const

export const KIND_ICON: Record<StartKind | 'webhook', IconName> = {
  snapshot: 'database',
  event: 'link',
  schedule: 'clock',
  webhook: 'webhook',
}

export function numberOrNull(raw: string): number | null {
  const value = Number(raw)

  return raw.trim() !== '' && Number.isInteger(value) ? value : null
}

export interface RuleProblems {
  window?: string
  rows?: string
  wait?: string
}

/** Problems a person can fix before saving; the database checks the same. */
export function ruleProblems(
  rules: StartRules,
  rowsText: string,
  waitText: string,
): RuleProblems {
  const problems: RuleProblems = {}

  if (rules.window && rules.window.from >= rules.window.to)
    problems.window = t('features.pipelineStarts.composer.invalidWindow')

  if (rules.minNewRows !== null) {
    const rows = numberOrNull(rowsText)

    if (rows === null || rows < 1 || rows > 1_000_000)
      problems.rows = t('features.pipelineStarts.composer.invalidRows')
  }

  const wait = numberOrNull(waitText)

  if (wait === null || wait < 0 || wait > 1440)
    problems.wait = t('features.pipelineStarts.composer.invalidWait')

  return problems
}

/** The way a stored start is heard: a webhook counts when it is on. */
export function startWays(
  schedules: readonly PipelineScheduleWire[],
  webhookOn: boolean,
): StartWay[] {
  const ways = schedules.flatMap((s): StartWay[] =>
    s.enabled ? [startKind(s)] : [],
  )

  if (webhookOn) ways.push('webhook')

  return ways
}
