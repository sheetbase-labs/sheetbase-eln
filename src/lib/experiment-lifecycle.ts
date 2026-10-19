/**
 * The experiment lifecycle as the experiment page drives it: start, hold,
 * resume, archive, delete a draft, move a draft, and start a new run.
 *
 * Every transition is a server decision (`start_experiment`,
 * `set_experiment_status`, `archive_record`, `delete_experiment_draft`,
 * `move_record_to_project`); these helpers only read the metadata version the
 * RPC wants, so a header action never has to hold a stale one.
 */
import type { DataClient } from '#/lib/data-client'
import { EMPTY_RICH_TEXT_PAYLOAD, PAYLOAD_SCHEMA_VERSION } from '#/lib/blocks'
import { fetchBlocksForRecord, toRecord } from '#/lib/notebook-data'
import type { BlockWire, NotebookRecord, RecordWire } from '#/lib/notebook-data'
import {
  applyExperimentSetup,
  insertPinnedProtocol,
} from '#/lib/notebook-create'

async function currentMetadataVersion(
  client: DataClient,
  recordId: string,
): Promise<number> {
  const rows = await client.list<{ metadata_version: number }>(
    'records',
    `?id=eq.${encodeURIComponent(recordId)}&select=metadata_version&limit=1`,
  )
  const version = rows.at(0)?.metadata_version
  if (version === undefined)
    throw new Error('This experiment is not available.')
  return Number(version)
}

export async function startExperimentRecord(
  client: DataClient,
  input: {
    recordId: string
    protocolVersionId?: string | null
    reason?: string
  },
): Promise<void> {
  await client.rpc('start_experiment', {
    p_record_id: input.recordId,
    p_expected_metadata_version: await currentMetadataVersion(
      client,
      input.recordId,
    ),
    p_protocol_version_id: input.protocolVersionId || null,
    p_reason: input.reason?.trim() || 'Started from the experiment page',
  })
}

/** Hold or resume. The server requires a reason for every move after draft. */
export async function setExperimentStatus(
  client: DataClient,
  input: {
    recordId: string
    status: 'on_hold' | 'in_progress'
    reason: string
  },
): Promise<void> {
  await client.rpc('set_experiment_status', {
    p_record_id: input.recordId,
    p_expected_metadata_version: await currentMetadataVersion(
      client,
      input.recordId,
    ),
    p_status: input.status,
    p_reason: input.reason.trim(),
  })
}

export async function archiveExperiment(
  client: DataClient,
  recordId: string,
): Promise<void> {
  await client.rpc('archive_record', {
    p_record_id: recordId,
    p_expected_metadata_version: await currentMetadataVersion(client, recordId),
  })
}

export async function deleteExperimentDraft(
  client: DataClient,
  recordId: string,
): Promise<void> {
  await client.rpc('delete_experiment_draft', { p_record_id: recordId })
}

export async function moveExperimentToProject(
  client: DataClient,
  input: { recordId: string; projectId: string },
): Promise<void> {
  await client.rpc('move_record_to_project', {
    p_record_id: input.recordId,
    p_project_id: input.projectId,
    p_expected_metadata_version: await currentMetadataVersion(
      client,
      input.recordId,
    ),
  })
}

/** Blocks a new run starts with: the writing and the method, not the results. */
const STRUCTURE_BLOCK_TYPES = new Set(['rich_text', 'callout', 'checklist'])

interface BlockForRun {
  type: string
  payload: Record<string, unknown>
  payloadSchemaVersion: number
  order: number
}

/** The source's blocks as a fresh run needs them: checklists start unchecked. */
export function blocksForNewRun(blocks: BlockForRun[]) {
  const kept = [...blocks]
    .filter((block) => STRUCTURE_BLOCK_TYPES.has(block.type))
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({
      type: block.type,
      payload:
        block.type === 'checklist' && Array.isArray(block.payload.items)
          ? {
              ...block.payload,
              items: (block.payload.items as Record<string, unknown>[]).map(
                (item) => ({ ...item, checked: false }),
              ),
            }
          : block.payload,
      payload_schema_version: block.payloadSchemaVersion,
      order: index + 1,
    }))
  return kept.length > 0
    ? kept
    : [
        {
          type: 'rich_text',
          payload: EMPTY_RICH_TEXT_PAYLOAD,
          payload_schema_version: PAYLOAD_SCHEMA_VERSION,
          order: 1,
        },
      ]
}

/**
 * A new run of an experiment: the same structure and the same protocol, none of
 * the data. It carries the writing and the method, re-pins the protocol the
 * source followed, copies the reviewer and planned end, and writes a `follows`
 * link back to the source so the Overview can say which run came first.
 * Sheets, files and frozen results belong to the run that made them, so they
 * are not copied; Duplicate remains the way to take everything.
 */
export async function createNewRun(
  client: DataClient,
  input: {
    source: Pick<
      NotebookRecord,
      'id' | 'projectId' | 'identifier' | 'title' | 'tags'
    >
    title: string
    /** Start the new run now, on this protocol version. */
    startOnProtocolVersionId?: string | null
  },
): Promise<NotebookRecord> {
  const { source } = input
  if (!source.projectId) {
    throw new Error(
      'This experiment is not in a project, so it cannot be repeated.',
    )
  }
  const blocks = await fetchBlocksForRecord(client, source.id)
  const result = await client.rpc<{ record: RecordWire; blocks: BlockWire[] }>(
    'create_record_with_blocks',
    {
      p_project_id: source.projectId,
      p_kind: 'experiment',
      p_title: input.title.trim() || `${source.title} (run 2)`,
      p_status: 'draft',
      p_tags: source.tags,
      p_blocks: blocksForNewRun(blocks),
      p_properties: {},
    },
  )
  const record = toRecord(result.record)

  const sourceRow = (
    await client.list<{
      reviewer_user_id: string | null
      planned_end: string | null
    }>(
      'records',
      `?id=eq.${source.id}&select=reviewer_user_id,planned_end&limit=1`,
    )
  ).at(0)
  if (sourceRow?.reviewer_user_id) {
    await client.rpc('set_experiment_fields', {
      p_record_id: record.id,
      p_reviewer_user_id: sourceRow.reviewer_user_id,
      p_planned_end: null,
    })
  }

  const protocolLink = (
    await client.list<{ target_record_id: string | null }>(
      'record_links',
      `?source_record_id=eq.${source.id}&link_type=eq.protocol&select=target_record_id&limit=1`,
    )
  ).at(0)
  if (protocolLink?.target_record_id) {
    await applyExperimentSetup(client, record.id, {
      protocolRecordId: protocolLink.target_record_id,
    })
    await insertPinnedProtocol(client, record.id, protocolLink.target_record_id)
  }

  await client.rpc('create_record_link', {
    p_source_record_id: record.id,
    p_target_kind: 'experiment',
    p_target_identifier: source.identifier,
    p_link_type: 'follows',
    p_target_record_id: source.id,
    p_label: null,
  })

  if (input.startOnProtocolVersionId !== undefined) {
    await startExperimentRecord(client, {
      recordId: record.id,
      protocolVersionId: input.startOnProtocolVersionId,
      reason: `New run of ${source.identifier}`,
    })
  }
  return record
}
