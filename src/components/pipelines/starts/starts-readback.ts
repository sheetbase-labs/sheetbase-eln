/** The rules as a short paragraph of plain sentences, so a person can check
 * them without reading the form. Pure, so the card and the tab say the same. */
import { t } from '#/copy'
import type { StartRules } from '#/lib/pipelines/start-rules'

export type StartWay = 'snapshot' | 'event' | 'schedule' | 'webhook'

const joinWords = (parts: string[], word: string): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} ${word} ${parts[parts.length - 1]}`

/** What has to hold before a start becomes a run, in words; empty for none. */
export function conditionWords(rules: StartRules): string {
  const parts: string[] = []

  if (rules.window) {
    parts.push(
      t('features.pipelineStarts.readback.window', {
        days: t(`features.pipelineStarts.readback.days.${rules.window.days}`),
        from: rules.window.from,
        to: rules.window.to,
        zone: rules.window.timeZone,
      }),
    )
  }

  if (rules.minNewRows !== null) {
    parts.push(
      t('features.pipelineStarts.readback.rows', { count: rules.minNewRows }),
    )
  }

  return joinWords(
    parts,
    t(
      rules.conditionsMatch === 'any'
        ? 'features.pipelineStarts.readback.or'
        : 'features.pipelineStarts.readback.and',
    ),
  )
}

export function readbackLines(
  ways: readonly StartWay[],
  rules: StartRules,
): string[] {
  const lines: string[] = []
  const unique = [...new Set(ways)]

  if (unique.length === 0) {
    lines.push(t('features.pipelineStarts.readback.noStarts'))
  } else {
    lines.push(
      t('features.pipelineStarts.readback.startsOn', {
        list: joinWords(
          unique.map((way) =>
            t(`features.pipelineStarts.readback.kinds.${way}`),
          ),
          t('features.pipelineStarts.readback.or'),
        ),
      }),
    )
  }

  const conditions = conditionWords(rules)

  lines.push(
    conditions
      ? t('features.pipelineStarts.readback.only', { conditions })
      : t('features.pipelineStarts.readback.nothing'),
  )

  if (rules.waitMinutes > 0) {
    lines.push(
      t('features.pipelineStarts.readback.wait', {
        minutes: rules.waitMinutes,
      }),
    )
  }

  lines.push(t('features.pipelineStarts.readback.skip'))
  lines.push(
    t(
      rules.missedRuns === 'skip'
        ? 'features.pipelineStarts.readback.missedSkip'
        : 'features.pipelineStarts.readback.missedOnce',
    ),
  )

  return lines
}
