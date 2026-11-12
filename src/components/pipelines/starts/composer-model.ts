import { useState } from 'react'

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

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

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

  if (
    rules.window &&
    (!CLOCK.test(rules.window.from) ||
      !CLOCK.test(rules.window.to) ||
      rules.window.from >= rules.window.to)
  )
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

/** What the form on screen holds: the rules as edited, the text boxes behind
 * the numbers, and how that compares with what is saved. */
export function useRuleForm(rules: StartRules) {
  const [draft, setDraft] = useState<StartRules>(rules)
  const [rowsText, setRowsText] = useState(String(rules.minNewRows ?? 1))
  const [waitText, setWaitText] = useState(String(rules.waitMinutes))
  const rowsValue = numberOrNull(rowsText)
  const waitValue = numberOrNull(waitText)

  const effective: StartRules = {
    ...draft,
    minNewRows:
      draft.minNewRows === null ? null : (rowsValue ?? draft.minNewRows),
    waitMinutes: waitValue ?? draft.waitMinutes,
  }

  const problems = ruleProblems(effective, rowsText, waitText)

  return {
    draft,
    setDraft,
    rowsText,
    setRowsText,
    waitText,
    setWaitText,
    rowsValue,
    effective,
    problems,
    hasProblem: Object.values(problems).some(Boolean),
    dirty: JSON.stringify(effective) !== JSON.stringify(rules),
    reset: () => {
      setDraft(rules)
      setRowsText(String(rules.minNewRows ?? 1))
      setWaitText(String(rules.waitMinutes))
    },
  }
}

export type RuleForm = ReturnType<typeof useRuleForm>
