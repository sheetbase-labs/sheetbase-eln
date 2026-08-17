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
  input: { projectId: string; title: string },
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
      p_properties: {},
    },
  )
  return toRecord(result.record)
}
