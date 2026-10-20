import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { ExperimentOverview } from '#/components/overview/overview-view'
import type { ExperimentReadiness } from '#/components/overview/readiness'
import {
  fetchBlocksForRecord,
  fetchProject,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { fetchSignaturesForRecord, signatureQueryKeys } from '#/lib/signatures'
import { useUserNames } from '#/lib/user-names'
import { useExperimentLinks, useExperimentRecord } from '../$expId'

/** EXP-02.4: the experiment Overview. Readiness comes from the server
 * (`experiment_readiness`), the same function the submit RPC gates on, so the
 * list the author reads and the block that stops them cannot disagree. */
export const Route = createFileRoute('/experiments/$expId/overview')({
  component: Overview,
})

interface FollowedByWire {
  source_record_id: string
}
interface FollowedByRecord {
  id: string
  identifier: string
  title: string
  status: string | null
}

function Overview() {
  const { expId } = Route.useParams()
  const { data: record } = useExperimentRecord(expId)
  const links = useExperimentLinks(expId)

  const blocks = useQuery({
    queryKey: notebookQueryKeys.blocks(expId),
    queryFn: () => fetchBlocksForRecord(notebookDataClient, expId),
  })

  const properties = useQuery({
    queryKey: ['ui-port', 'experiment-properties', expId],
    queryFn: () =>
      notebookDataClient
        .list<{ properties: Record<string, unknown> | null }>(
          'records',
          `?id=eq.${expId}&limit=1&select=properties`,
        )
        .then((rows) => rows[0]?.properties ?? {}),
  })

  const readiness = useQuery({
    queryKey: ['ui-port', 'experiment-readiness', expId],
    queryFn: () =>
      notebookDataClient.rpc<ExperimentReadiness>('experiment_readiness', {
        p_record_id: expId,
      }),
    retry: false,
  })

  const signatures = useQuery({
    queryKey: signatureQueryKeys.forRecord(expId),
    queryFn: () => fetchSignaturesForRecord(notebookDataClient, expId),
  })

  const followedBy = useQuery({
    queryKey: ['ui-port', 'experiment-followed-by', expId],
    queryFn: async (): Promise<FollowedByRecord[]> => {
      const incoming = await notebookDataClient.list<FollowedByWire>(
        'record_links',
        `?target_record_id=eq.${expId}&link_type=in.(follows,upstream)&select=source_record_id`,
      )
      const ids = [...new Set(incoming.map((row) => row.source_record_id))]
      if (ids.length === 0) return []
      const filter = ids.map((id) => encodeURIComponent(id)).join(',')
      return notebookDataClient.list<FollowedByRecord>(
        'records',
        `?id=in.(${filter})&deleted_at=is.null&select=id,identifier,title,status`,
      )
    },
  })

  // Same read and key as the Results tab, so a decision recorded there is the
  // one shown here.
  const decision = useQuery({
    queryKey: ['ui-port', 'experiment', 'decision', expId],
    queryFn: async () =>
      (
        await notebookDataClient.list<{
          decision: string | null
          decision_notes: string | null
        }>(
          'records',
          `?id=eq.${encodeURIComponent(expId)}&select=decision,decision_notes`,
        )
      ).at(0) ?? null,
  })

  const project = useQuery({
    queryKey: ['ui-port', 'experiment-project', record?.project_id ?? ''],
    queryFn: () =>
      record?.project_id
        ? fetchProject(notebookDataClient, record.project_id)
        : Promise.resolve(null),
    enabled: Boolean(record?.project_id),
  })

  const props: Record<string, unknown> = {
    ...(properties.data ?? {}),
    ...(record?.reviewer_user_id
      ? { reviewerId: record.reviewer_user_id }
      : {}),
    ...(record?.planned_end ? { plannedEnd: record.planned_end } : {}),
    ...(decision.data?.decision
      ? {
          decision: decision.data.decision,
          decisionNotes: decision.data.decision_notes ?? '',
        }
      : {}),
  }
  const readinessData = readiness.data ?? null
  const signatureRows = signatures.data ?? []

  const userIds = [
    record?.created_by_user_id ?? '',
    ...(readinessData?.openCommentThreads.map(
      (thread) => thread.authorUserId ?? '',
    ) ?? []),
    ...signatureRows.map((signature) => signature.signer_user_id),
    ...(Array.isArray(props.collaboratorIds)
      ? props.collaboratorIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : []),
    typeof props.reviewerId === 'string' ? props.reviewerId : '',
  ].filter(Boolean)
  const { userLabel } = useUserNames(userIds)

  if (!record) {
    return (
      <div className="px-4 py-5 md:px-8">
        <p className="m-0 text-label text-fg-muted">
          {blocks.isLoading ? 'Loading experiment…' : 'Experiment not found.'}
        </p>
      </div>
    )
  }

  return (
    <ExperimentOverview
      record={{
        id: record.id,
        identifier: record.identifier,
        title: record.title,
        status: record.status,
        projectId: record.project_id,
        createdByUserId: record.created_by_user_id,
        createdAt: record.created_at,
        properties: props,
      }}
      blocks={blocks.data ?? []}
      links={(links.data ?? []).map((link) => ({
        id: link.id,
        linkType: link.link_type,
        targetKind: link.target_kind,
        targetIdentifier: link.target_identifier,
        targetRecordId: link.target_record_id,
      }))}
      readiness={readinessData}
      readinessIsLoading={readiness.isLoading}
      readinessError={
        readiness.error instanceof Error ? readiness.error.message : null
      }
      signatures={signatureRows}
      signaturesIsLoading={signatures.isLoading}
      signaturesIsError={signatures.isError}
      followedBy={followedBy.data ?? []}
      userLabel={userLabel}
      projectName={project.data?.title ?? null}
    />
  )
}
