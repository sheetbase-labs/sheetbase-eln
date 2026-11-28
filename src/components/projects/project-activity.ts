/**
 * A project's audit events as lines of the shared activity list, so the
 * project page and its peek say each one the way a record page does.
 */
import { describeAuditEvent } from '#/lib/audit-history'
import { formatRelativeTime } from '#/lib/notebook-data'
import type { ActivityEntry } from '#/lib/record-activity'
import { t } from '#/copy'

import type { fetchProjectActivity } from './project-data'

type ProjectActivityEvent = Awaited<
  ReturnType<typeof fetchProjectActivity>
>[number]

export function projectActivityEntry(
  event: ProjectActivityEvent,
): ActivityEntry {
  const description = describeAuditEvent(event)

  const action = `${description.action.charAt(0).toUpperCase()}${description.action.slice(1)}`

  return {
    id: event.id,
    at: event.createdAt,
    title: `${action} ${description.sentenceSubject}`,
    target: event.currentRecord
      ? `${event.currentRecord.identifier} · ${event.currentRecord.title}`
      : undefined,
    actor:
      event.currentActorName ?? t('projects.projectOverview.activity.system'),
    when: formatRelativeTime(event.createdAt),
  }
}
