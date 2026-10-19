/**
 * Blank Notebook create (PC-01 enabling slice).
 * Uses the existing create_record_with_blocks RPC — no Template required.
 */
import type { DataClient } from '#/lib/data-client'
import { EMPTY_RICH_TEXT_PAYLOAD, PAYLOAD_SCHEMA_VERSION } from '#/lib/blocks'
import { toRecord } from '#/lib/notebook-data'
import { insertBlock } from '#/lib/notebook-mutations'
import { isDuplicateLinkError } from '#/lib/scientific-records'
import { pinProtocolReference } from '#/lib/protocol-materials'
import type { BlockWire, NotebookRecord, RecordWire } from '#/lib/notebook-data'

export async function createBlankExperiment(
  client: DataClient,
  input: {
    projectId: string
    title: string
    /** Defaults to an experiment; a protocol is created the same way. */
    kind?: 'experiment' | 'protocol_template'
    /** Record properties, e.g. reviewer_user_id and planned_end. */
    properties?: Record<string, unknown>
  },
): Promise<NotebookRecord> {
  const kind = input.kind ?? 'experiment'
  const title =
    input.title.trim() ||
    (kind === 'protocol_template' ? 'Untitled protocol' : 'Untitled experiment')
  const result = await client.rpc<{ record: RecordWire; blocks: BlockWire[] }>(
    'create_record_with_blocks',
    {
      p_project_id: input.projectId,
      p_kind: kind,
      p_title: title,
      p_status: 'draft',
      p_tags: [],
      p_blocks: [
        {
          type: 'rich_text',
          payload: EMPTY_RICH_TEXT_PAYLOAD,
          payload_schema_version: PAYLOAD_SCHEMA_VERSION,
          order: 1,
        },
      ],
      p_properties: input.properties ?? {},
    },
  )
  return toRecord(result.record)
}

/**
 * Apply the optional new-experiment choices after creation: link the protocol
 * the experiment follows, and copy the source experiment's linked materials
 * (samples and materials) onto the new record. Both go through
 * `create_record_link`, so the rules stay in the database.
 */
export async function applyExperimentSetup(
  client: DataClient,
  recordId: string,
  input: {
    protocolRecordId?: string
    copyFromRecordId?: string
    /** A sample the experiment is created for. */
    sampleRecordId?: string
  },
): Promise<void> {
  if (input.protocolRecordId) {
    const protocol = (
      await client.list<{ identifier: string }>(
        'records',
        `?id=eq.${encodeURIComponent(input.protocolRecordId)}&select=identifier`,
      )
    ).at(0)
    if (protocol) {
      await client.rpc('create_record_link', {
        p_source_record_id: recordId,
        p_target_kind: 'protocol_template',
        p_target_identifier: protocol.identifier,
        p_link_type: 'protocol',
        p_target_record_id: input.protocolRecordId,
        p_label: null,
      })
    }
  }

  if (input.sampleRecordId) {
    const sample = (
      await client.list<{ identifier: string }>(
        'records',
        `?id=eq.${encodeURIComponent(input.sampleRecordId)}&select=identifier`,
      )
    ).at(0)
    if (sample) {
      await client.rpc('create_record_link', {
        p_source_record_id: recordId,
        p_target_kind: 'sample',
        p_target_identifier: sample.identifier,
        p_link_type: 'sample',
        p_target_record_id: input.sampleRecordId,
        p_label: null,
      })
    }
  }

  if (input.copyFromRecordId) {
    const links = await client.list<{
      target_kind: string
      target_identifier: string
      link_type: string
      target_record_id: string | null
    }>(
      'record_links',
      `?source_record_id=eq.${encodeURIComponent(input.copyFromRecordId)}&link_type=in.(sample,material)&select=target_kind,target_identifier,link_type,target_record_id`,
    )
    for (const link of links) {
      await client.rpc('create_record_link', {
        p_source_record_id: recordId,
        p_target_kind: link.target_kind,
        p_target_identifier: link.target_identifier,
        p_link_type: link.link_type,
        p_target_record_id: link.target_record_id,
        p_label: null,
      })
    }
  }
}

/**
 * Put the protocol an experiment follows into its notebook: a protocol block
 * pinned to the protocol's current revision, with the procedure copied in as
 * steps the author can tick off. The pin is the server's (`pin_protocol_reference`),
 * so the steps in the notebook are exactly the steps of the pinned revision.
 */
export async function insertPinnedProtocol(
  client: DataClient,
  recordId: string,
  protocolRecordId: string,
): Promise<void> {
  const inserted = await insertBlock(client, {
    recordId,
    type: 'protocol_reference',
    payload: {},
  })
  await pinProtocolReference(client, {
    blockId: inserted.block.id,
    protocolRecordId,
    expectedBlockVersion: inserted.block.version,
    expectedStructureVersion: inserted.structureVersion,
  })
}

/**
 * Relate an experiment to a sample in `record_links`, keyed by the sample's
 * display identifier. Linking the same sample twice is not an error: the
 * relationship is already recorded once. A locked experiment or a rule
 * violation surfaces as the database's own error.
 */
export async function linkExperimentToSample(
  client: DataClient,
  experimentId: string,
  sample: { identifier: string; recordId: string },
): Promise<void> {
  try {
    await client.rpc('create_record_link', {
      p_source_record_id: experimentId,
      p_target_kind: 'sample',
      p_target_identifier: sample.identifier,
      p_link_type: 'sample',
      p_target_record_id: sample.recordId,
      p_label: null,
    })
  } catch (error) {
    if (!isDuplicateLinkError(error)) throw error
  }
}
