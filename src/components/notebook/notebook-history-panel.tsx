import { t } from '#/copy'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { RecordHistoryTimeline } from '#/components/audit/record-history-timeline'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  fetchRevisionsForRecord,
  fetchRecordTimeline,
} from '#/lib/notebook-experience'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import { sign002DataClient, sign002QueryKeys } from '#/lib/sign-002'

export function NotebookHistoryPanel({
  recordId,
  currentUserId,
  currentUserName,
}: {
  recordId: string
  currentUserId: string
  currentUserName: string
}) {
  const timeline = useQuery({
    queryKey: sign002QueryKeys.timeline(recordId),
    queryFn: () => fetchRecordTimeline(sign002DataClient, recordId),
  })
  const revisions = useQuery({
    queryKey: ['notebook-experience', 'revisions', recordId],
    queryFn: () => fetchRevisionsForRecord(notebookDataClient, recordId),
  })

  return (
    <div className="space-y-6">
      <RecordHistoryTimeline
        events={timeline.data ?? []}
        loading={timeline.isPending}
        error={timeline.error}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        onRefresh={() => {
          void timeline.refetch()
        }}
        refreshing={timeline.isFetching}
      />
      <section
        aria-label={t('notebook.notebookHistoryPanel.ariaLabel')}
        className="space-y-2"
      >
        <h3 className="text-sm font-semibold">
          {t('notebook.notebookHistoryPanel.ariaLabel')}
        </h3>
        {revisions.error ? (
          <p className="text-sm text-danger-text" role="alert">
            {t('notebook.notebookHistoryPanel.couldNotLoadSubmitted')}
          </p>
        ) : null}
        {revisions.data && revisions.data.length === 0 ? (
          <EmptyState
            icon="edit"
            className="py-2"
            title={t('notebook.notebookHistoryPanel.title')}
            description={t('notebook.notebookHistoryPanel.description')}
          />
        ) : null}
        <ul className="space-y-1">
          {(revisions.data ?? []).map((revision) => {
            const label = t('notebook.notebookHistoryPanel.submittedDate', {
              date: formatDate(revision.created_at),
            })
            const secondary = revision.id.slice(0, 8)
            return (
              <li key={revision.id} className="flex items-center gap-2">
                <Link
                  to="/records/$recordId"
                  params={{ recordId }}
                  search={{ revision: revision.id } as never}
                  className="text-sm underline-offset-4 hover:underline"
                >
                  {label}
                  <span className="ml-2 font-mono text-xs text-fg-muted">
                    {secondary}
                  </span>
                </Link>
                <a
                  href={`/api/export/revision/${revision.id}/package`}
                  className="text-xs text-fg-muted underline-offset-4 hover:underline"
                >
                  {t('notebook.notebookHistoryPanel.evidenceZip')}
                </a>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
