import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { SchedulePanel } from '#/components/scheduler/schedule-panel'
import { hasCapability } from '#/lib/capability'
import { ExperimentOverview } from '#/components/overview/overview-view'
import { AddedFields } from '#/components/models/added-fields'
import { SimilarWorkPanel } from '#/components/search/similar-work-panel'
import type { ExperimentReadiness } from '#/components/overview/readiness'
import type {
  OverviewExperimentRecord,
  OverviewLink,
} from '#/components/overview/overview-view'
import {
  fetchBlocksForRecord,
  fetchProject,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import type { RecordWire } from '#/lib/notebook-data'
import { fetchPartSummary, partQueryKeys } from '#/lib/experiment-parts'
import { fetchSignaturesForRecord, signatureQueryKeys } from '#/lib/signatures'
import { useUserNames } from '#/lib/user-names'
import { useExperimentLinks, useExperimentRecord } from '../$expId'

/** EXP-02.4: the experiment Overview. Readiness comes from the server
 * (`experiment_readiness`), the same function the submit RPC gates on, so the
 * list the author reads and the block that stops them cannot disagree. */
export const Route = createFileRoute('/experiments/$expId/summary')({
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

/** The blocks the overview reads protocol steps and the objective from. */
function useOverviewBlocks(expId: string) {
  return useQuery({
    queryKey: notebookQueryKeys.blocks(expId),
    queryFn: () => fetchBlocksForRecord(notebookDataClient, expId),
  })
}

/** The record's stored properties JSONB, as the experiment model wrote them. */
function useExperimentProperties(expId: string) {
  return useQuery({
    queryKey: ['ui-port', 'experiment-properties', expId],
    queryFn: () =>
      notebookDataClient
        .list<Pick<RecordWire, 'properties'>>(
          'records',
          `?id=eq.${expId}&limit=1&select=properties`,
        )
        .then((rows) => rows[0]?.properties ?? {}),
  })
}

/** The parts of an experiment that runs over several days. */
function useExperimentParts(expId: string) {
  return useQuery({
    queryKey: partQueryKeys.summary(expId),
    queryFn: () => fetchPartSummary(notebookDataClient, expId),
  })
}

/** What the server would still need before this experiment could be submitted. */
function useExperimentReadiness(expId: string) {
  return useQuery({
    queryKey: ['ui-port', 'experiment-readiness', expId],
    queryFn: () =>
      notebookDataClient.rpc<ExperimentReadiness>('experiment_readiness', {
        p_record_id: expId,
      }),
    retry: false,
  })
}

/** Every signature recorded against the experiment. */
function useRecordSignatures(expId: string) {
  return useQuery({
    queryKey: signatureQueryKeys.forRecord(expId),
    queryFn: () => fetchSignaturesForRecord(notebookDataClient, expId),
  })
}

/** Earlier experiments whose links point at this one. */
function useFollowedBy(expId: string) {
  return useQuery({
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
}

/** The decision recorded on the Results tab, read from the same key. */
function useExperimentDecision(expId: string) {
  return useQuery({
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
}

/**
 * Who the latest submission went to, so Reviewer follows the review that exists
 * rather than a property nobody filled in.
 */
function useLatestSubmission(expId: string) {
  return useQuery({
    queryKey: ['ui-port', 'experiment-submission', expId],
    queryFn: async () =>
      (
        await notebookDataClient.list<{
          assigned_reviewer_user_ids: string[]
        }>(
          'review_submissions',
          `?record_id=eq.${encodeURIComponent(expId)}&order=submitted_at.desc&limit=1&select=assigned_reviewer_user_ids`,
        )
      ).at(0) ?? null,
  })
}

/** The experiment's project, for the project name in the header. */
function useExperimentProject(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['ui-port', 'experiment-project', projectId ?? ''],
    queryFn: () =>
      projectId
        ? fetchProject(notebookDataClient, projectId)
        : Promise.resolve(null),
    enabled: Boolean(projectId),
  })
}

type OverviewRecord = ReturnType<typeof useExperimentRecord>['data']

/** The properties the overview shows: the stored ones plus what it adds. */
function overviewProperties(
  record: OverviewRecord,
  properties: ReturnType<typeof useExperimentProperties>['data'],
  decision: ReturnType<typeof useExperimentDecision>['data'],
): OverviewExperimentRecord['properties'] {
  const props: OverviewExperimentRecord['properties'] = { ...properties }

  if (record?.reviewer_user_id) props.reviewerId = record.reviewer_user_id

  if (record?.planned_end) props.plannedEnd = record.planned_end

  if (decision?.decision) {
    props.decision = decision.decision
    props.decisionNotes = decision.decision_notes ?? ''
  }

  return props
}

/** Everyone the header and panels name, in one de-duplicated read. */
function overviewUserIds({
  record,
  readiness,
  signatures,
  parts,
  props,
  submission,
}: {
  record: OverviewRecord
  readiness: ReturnType<typeof useExperimentReadiness>['data']
  signatures: ReturnType<typeof useRecordSignatures>['data']
  parts: ReturnType<typeof useExperimentParts>['data']
  props: OverviewExperimentRecord['properties']
  submission: ReturnType<typeof useLatestSubmission>['data']
}): string[] {
  return [
    record?.created_by_user_id ?? '',
    ...(readiness?.openCommentThreads.map(
      (thread) => thread.authorUserId ?? '',
    ) ?? []),
    ...(signatures ?? []).map((signature) => signature.signer_user_id),
    ...(parts ?? []).flatMap((part) => [
      part.completedByUserId ?? '',
      part.assigneeUserId ?? '',
    ]),
    ...(z.array(z.string()).safeParse(props.collaboratorIds).data ?? []),
    z.string().safeParse(props.reviewerId).data ?? '',
    ...(submission?.assigned_reviewer_user_ids ?? []),
  ].filter(Boolean)
}

/** The experiment's own row, as the overview contract names it. */
function overviewRecord(
  record: NonNullable<OverviewRecord>,
  properties: OverviewExperimentRecord['properties'],
): OverviewExperimentRecord {
  return {
    id: record.id,
    identifier: record.identifier,
    title: record.title,
    status: record.status,
    projectId: record.project_id,
    createdByUserId: record.created_by_user_id,
    createdAt: record.created_at,
    properties,
  }
}

/** The link rows the overview renders, mapped from the wire. */
function overviewLinks(
  links: ReturnType<typeof useExperimentLinks>['data'],
): OverviewLink[] {
  return (links ?? []).map((link) => ({
    id: link.id,
    linkType: link.link_type,
    targetKind: link.target_kind,
    targetIdentifier: link.target_identifier,
    targetRecordId: link.target_record_id,
  }))
}

function Overview() {
  const { expId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const { data: record } = useExperimentRecord(expId)
  const links = useExperimentLinks(expId)

  const blocks = useOverviewBlocks(expId)
  const properties = useExperimentProperties(expId)
  const parts = useExperimentParts(expId)
  const readiness = useExperimentReadiness(expId)
  const signatures = useRecordSignatures(expId)
  const followedBy = useFollowedBy(expId)
  const decision = useExperimentDecision(expId)
  const submission = useLatestSubmission(expId)
  const project = useExperimentProject(record?.project_id)

  const props = overviewProperties(record, properties.data, decision.data)

  const { userLabel } = useUserNames(
    overviewUserIds({
      record,
      readiness: readiness.data,
      signatures: signatures.data,
      parts: parts.data,
      props,
      submission: submission.data,
    }),
  )

  if (!record) {
    return (
      <div className="px-4 py-5 md:px-8">
        <p className="m-0 text-label text-fg-muted">
          {blocks.isLoading ? 'Loading experiment…' : 'Experiment not found.'}
        </p>
      </div>
    )
  }

  const readinessData = readiness.data ?? null

  const readinessError =
    readiness.error instanceof Error ? readiness.error.message : null

  const partRows = parts.data ?? []

  const interaction = {
    userLabel,
    projectName: project.data?.title ?? null,
  }

  const panels = {
    addedFields: <AddedFields modelKey="experiment" objectId={record.id} />,
    schedule: (
      <SchedulePanel
        recordId={record.id}
        parts={partRows}
        canWrite={hasCapability(context.workspace?.role, 'record.create')}
      />
    ),
    similarWork: (
      <SimilarWorkPanel
        workspaceId={record.workspace_id}
        objectType="record"
        objectId={record.id}
        identifier={record.identifier}
        title={record.title}
      />
    ),
  }

  return (
    <ExperimentOverview
      record={overviewRecord(record, props)}
      blocks={blocks.data ?? []}
      parts={partRows}
      links={overviewLinks(links.data)}
      readiness={readinessData}
      readinessIsLoading={readiness.isLoading}
      readinessError={readinessError}
      signatures={signatures.data ?? []}
      signaturesIsLoading={signatures.isLoading}
      signaturesIsError={signatures.isError}
      followedBy={followedBy.data ?? []}
      reviewerIds={submission.data?.assigned_reviewer_user_ids}
      userLabel={interaction.userLabel}
      projectName={interaction.projectName}
      addedFields={panels.addedFields}
      schedule={panels.schedule}
      similarWork={panels.similarWork}
    />
  )
}
