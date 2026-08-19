/**
 * Notebook product chrome helpers (PC-03). Reuses Core contracts — records,
 * revisions, SIGN-002 amendment/timeline/evidence, and Sheet Instance copy —
 * without a second domain model.
 */
import { EMPTY_RICH_TEXT_PAYLOAD, PAYLOAD_SCHEMA_VERSION } from '#/lib/blocks'
import type { DataClient } from '#/lib/data-client'
import { DataClientError } from '#/lib/data-client'
import { insertSheetInstanceBlock } from '#/lib/notebook-mutations'
import { toRecord } from '#/lib/notebook-data'
import type {
  BlockWire,
  NotebookBlock,
  NotebookRecord,
  RecordWire,
  RevisionWire,
} from '#/lib/notebook-data'
import { toOverviewRevision } from '#/lib/overview'
import { isCanonicalSheetBlock, sheetBlockInstanceId } from '#/lib/sheet-block'
import {
  duplicateSheetInstance,
  fetchSheetInstance,
} from '#/lib/sheet-instance-data'
import {
  createAmendment,
  fetchRecordTimeline,
  fetchRevisionEvidenceExport,
} from '#/lib/sign-002'
import type { EvidenceExportWire } from '#/lib/sign-002'

export {
  createAmendment,
  fetchRecordTimeline,
  fetchRevisionEvidenceExport,
}

export type NotebookLifecycleLabel = 'Archived' | 'Submitted' | 'Working'

export function notebookLifecycleLabel(record: {
  lockedAt: string | null
  archivedAt: string | null
}): NotebookLifecycleLabel {
  if (record.archivedAt) return 'Archived'
  if (record.lockedAt) return 'Submitted'
  return 'Working'
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
  const nonSheet = ordered.filter((block) => block.type !== 'sheet')
  const sheetBlocks = ordered.filter(
    (block) =>
      block.type === 'sheet' && isCanonicalSheetBlock(block.payload),
  )

  const pBlocks =
    nonSheet.length > 0
      ? createBlocksPayload(nonSheet)
      : [
          {
            type: 'rich_text',
            payload: EMPTY_RICH_TEXT_PAYLOAD,
            payload_schema_version: PAYLOAD_SCHEMA_VERSION,
            order: 1,
          },
        ]

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
  let structureVersion = record.structureVersion

  for (const block of sheetBlocks) {
    const instanceId = sheetBlockInstanceId(block.payload)
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
    })
    structureVersion = inserted.structureVersion
  }

  return { record }
}

export function downloadRevisionEvidence(
  client: DataClient,
  revisionId: string,
): Promise<EvidenceExportWire> {
  return fetchRevisionEvidenceExport(client, revisionId)
}
