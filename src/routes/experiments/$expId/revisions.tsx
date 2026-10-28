import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { RevisionsTable } from '../../records/$recordId/-notebook-page'
import {
  fetchRevisionsForRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

export const Route = createFileRoute('/experiments/$expId/revisions')({
  component: Revisions,
})

function Revisions() {
  const { expId } = Route.useParams()
  const revisions = useQuery({
    queryKey: notebookQueryKeys.revisions(expId),
    queryFn: () => fetchRevisionsForRecord(notebookDataClient, expId),
  })
  const rows = revisions.data ?? []
  const names = useUserNames(rows.map((r) => r.created_by_user_id))
  return (
    <div className="min-w-0 flex-1 px-4 md:px-8">
      <RevisionsTable revisions={rows} names={names} />
    </div>
  )
}
