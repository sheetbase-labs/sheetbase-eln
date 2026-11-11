import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { EmptyState } from '#/components/ui/empty-state'
import { Muted } from '#/components/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { t } from '#/copy'

export const Route = createFileRoute('/experiments/$expId/review/submissions')({
  component: Submissions,
})

interface SubmissionRow {
  id: string
  revision_id: string
  state: string
  submitted_at: string
  submitted_by_user_id: string
  assigned_reviewer_user_ids: string[]
}

const STATE_LABEL = new Map<string, string>([
  ['submitted', t('projects.revisionPage.status.underReview')],
  ['approved', t('projects.revisionPage.status.approved')],
  ['rejected', t('projects.revisionPage.status.rejected')],
  ['withdrawn', t('projects.revisionPage.status.withdrawn')],
  ['returned', t('projects.experimentsData.returned')],
  ['changes_requested', t('projects.experimentsData.returned')],
])

/** The table's columns, in the order the row cells are read. */
const SUBMISSION_COLUMNS = [
  t('projects.experimentPage.submissions.submitted'),
  t('projects.experimentPage.submissions.by'),
  t('projects.experimentPage.submissions.reviewers'),
  t('projects.experimentPage.submissions.outcome'),
]

/** Every time this experiment was sent for review, newest first, and how each
 * one went. Each row opens its review. */
function Submissions() {
  const { expId } = Route.useParams()

  const submissions = useQuery({
    queryKey: ['ui-port', 'experiment-submissions', expId],
    queryFn: () =>
      notebookDataClient.list<SubmissionRow>(
        'review_submissions',
        `?record_id=eq.${encodeURIComponent(expId)}&order=submitted_at.desc&select=id,revision_id,state,submitted_at,submitted_by_user_id,assigned_reviewer_user_ids`,
      ),
  })

  const rows = submissions.data ?? []

  const { userLabel } = useUserNames(
    rows.flatMap((row) => [
      row.submitted_by_user_id,
      ...row.assigned_reviewer_user_ids,
    ]),
  )

  return (
    <div className="min-w-0 flex-1 px-4 py-4 md:px-8">
      {submissions.isError ? (
        <p role="alert" className="m-0 text-label text-fg-muted">
          {t('projects.experimentPage.submissions.loadFailed')}
        </p>
      ) : submissions.isPending ? (
        <Muted>{t('projects.experimentPage.submissions.loading')}</Muted>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="check"
          title={t('projects.experimentPage.submissions.emptyTitle')}
          description={t('projects.experimentPage.submissions.emptyBody')}
        />
      ) : (
        <TableBox>
          <Table aria-label={t('projects.experimentPage.section.submissions')}>
            <TableHeader>
              <TableRow>
                {SUBMISSION_COLUMNS.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      to="/review/$revisionId"
                      params={{ revisionId: row.revision_id }}
                      className="text-link"
                    >
                      {formatNotebookDateTime(row.submitted_at, { zone: true })}
                    </Link>
                  </TableCell>
                  <TableCell>{userLabel(row.submitted_by_user_id)}</TableCell>
                  <TableCell>
                    {row.assigned_reviewer_user_ids
                      .map((id) => userLabel(id))
                      .join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    {STATE_LABEL.get(row.state) ?? row.state}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      )}
    </div>
  )
}
