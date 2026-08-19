import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { RecordHistoryTimeline } from '#/components/audit/record-history-timeline'
import { Button } from '#/components/ui'
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
  projectId,
  onSelectRevision,
}: {
  recordId: string
  currentUserId: string
  currentUserName: string
  projectId?: string
  onSelectRevision?: (revisionId: string) => void
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
      <section aria-label="Submitted revisions" className="space-y-2">
        <h3 className="text-sm font-semibold">Submitted revisions</h3>
        {revisions.error ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load submitted revisions.
          </p>
        ) : null}
        {revisions.data && revisions.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No submitted revisions yet.
          </p>
        ) : null}
        <ul className="space-y-1">
          {(revisions.data ?? []).map((revision) => {
            const label = `Submitted ${formatDate(revision.created_at)}`
            const secondary = revision.id.slice(0, 8)
            if (projectId) {
              return (
                <li key={revision.id}>
                  <Link
                    to="/projects/$projectId/experiments/$recordId"
                    params={{ projectId, recordId }}
                    search={{ revision: revision.id } as never}
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    {label}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {secondary}
                    </span>
                  </Link>
                </li>
              )
            }
            return (
              <li key={revision.id}>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => onSelectRevision?.(revision.id)}
                >
                  {label}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {secondary}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
