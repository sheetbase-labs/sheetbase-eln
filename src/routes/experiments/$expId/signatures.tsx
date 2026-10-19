import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { SignaturesTable } from '#/components/review/signatures-table'
import {
  fetchRevisionsForRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { fetchSignaturesForRecord, signatureQueryKeys } from '#/lib/signatures'

export const Route = createFileRoute('/experiments/$expId/signatures')({
  component: Signatures,
})

function Signatures() {
  const { expId } = Route.useParams()
  const signatures = useQuery({
    queryKey: signatureQueryKeys.forRecord(expId),
    queryFn: () => fetchSignaturesForRecord(notebookDataClient, expId),
  })
  const revisions = useQuery({
    queryKey: notebookQueryKeys.revisions(expId),
    queryFn: () => fetchRevisionsForRecord(notebookDataClient, expId),
  })
  return (
    <div className="min-w-0 flex-1 px-4 md:px-8">
      <SignaturesTable
        signatures={signatures.data ?? []}
        isLoading={signatures.isPending}
        isError={signatures.isError}
        revisionVersions={Object.fromEntries(
          (revisions.data ?? []).map((r) => [r.id, r.structure_version]),
        )}
      />
    </div>
  )
}
