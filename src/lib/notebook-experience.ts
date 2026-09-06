/**
 * Notebook product chrome helpers (PC-03). Reuses Core contracts — records,
 * revisions, SIGN-002 amendment/timeline/evidence, and Sheet Instance copy —
 * without a second domain model.
 */
import { EMPTY_RICH_TEXT_PAYLOAD, PAYLOAD_SCHEMA_VERSION } from '#/lib/blocks'
import type { DataClient } from '#/lib/data-client'
import { DataClientError } from '#/lib/data-client'
import { insertBlock, insertSheetInstanceBlock } from '#/lib/notebook-mutations'
import { toBlock, toRecord, notebookQueryKeys } from '#/lib/notebook-data'
import type {
  BlockWire,
  NotebookBlock,
  NotebookLink,
  NotebookRecord,
  RecordWire,
  RevisionWire,
} from '#/lib/notebook-data'
import type { ReviewSubmissionWire } from '#/lib/reviews'
import { toOverviewRevision } from '#/lib/overview'
import { isCanonicalSheetBlock, sheetBlockInstanceId } from '#/lib/sheet-block'
import {
  duplicateSheetInstance,
  fetchSheetInstance,
} from '#/lib/sheet-instance-data'
import {
  createAmendment,
  fetchRecordTimeline,
  sign002QueryKeys,
} from '#/lib/sign-002'
import { signatureQueryKeys } from '#/lib/signatures'
import {
  reviewWorkspaceQueryKeys,
  toCanonicalEnvelope,
} from '#/lib/review-workspace'

export { createAmendment, fetchRecordTimeline }

export type NotebookLifecycleLabel =
  'Archived' | 'Submitted' | 'In review' | 'Working'

export type NotebookReviewActivity = 'none' | 'submitted' | 'approved'

export interface NotebookReviewContext {
  submission: ReviewSubmissionWire | null
  revision: { id: string; superseded_by_revision_id: string | null } | null
}

export function isActiveNotebookReview(
  review: NotebookReviewContext | null | undefined,
): boolean {
  if (!review?.submission) return false
  if (review.revision?.superseded_by_revision_id) return false
  return (
    review.submission.state === 'submitted' ||
    review.submission.state === 'approved'
  )
}

export function notebookReviewActivity(
  review: NotebookReviewContext | null | undefined,
): NotebookReviewActivity {
  if (!isActiveNotebookReview(review) || !review?.submission) return 'none'
  return review.submission.state === 'approved' ? 'approved' : 'submitted'
}

export function notebookLifecycleLabel(record: {
  lockedAt: string | null
  archivedAt: string | null
  reviewActivity?: NotebookReviewActivity
  isHistorical?: boolean
}): NotebookLifecycleLabel {
  if (record.archivedAt) return 'Archived'
  if (record.isHistorical || record.lockedAt) return 'Submitted'
  if (
    record.reviewActivity === 'submitted' ||
    record.reviewActivity === 'approved'
  ) {
    return 'In review'
  }
  return 'Working'
}

export function notebookReviewRevisionId(input: {
  lockedByRevisionId: string | null
  review: NotebookReviewContext | null | undefined
  historicalRevisionId?: string
}): string | undefined {
  if (input.historicalRevisionId) return input.historicalRevisionId
  if (input.lockedByRevisionId) return input.lockedByRevisionId
  if (!isActiveNotebookReview(input.review) || !input.review?.submission) {
    return undefined
  }
  return input.review.submission.revision_id
}

export async function fetchNotebookReviewContext(
  client: DataClient,
  recordId: string,
): Promise<NotebookReviewContext> {
  const submissions = await client.list<ReviewSubmissionWire>(
    'review_submissions',
    `?record_id=eq.${encodeURIComponent(recordId)}&order=submitted_at.desc,id.desc&limit=1`,
  )
  // `.at(0)` types as T | undefined; plain indexing hides the empty-list case.
  const submission = submissions.at(0) ?? null
  if (!submission) return { submission: null, revision: null }
  const revisions = await client.list<{
    id: string
    superseded_by_revision_id: string | null
  }>(
    'revisions',
    `?id=eq.${encodeURIComponent(submission.revision_id)}&select=id,superseded_by_revision_id&limit=1`,
  )
  return { submission, revision: revisions[0] ?? null }
}

export function recordFromRevisionSnapshot(
  live: NotebookRecord,
  snapshot: Record<string, unknown>,
): NotebookRecord {
  const tags = snapshot.tags
  const properties = snapshot.properties
  return {
    ...live,
    title: typeof snapshot.title === 'string' ? snapshot.title : live.title,
    status: typeof snapshot.status === 'string' ? snapshot.status : live.status,
    identifier:
      typeof snapshot.identifier === 'string'
        ? snapshot.identifier
        : live.identifier,
    tags: Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === 'string')
      : live.tags,
    properties:
      properties && typeof properties === 'object' && !Array.isArray(properties)
        ? (properties as Record<string, unknown>)
        : live.properties,
    structureVersion:
      typeof snapshot.structureVersion === 'number'
        ? snapshot.structureVersion
        : live.structureVersion,
    metadataVersion:
      typeof snapshot.metadataVersion === 'number'
        ? snapshot.metadataVersion
        : live.metadataVersion,
    createdAt:
      typeof snapshot.createdAt === 'string'
        ? snapshot.createdAt
        : live.createdAt,
    updatedAt:
      typeof snapshot.updatedAt === 'string'
        ? snapshot.updatedAt
        : live.updatedAt,
    createdByUserId:
      typeof snapshot.createdByUserId === 'string'
        ? snapshot.createdByUserId
        : live.createdByUserId,
    updatedByUserId:
      typeof snapshot.updatedByUserId === 'string' ||
      snapshot.updatedByUserId === null
        ? snapshot.updatedByUserId
        : live.updatedByUserId,
  }
}

export function notebookQueryKeysAfterSignature(input: {
  recordId: string
  submissionId?: string
  revisionId?: string
}): readonly (readonly unknown[])[] {
  const keys: (readonly unknown[])[] = [
    notebookQueryKeys.record(input.recordId),
    notebookQueryKeys.blocks(input.recordId),
    notebookQueryKeys.review(input.recordId),
    notebookQueryKeys.activity(input.recordId),
    sign002QueryKeys.timeline(input.recordId),
    sign002QueryKeys.lockState(input.recordId),
    ['notebook-experience', 'revisions', input.recordId],
  ]
  if (input.submissionId) {
    keys.push(signatureQueryKeys.forSubmission(input.submissionId))
  }
  if (input.revisionId) {
    keys.push(reviewWorkspaceQueryKeys.submissionForRevision(input.revisionId))
    keys.push(reviewWorkspaceQueryKeys.revision(input.revisionId))
    keys.push(signatureQueryKeys.forRevision(input.revisionId))
  }
  return keys
}

const REVIEW_ELIGIBLE_ROLES = new Set([
  'owner',
  'admin',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
  'member',
])

export function reviewerCandidates(
  members: Array<{
    userId: string
    role: string
    suspendedAt: string | null
  }>,
) {
  return members.filter(
    (member) =>
      member.suspendedAt === null && REVIEW_ELIGIBLE_ROLES.has(member.role),
  )
}

export function reviewerOptionLabel(
  member: { userId: string; role: string },
  currentUserId: string,
): string {
  if (member.userId === currentUserId) return `You (${member.role})`
  return `${member.userId.slice(0, 8)} · ${member.role}`
}

export function fetchRevisionsForRecord(
  client: DataClient,
  recordId: string,
): Promise<RevisionWire[]> {
  return client.list<RevisionWire>(
    'revisions',
    `?record_id=eq.${encodeURIComponent(recordId)}&order=created_at.desc,id.desc`,
  )
}

export function blocksFromRevision(revision: RevisionWire): NotebookBlock[] {
  return toOverviewRevision(revision).blocks
}

function snapshotString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Outgoing links captured in a submitted revision's canonical snapshot. */
export function linksFromRevisionSnapshot(
  revision: RevisionWire,
): NotebookLink[] {
  return toCanonicalEnvelope(revision).links.flatMap((link) => {
    const id = snapshotString(link.id)
    const sourceRecordId = snapshotString(link.sourceRecordId)
    const targetKind = snapshotString(link.targetKind)
    const targetIdentifier = snapshotString(link.targetIdentifier)
    const linkType = snapshotString(link.linkType)
    if (
      !id ||
      !sourceRecordId ||
      !targetKind ||
      !targetIdentifier ||
      !linkType
    ) {
      return []
    }
    const targetRecordId = link.targetRecordId
    // Pinned links predate the createdAt pin: prefer the snapshot's own
    // timestamp when present, else the revision pin time (the link provably
    // existed then). The pinned panel does not render this metadata.
    const createdAt = snapshotString(link.createdAt) ?? revision.created_at
    const createdByUserId = snapshotString(link.createdByUserId)
    return [
      {
        id,
        sourceRecordId,
        targetRecordId:
          typeof targetRecordId === 'string' || targetRecordId === null
            ? targetRecordId
            : null,
        targetKind,
        targetIdentifier,
        linkType,
        createdAt,
        createdByUserId,
      },
    ]
  })
}

/** Inspector evidence for `?revision=` — snapshot blocks and links only. */
export function inspectorEvidenceFromRevision(revision: RevisionWire): {
  blocks: NotebookBlock[]
  links: NotebookLink[]
} {
  return {
    blocks: blocksFromRevision(revision),
    links: linksFromRevisionSnapshot(revision),
  }
}

export interface UpdateExperimentMetadataInput {
  recordId: string
  title: string
  tags: string[]
}

export interface ExperimentMetadataPatch {
  id: string
  title: string
  tags: string[]
  metadataVersion: number
  updatedAt: string
}

export async function updateExperimentMetadata(
  client: DataClient,
  input: UpdateExperimentMetadataInput,
): Promise<ExperimentMetadataPatch> {
  const rows = await client.patch<{
    id: string
    title: string
    tags: string[] | null
    metadata_version: number
    updated_at: string
  }>(
    'records',
    `?id=eq.${input.recordId}&select=id,title,tags,metadata_version,updated_at`,
    { title: input.title, tags: input.tags },
  )
  if (rows.length === 0) {
    throw new DataClientError(
      'not_found',
      'The Notebook could not be updated.',
      404,
    )
  }
  const row = rows[0]
  return {
    id: row.id,
    title: row.title,
    tags: row.tags ?? [],
    metadataVersion: row.metadata_version,
    updatedAt: row.updated_at,
  }
}

export interface DuplicateExperimentInput {
  source: NotebookRecord
  blocks: NotebookBlock[]
  title?: string
}

function createBlocksPayload(blocks: NotebookBlock[]) {
  return blocks.map((block) => ({
    type: block.type,
    payload: block.payload,
    payload_schema_version: block.payloadSchemaVersion,
    order: block.order,
  }))
}

export async function duplicateExperiment(
  client: DataClient,
  input: DuplicateExperimentInput,
): Promise<{ record: NotebookRecord }> {
  const projectId = input.source.projectId
  if (!projectId) {
    throw new DataClientError(
      'validation_error',
      'This Notebook is not in a project, so it cannot be duplicated.',
      400,
    )
  }

  const title = input.title?.trim() || `${input.source.title} copy`
  const ordered = [...input.blocks].sort((a, b) => a.order - b.order)
  const leading: NotebookBlock[] = []
  let index = 0
  while (index < ordered.length && ordered[index].type !== 'sheet') {
    leading.push(ordered[index])
    index += 1
  }

  const pBlocks =
    leading.length > 0
      ? createBlocksPayload(leading)
      : ordered.length === 0
        ? [
            {
              type: 'rich_text',
              payload: EMPTY_RICH_TEXT_PAYLOAD,
              payload_schema_version: PAYLOAD_SCHEMA_VERSION,
              order: 1,
            },
          ]
        : []

  const result = await client.rpc<{ record: RecordWire; blocks: BlockWire[] }>(
    'create_record_with_blocks',
    {
      p_project_id: projectId,
      p_kind: 'experiment',
      p_title: title,
      p_status: 'draft',
      p_tags: input.source.tags,
      p_blocks: pBlocks,
      p_properties: input.source.properties,
    },
  )
  const record = toRecord(result.record)
  const created = [...result.blocks]
    .map(toBlock)
    .sort((a, b) => a.order - b.order)
  let lastBlockId = created.at(-1)?.id
  let structureVersion = record.structureVersion

  for (const source of ordered.slice(index)) {
    if (source.type === 'sheet' && isCanonicalSheetBlock(source.payload)) {
      const instanceId = sheetBlockInstanceId(source.payload)
      if (!instanceId) continue
      const instance = await fetchSheetInstance(instanceId, client)
      if (!instance) {
        throw new DataClientError(
          'not_found',
          'A Sheet in this Notebook could not be copied.',
          404,
        )
      }
      const duplicated = await duplicateSheetInstance(
        instance.id,
        instance.revision,
        `${instance.name} copy`,
        client,
      )
      const inserted = await insertSheetInstanceBlock(client, {
        recordId: record.id,
        instanceId: duplicated.id,
        expectedStructureVersion: structureVersion,
        ...(lastBlockId ? { afterBlockId: lastBlockId } : {}),
      })
      lastBlockId = inserted.block.id
      structureVersion = inserted.structureVersion
      continue
    }
    if (source.type === 'sheet') continue
    const inserted = await insertBlock(client, {
      recordId: record.id,
      type: source.type,
      payload: source.payload,
      payloadSchemaVersion: source.payloadSchemaVersion,
      expectedStructureVersion: structureVersion,
      ...(lastBlockId ? { afterBlockId: lastBlockId } : {}),
    })
    lastBlockId = inserted.block.id
    structureVersion = inserted.structureVersion
  }

  return { record }
}

export type NotebookSignState =
  'none' | 'awaiting-review' | 'can-sign' | 'already-signed' | 'not-assigned'

export function notebookSignState(input: {
  currentUserId: string
  submission: {
    state: string
    assigned_reviewer_user_ids: string[]
  } | null
  signatures: Array<{ signer_user_id: string }>
}): NotebookSignState {
  if (!input.submission) return 'none'
  const alreadySigned = input.signatures.some(
    (signature) => signature.signer_user_id === input.currentUserId,
  )
  if (alreadySigned) return 'already-signed'
  if (input.submission.state !== 'approved') return 'awaiting-review'
  if (
    !input.submission.assigned_reviewer_user_ids.includes(input.currentUserId)
  ) {
    return 'not-assigned'
  }
  return 'can-sign'
}

export function groupChartTables<
  T extends { id: string; name: string; record_id?: string | null },
>(tables: T[], notebookRecordId: string): { local: T[]; workspace: T[] } {
  const local: T[] = []
  const workspace: T[] = []
  for (const table of tables) {
    if (table.record_id === notebookRecordId) local.push(table)
    else workspace.push(table)
  }
  return { local, workspace }
}
