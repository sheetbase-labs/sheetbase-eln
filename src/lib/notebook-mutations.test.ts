/**
 * Unit tests for the notebook mutation helpers (ELN-005). The helpers are
 * thin typed wrappers around PostgREST RPCs; these tests pin the wire args
 * and the camelCase mapping of the results using a stub DataClient.
 */
import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import {
  defaultPayloadFor,
  deleteBlock,
  duplicateBlock,
  insertBlock,
  moveBlock,
  updateBlockPayload,
} from './notebook-mutations'
import type { NotebookBlock } from './notebook-data'

function makeClient(
  rpcImpl: (name: string, args: Record<string, unknown>) => unknown,
): DataClient {
  return {
    list: vi.fn(async () => []),
    insert: vi.fn(async () => ({})) as unknown as DataClient['insert'],
    patch: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    remove: vi.fn(async () => []),
    rpc: vi.fn(async (name, args) =>
      rpcImpl(name, args),
    ) as unknown as DataClient['rpc'],
  }
}

const blockWire = {
  id: 'b1',
  record_id: 'r1',
  type: 'rich_text',
  payload: {
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
    },
  },
  payload_schema_version: 1,
  order: 1.5,
  version: 2,
  created_at: '2026-07-19T00:00:00.000Z',
  updated_at: '2026-07-19T00:00:00.000Z',
}

describe('updateBlockPayload', () => {
  it('calls update_block_payload with the snake_case args and maps the result', async () => {
    const client = makeClient(() => blockWire)
    const block = await updateBlockPayload(client, {
      blockId: 'b1',
      payload: blockWire.payload,
      expectedVersion: 1,
    })
    expect(client.rpc).toHaveBeenCalledWith('update_block_payload', {
      p_block_id: 'b1',
      p_payload: blockWire.payload,
      p_expected_version: 1,
      p_payload_schema_version: 1,
    })
    expect(block).toEqual({
      id: 'b1',
      recordId: 'r1',
      type: 'rich_text',
      payload: blockWire.payload,
      payloadSchemaVersion: 1,
      order: 1.5,
      version: 2,
    })
  })
})

describe('insertBlock', () => {
  it('appends when afterBlockId is omitted and returns the bumped structure_version', async () => {
    const client = makeClient(() => ({
      block: blockWire,
      structure_version: 5,
    }))
    const res = await insertBlock(client, {
      recordId: 'r1',
      type: 'rich_text',
      payload: blockWire.payload,
      expectedStructureVersion: 4,
    })
    expect(client.rpc).toHaveBeenCalledWith('insert_block', {
      p_record_id: 'r1',
      p_type: 'rich_text',
      p_payload: blockWire.payload,
      p_payload_schema_version: 1,
      p_after_block_id: null,
      p_expected_structure_version: 4,
    })
    expect(res.structureVersion).toBe(5)
    expect(res.block.id).toBe('b1')
  })

  it('passes afterBlockId through when supplied', async () => {
    const client = makeClient(() => ({
      block: blockWire,
      structure_version: 2,
    }))
    await insertBlock(client, {
      recordId: 'r1',
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'x' }],
            },
          ],
        },
      },
      afterBlockId: 'anchor',
    })
    expect(client.rpc).toHaveBeenCalledWith(
      'insert_block',
      expect.objectContaining({
        p_after_block_id: 'anchor',
        p_expected_structure_version: null,
      }),
    )
  })
})

describe('duplicateBlock', () => {
  it('inserts a copy of the source block after it', async () => {
    const client = makeClient((_name, args) => ({
      block: { ...blockWire, id: 'b2', record_id: args.p_record_id },
      structure_version: 3,
    }))
    const source: NotebookBlock = {
      id: 'b1',
      recordId: 'r1',
      type: 'checklist',
      payload: { items: [{ text: 'a', checked: false }] },
      payloadSchemaVersion: 1,
      order: 1,
      version: 1,
    }
    const res = await duplicateBlock(client, {
      block: source,
      expectedStructureVersion: 2,
    })
    expect(client.rpc).toHaveBeenCalledWith('insert_block', {
      p_record_id: 'r1',
      p_type: 'checklist',
      p_payload: { items: [{ text: 'a', checked: false }] },
      p_payload_schema_version: 1,
      p_after_block_id: 'b1',
      p_expected_structure_version: 2,
    })
    expect(res.block.id).toBe('b2')
    expect(res.structureVersion).toBe(3)
  })
})

describe('deleteBlock', () => {
  it('returns the bumped structure_version and surviving order list', async () => {
    const client = makeClient(() => ({
      structure_version: 4,
      order: [{ id: 'b2', order: 2 }],
    }))
    const res = await deleteBlock(client, {
      blockId: 'b1',
      expectedStructureVersion: 3,
    })
    expect(client.rpc).toHaveBeenCalledWith('delete_block', {
      p_block_id: 'b1',
      p_expected_structure_version: 3,
    })
    expect(res.structureVersion).toBe(4)
    expect(res.order).toEqual([{ id: 'b2', order: 2 }])
  })
})

describe('moveBlock', () => {
  it('passes snake_case args with null neighbours and maps the result', async () => {
    const client = makeClient(() => ({
      block: blockWire,
      structure_version: 6,
      rebalanced: false,
      order: [
        { id: 'b2', order: 1 },
        { id: 'b1', order: 2 },
      ],
    }))
    const res = await moveBlock(client, {
      blockId: 'b1',
      afterBlockId: null,
      beforeBlockId: null,
      expectedStructureVersion: 5,
    })
    expect(client.rpc).toHaveBeenCalledWith('move_block', {
      p_block_id: 'b1',
      p_after_block_id: null,
      p_before_block_id: null,
      p_expected_structure_version: 5,
    })
    expect(res.structureVersion).toBe(6)
    expect(res.rebalanced).toBe(false)
    expect(res.order).toEqual([
      { id: 'b2', order: 1 },
      { id: 'b1', order: 2 },
    ])
    expect(res.block.id).toBe('b1')
  })

  it('passes both neighbours through when supplied', async () => {
    const client = makeClient(() => ({
      block: blockWire,
      structure_version: 2,
      rebalanced: false,
      order: [],
    }))
    await moveBlock(client, {
      blockId: 'b1',
      afterBlockId: 'b2',
      beforeBlockId: 'b3',
      expectedStructureVersion: 1,
    })
    expect(client.rpc).toHaveBeenCalledWith('move_block', {
      p_block_id: 'b1',
      p_after_block_id: 'b2',
      p_before_block_id: 'b3',
      p_expected_structure_version: 1,
    })
  })

  it('defaults omitted neighbours and version to null', async () => {
    const client = makeClient(() => ({
      block: blockWire,
      structure_version: 1,
      rebalanced: true,
      order: [],
    }))
    await moveBlock(client, { blockId: 'b1' })
    expect(client.rpc).toHaveBeenCalledWith('move_block', {
      p_block_id: 'b1',
      p_after_block_id: null,
      p_before_block_id: null,
      p_expected_structure_version: null,
    })
  })

  it('preserves rebalanced=true from the RPC', async () => {
    const client = makeClient(() => ({
      block: blockWire,
      structure_version: 9,
      rebalanced: true,
      order: [{ id: 'b1', order: 1 }],
    }))
    const res = await moveBlock(client, {
      blockId: 'b1',
      afterBlockId: null,
      beforeBlockId: null,
      expectedStructureVersion: 8,
    })
    expect(res.rebalanced).toBe(true)
  })
})

describe('defaultPayloadFor', () => {
  it('returns a valid payload for each editable type', () => {
    expect(defaultPayloadFor('rich_text')).toEqual({
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    expect(defaultPayloadFor('checklist')).toEqual({
      items: [{ text: '', checked: false }],
    })
    expect(defaultPayloadFor('linked_record')).toEqual({
      targetKind: 'experiment',
      targetIdentifier: '',
      linkType: 'general',
      label: '',
    })
  })

  it('returns an empty object for unknown types', () => {
    expect(defaultPayloadFor('chart')).toEqual({})
    expect(defaultPayloadFor('analysis_reference')).toEqual({})
  })
})
