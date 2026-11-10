import { daysUntil } from '#/lib/sample-workflows'
import { t } from '#/copy'

/** Due date wording and tone: ok until two days out, warn then, bad once late. */
export function dueSummary(dueAt: string | null, now = Date.now()) {
  const days = daysUntil(dueAt, now)

  if (days === null)
    return {
      text: t('settings.sampleWorkflows.onSample.noDue'),
      tone: 'none' as const,
    }

  if (days < 0)
    return {
      text: t('settings.sampleWorkflows.onSample.overdue', { count: -days }),
      tone: 'bad' as const,
    }

  if (days === 0)
    return {
      text: t('settings.sampleWorkflows.onSample.dueToday'),
      tone: 'warn' as const,
    }

  return {
    text: t('settings.sampleWorkflows.onSample.dueIn', { count: days }),
    tone: days <= 2 ? ('warn' as const) : ('ok' as const),
  }
}
