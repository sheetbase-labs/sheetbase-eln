import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { SignaturesTable } from '#/components/review/signatures-table'
import {
  fetchRevisionsForRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { Button } from '#/components/v3/ui/button'
import { Muted } from '#/components/v3/ui/layout'
import { withReopen } from '#/lib/return-to'
import { fetchSignaturesForRecord, signatureQueryKeys } from '#/lib/signatures'
import { useExperimentRecord } from '../$expId'
import { t } from '#/copy'

export const Route = createFileRoute('/experiments/$expId/signatures')({
  component: Signatures,
})

function Signatures() {
  const { expId } = Route.useParams()
  const navigate = useNavigate()
  const { data: record } = useExperimentRecord(expId)
  const signatures = useQuery({
    queryKey: signatureQueryKeys.forRecord(expId),
    queryFn: () => fetchSignaturesForRecord(notebookDataClient, expId),
  })
  const revisions = useQuery({
    queryKey: notebookQueryKeys.revisions(expId),
    queryFn: () => fetchRevisionsForRecord(notebookDataClient, expId),
  })
  // Approval ends the review but is not the signature: say what is missing and
  // put the way to give it here, where the person is looking for it.
  const awaitingSignature =
    record?.status === 'approved' &&
    signatures.isSuccess &&
    signatures.data.length === 0 &&
    (revisions.data?.length ?? 0) > 0
  return (
    <div className="min-w-0 flex-1 px-4 md:px-8">
      {awaitingSignature ? (
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <Muted>{t('projects.experimentSignatures.awaiting')}</Muted>
          <Button
            variant="primary"
            onClick={() =>
              void navigate({
                href: withReopen(`/experiments/${expId}/notebook`, 'sign'),
              })
            }
          >
            {t('projects.experimentSignatures.sign')}
          </Button>
        </div>
      ) : null}
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
