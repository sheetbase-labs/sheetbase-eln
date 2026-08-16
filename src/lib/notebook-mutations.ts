/**
 * Notebook mutation helpers (ELN-005). Thin, typed wrappers around the
 * ELN-003/0011 RPCs the editable notebook uses: update a block's payload,
 * insert a block, duplicate a block, and delete a block. Each helper maps
 * the PostgREST wire shape to the camelCase domain shape from
 * `notebook-data` and surfaces `DataClientError` so the route can branch on
 * stable error categories (`stale_version`, `validation_error`, …).
 *
 * The route owns optimistic-concurrency versions and invalidation; these
 * helpers are stateless and only translate args and results.
 */

import type { DataClient } from '#/lib/data-client'
import { toBlock } from '#/lib/notebook-data'
import type { BlockWire, NotebookBlock } from '#/lib/notebook-data'
import { EMPTY_RICH_TEXT_PAYLOAD, PAYLOAD_SCHEMA_VERSION } from '#/lib/blocks'
import { isCanonicalSheetBlock, isLegacySheetBlock } from '#/lib/sheet-block'

export interface UpdateBlockArgs {
  blockId: string
  payload: Record<string, unknown>
  expectedVersion: number
  payloadSchemaVersion?: number
}

export async function updateBlockPayload(
  client: DataClient,
  args: UpdateBlockArgs,
): Promise<NotebookBlock> {
  const row = await client.rpc<BlockWire>('update_block_payload', {
    p_block_id: args.blockId,
    p_payload: args.payload,
    p_expected_version: args.expectedVersion,
    p_payload_schema_version:
      args.payloadSchemaVersion ?? PAYLOAD_SCHEMA_VERSION,
  })
  return toBlock(row)
}

export interface InsertBlockArgs {
  recordId: string
  type: string
  payload: Record<string, unknown>
  /** Insert after this block id. Omit to append at the end. */
  afterBlockId?: string
  /** Expected record structure_version; a mismatch raises stale_version. */
  expectedStructureVersion?: number
  payloadSchemaVersion?: number
}

export interface InsertBlockResult {
  block: NotebookBlock
  structureVersion: number
}

export async function insertBlock(
  client: DataClient,
  args: InsertBlockArgs,
): Promise<InsertBlockResult> {
  const res = await client.rpc<{ block: BlockWire; structure_version: number }>(
    'insert_block',
    {
      p_record_id: args.recordId,
      p_type: args.type,
      p_payload: args.payload,
      p_payload_schema_version:
        args.payloadSchemaVersion ?? PAYLOAD_SCHEMA_VERSION,
      p_after_block_id: args.afterBlockId ?? null,
      p_expected_structure_version: args.expectedStructureVersion ?? null,
    },
  )
  return {
    block: toBlock(res.block),
    structureVersion: res.structure_version,
  }
}

export async function insertSheetBlock(
  client: DataClient,
  args: Pick<
    InsertBlockArgs,
    'recordId' | 'afterBlockId' | 'expectedStructureVersion'
  > & { datasetSchemaId?: string },
): Promise<InsertBlockResult & { tableId: string }> {
  const res = await client.rpc<{
    block: BlockWire
    table: { id: string }
    structure_version: number
  }>('insert_sheet_block', {
    p_record_id: args.recordId,
    p_after_block_id: args.afterBlockId ?? null,
    p_expected_structure_version: args.expectedStructureVersion ?? null,
    p_dataset_schema_id: args.datasetSchemaId ?? null,
  })
  return {
    block: toBlock(res.block),
    tableId: res.table.id,
    structureVersion: res.structure_version,
  }
}

export async function insertSheetInstanceBlock(
  client: DataClient,
  args: Pick<
    InsertBlockArgs,
    'recordId' | 'afterBlockId' | 'expectedStructureVersion'
  > & { instanceId?: string | null },
): Promise<InsertBlockResult & { instanceId: string }> {
  const res = await client.rpc<{
    block: BlockWire
    instance: { id: string }
    structure_version: number
  }>('insert_sheet_instance_block', {
    p_record_id: args.recordId,
    p_after_block_id: args.afterBlockId ?? null,
    p_expected_structure_version: args.expectedStructureVersion ?? null,
    p_instance_id: args.instanceId ?? null,
  })
  return {
    block: toBlock(res.block),
    instanceId: res.instance.id,
    structureVersion: res.structure_version,
  }
}

export async function convertLegacySheetBlock(
  client: DataClient,
  args: { blockId: string; expectedVersion: number },
): Promise<{ block: NotebookBlock; instanceId: string }> {
  const res = await client.rpc<{
    block: BlockWire
    instance: { id: string }
  }>('convert_legacy_sheet_block', {
    p_block_id: args.blockId,
    p_expected_version: args.expectedVersion,
  })
  return {
    block: toBlock(res.block),
    instanceId: res.instance.id,
  }
}

export interface DuplicateBlockArgs {
  block: NotebookBlock
  expectedStructureVersion: number
}

/**
 * Duplicate a block by inserting a copy with the same type and payload
 * immediately after the source. Canonical Sheet Instance blocks duplicate
 * the Instance independently rather than sharing it. Legacy scientific-table
 * blocks cannot be duplicated without copying their table.
 */
export async function duplicateBlock(
  client: DataClient,
  args: DuplicateBlockArgs,
): Promise<InsertBlockResult> {
  if (args.block.type === 'sheet' && isLegacySheetBlock(args.block.payload)) {
    throw new Error(
      'Sheet blocks cannot be duplicated without copying their table.',
    )
  }
  if (args.block.type === 'sheet' && isCanonicalSheetBlock(args.block.payload)) {
    const res = await client.rpc<{
      block: BlockWire
      instance: { id: string }
      structure_version: number
    }>('duplicate_sheet_instance_block', {
      p_block_id: args.block.id,
      p_expected_structure_version: args.expectedStructureVersion,
    })
    return {
      block: toBlock(res.block),
      structureVersion: res.structure_version,
    }
  }
  return insertBlock(client, {
    recordId: args.block.recordId,
    type: args.block.type,
    payload: args.block.payload,
    afterBlockId: args.block.id,
    expectedStructureVersion: args.expectedStructureVersion,
    payloadSchemaVersion: args.block.payloadSchemaVersion,
  })
}

export interface DeleteBlockResult {
  structureVersion: number
  order: Array<{ id: string; order: number }>
}

export async function deleteBlock(
  client: DataClient,
  args: { blockId: string; expectedStructureVersion?: number },
): Promise<DeleteBlockResult> {
  const res = await client.rpc<{
    structure_version: number
    order: Array<{ id: string; order: number }>
  }>('delete_block', {
    p_block_id: args.blockId,
    p_expected_structure_version: args.expectedStructureVersion ?? null,
  })
  return {
    structureVersion: res.structure_version,
    order: res.order,
  }
}

export interface MoveBlockArgs {
  blockId: string
  /** Block that should immediately precede the moved block after the move. */
  afterBlockId?: string | null
  /** Block that should immediately follow the moved block after the move. */
  beforeBlockId?: string | null
  expectedStructureVersion?: number
}

export interface MoveBlockResult {
  block: NotebookBlock
  structureVersion: number
  rebalanced: boolean
  order: Array<{ id: string; order: number }>
}

/**
 * Atomically reorder a block via fractional indexing (ELN-006). Either
 * neighbour may be null: (null, B) → start; (A, null) → end; (A, B) →
 * between A and B; (null, null) → end. The caller supplies the record
 * structure_version it last saw; a mismatch raises stale_version.
 */
export async function moveBlock(
  client: DataClient,
  args: MoveBlockArgs,
): Promise<MoveBlockResult> {
  const res = await client.rpc<{
    block: BlockWire
    structure_version: number
    rebalanced: boolean
    order: Array<{ id: string; order: number }>
  }>('move_block', {
    p_block_id: args.blockId,
    p_after_block_id: args.afterBlockId ?? null,
    p_before_block_id: args.beforeBlockId ?? null,
    p_expected_structure_version: args.expectedStructureVersion ?? null,
  })
  return {
    block: toBlock(res.block),
    structureVersion: res.structure_version,
    rebalanced: res.rebalanced,
    order: res.order,
  }
}

/**
 * Default payloads for the editable block types (ELN-005). Each starts
 * minimal and valid so the new block enters editing focus immediately
 * without surfacing a validation error first.
 */
export function defaultPayloadFor(type: string): Record<string, unknown> {
  switch (type) {
    case 'rich_text':
      return { ...EMPTY_RICH_TEXT_PAYLOAD }
    case 'checklist':
      return { items: [{ text: '', checked: false }] }
    case 'linked_record':
      return {
        targetKind: 'experiment',
        targetIdentifier: '',
        linkType: 'general',
        label: '',
      }
    case 'protocol_reference':
      return {}
    case 'materials':
      return { items: [] }
    // SCI-004: a chart starts as an empty draft `{}` (valid) so the editor
    // opens immediately; the user picks a dataset, fields and chart type.
    case 'chart':
      return {}
    // SCI-005: a plate map starts as an empty draft `{}` (valid) so the
    // editor opens immediately; the user sets dimensions and assigns wells.
    case 'plate_map':
      return {}
    default:
      return {}
  }
}
