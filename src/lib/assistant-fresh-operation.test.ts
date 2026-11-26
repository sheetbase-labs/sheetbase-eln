import { describe, expect, it } from 'vitest'
import type { AgentOperation } from '#/lib/agent-operations'
import { withCurrentStructureVersion } from './assistant-fresh-operation'

const insert = (expectedRevision: number): AgentOperation => ({
  kind: 'notebook_block.insert',
  recordId: '00000000-0000-4000-8000-000000000001',
  afterBlockId: null,
  block: { type: 'rich_text', payload: {}, payloadSchemaVersion: 1 },
  expectedRevision,
})

function clientAt(version: number | null) {
  const reads: string[] = []

  const rows: unknown[] =
    version === null ? [] : [{ structure_version: version }]

  async function list<T>(resource: string): Promise<T[]> {
    reads.push(resource)

    // SAFETY: the one query the code under test makes asks for this row shape.
    return rows as T[]
  }

  return { client: { list }, reads }
}

describe('withCurrentStructureVersion', () => {
  it('lets a second milestone card apply after the first changed the notebook', async () => {
    const fresh = await withCurrentStructureVersion(
      clientAt(7).client,
      insert(5),
    )

    expect(fresh).toMatchObject({
      kind: 'notebook_block.insert',
      expectedRevision: 7,
    })
  })

  it('keeps the built version when the notebook cannot be read', async () => {
    const fresh = await withCurrentStructureVersion(
      clientAt(null).client,
      insert(5),
    )

    expect(fresh).toMatchObject({ expectedRevision: 5 })
  })

  it('leaves other operations alone and does not read anything', async () => {
    const { client, reads } = clientAt(9)

    const operation: AgentOperation = {
      kind: 'notebook_block.delete',
      blockId: '00000000-0000-4000-8000-000000000002',
      expectedStructureVersion: 1,
    }

    expect(await withCurrentStructureVersion(client, operation)).toBe(operation)

    expect(reads).toEqual([])
  })
})
