import { describe, expect, it, vi } from 'vitest'
import type { AgentOperation } from '#/lib/agent-operations'
import type { DataClient } from '#/lib/data-client'
import { withCurrentStructureVersion } from './assistant-fresh-operation'

const insert = (expectedRevision: number): AgentOperation => ({
  kind: 'notebook_block.insert',
  recordId: '00000000-0000-4000-8000-000000000001',
  afterBlockId: null,
  block: { type: 'rich_text', payload: {}, payloadSchemaVersion: 1 },
  expectedRevision,
})

const clientAt = (version: number | null) =>
  ({
    list: vi.fn(async () =>
      version === null ? [] : [{ structure_version: version }],
    ),
  }) as unknown as DataClient

describe('withCurrentStructureVersion', () => {
  it('lets a second milestone card apply after the first changed the notebook', async () => {
    const fresh = await withCurrentStructureVersion(clientAt(7), insert(5))

    expect(fresh).toMatchObject({
      kind: 'notebook_block.insert',
      expectedRevision: 7,
    })
  })

  it('keeps the built version when the notebook cannot be read', async () => {
    const fresh = await withCurrentStructureVersion(clientAt(null), insert(5))

    expect(fresh).toMatchObject({ expectedRevision: 5 })
  })

  it('leaves other operations alone and does not read anything', async () => {
    const client = clientAt(9)
    const update: AgentOperation = {
      kind: 'notebook_block.delete',
      blockId: 'x',
      expectedRevision: 1,
    } as AgentOperation

    expect(await withCurrentStructureVersion(client, update)).toBe(update)
    expect(client.list).not.toHaveBeenCalled()
  })
})
