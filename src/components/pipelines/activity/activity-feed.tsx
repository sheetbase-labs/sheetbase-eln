import { t } from '#/copy'
import { BoardStatus } from '#/features/pipelines/board/board'
import type { Tone } from '#/components/ui/status'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type { ActivityEvent, ActivityKind } from './activity-events'

const WHAT: Record<ActivityKind, { label: () => string; tone: Tone }> = {
  created: {
    label: () => t('features.pipelineApprovals.activity.createdDraft'),
    tone: 'draft',
  },
  requested: {
    label: () => t('features.pipelineApprovals.activity.requested'),
    tone: 'review',
  },
  approved: {
    label: () => t('features.pipelineApprovals.activity.approvedEvent'),
    tone: 'ok',
  },
  returned: {
    label: () => t('features.pipelineApprovals.activity.returnedEvent'),
    tone: 'bad',
  },
  withdrawn: {
    label: () => t('features.pipelineApprovals.activity.withdrawnEvent'),
    tone: 'stored',
  },
  published: {
    label: () => t('features.pipelineApprovals.activity.publishedEvent'),
    tone: 'ok',
  },
  retired: {
    label: () => t('features.pipelineApprovals.activity.retiredEvent'),
    tone: 'none',
  },
}

/**
 * The history of a pipeline's versions, one row to a thing that happened, in
 * the board's table (`.pls-rt` in a `.pls-frame`). Render inside `BoardScope`.
 */
export function ActivityFeed({
  events,
  actorLabel,
}: {
  events: ActivityEvent[]
  actorLabel: (id: string | null | undefined) => string
}) {
  return (
    <div className="pls-frame">
      <table
        className="pls-rt pls-hist"
        aria-label={t('features.pipelineApprovals.activity.table')}
      >
        <thead>
          <tr>
            <th>{t('features.pipelineApprovals.activity.when')}</th>
            <th>{t('features.pipelineApprovals.activity.what')}</th>
            <th>{t('features.pipelineApprovals.activity.version')}</th>
            <th>{t('features.pipelineApprovals.activity.who')}</th>
            <th>{t('features.pipelineApprovals.activity.note')}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const what = WHAT[event.kind]

            return (
              <tr key={event.id}>
                <td className="m nw">{formatNotebookDateTime(event.at)}</td>
                <td className="nw">
                  <BoardStatus tone={what.tone}>{what.label()}</BoardStatus>
                </td>
                <td className="mono">v{event.version}</td>
                <td>{actorLabel(event.actorId)}</td>
                <td className="m">{event.note ? `“${event.note}”` : null}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
