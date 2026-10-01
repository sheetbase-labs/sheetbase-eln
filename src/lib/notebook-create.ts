/**
 * Blank Notebook create (PC-01 enabling slice).
 * Uses the existing create_record_with_blocks RPC — no Template required.
 */
import type { DataClient } from '#/lib/data-client'
import { EMPTY_RICH_TEXT_PAYLOAD, PAYLOAD_SCHEMA_VERSION } from '#/lib/blocks'
import { toRecord } from '#/lib/notebook-data'
import type { BlockWire, NotebookRecord, RecordWire } from '#/lib/notebook-data'

export async function createBlankExperiment(
  client: DataClient,
  input: {
    projectId: string
    title: string
    /** Record properties, e.g. reviewer_user_id and planned_end. */
    properties?: Record<string, unknown>
  },
): Promise<NotebookRecord> {
  const title = input.title.trim() || 'Untitled experiment'
  const result = await client.rpc<{ record: RecordWire; blocks: BlockWire[] }>(
    'create_record_with_blocks',
    {
      p_project_id: input.projectId,
      p_kind: 'experiment',
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
 * (samples and reagents) onto the new record. Both go through
 * `create_record_link`, so the rules stay in the database.
 */
export async function applyExperimentSetup(
  client: DataClient,
  recordId: string,
  input: { protocolRecordId?: string; copyFromRecordId?: string },
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

  if (input.copyFromRecordId) {
    const links = await client.list<{
      target_kind: string
      target_identifier: string
      link_type: string
      target_record_id: string | null
    }>(
      'record_links',
      `?source_record_id=eq.${encodeURIComponent(input.copyFromRecordId)}&link_type=in.(sample,reagent)&select=target_kind,target_identifier,link_type,target_record_id`,
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
