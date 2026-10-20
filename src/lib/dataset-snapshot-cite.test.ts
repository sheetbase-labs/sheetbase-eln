import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { citeSnapshotInNotebook } from './dataset-snapshot-cite'

const input = {
  recordId: '00000000-0000-4000-8000-000000000351',
  datasetId: '00000000-0000-4000-8000-000000000381',
  datasetIdentifier: 'DS-0311',
  datasetName: 'ELISA capsid titre and turbidity',
  versionId: '00000000-0000-4000-8000-0000000009a1',
  versionLabel: 'v3',
  contentHash: 'sha256:abc',
}

function clientWith(linkError?: unknown) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const client = {
    list: vi.fn(async () => [
      {
        id: input.recordId,
        identifier: 'EXP-0142',
        title: 'Run',
        kind: 'experiment',
        structure_version: 7,
      },
    ]),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (fn === 'create_record_link' && linkError) throw linkError
      if (fn === 'insert_block') {
        return {
          block: {
            id: 'block-1',
            record_id: input.recordId,
            type: 'linked_record',
            payload: args.p_payload,
            version: 1,
            order_key: 'a0',
          },
          structure_version: 8,
        }
      }
      return {}
    }),
  } as unknown as DataClient
  return { client, calls }
}

describe('citeSnapshotInNotebook', () => {
  it('inserts a record reference pinned to the snapshot and links the dataset', async () => {
    const { client, calls } = clientWith()
    const result = await citeSnapshotInNotebook(client, input)

    expect(result.blockId).toBe('block-1')
    const insert = calls.find((call) => call.fn === 'insert_block')
    expect(insert?.args.p_type).toBe('linked_record')
    expect(insert?.args.p_payload).toMatchObject({
      targetKind: 'dataset',
      targetIdentifier: 'DS-0311',
      targetId: input.datasetId,
      datasetVersionId: input.versionId,
      datasetVersionHash: 'sha256:abc',
      label: 'ELISA capsid titre and turbidity · snapshot v3',
    })
    const link = calls.find((call) => call.fn === 'create_record_link')
    expect(link?.args).toMatchObject({
      p_source_record_id: input.recordId,
      p_target_kind: 'dataset',
      p_target_identifier: 'DS-0311',
      p_link_type: 'dataset',
    })
  })

  it('does not fail when the dataset is already linked to the experiment', async () => {
    const duplicate = Object.assign(new Error('duplicate'), {
      status: 409,
      code: '23505',
    })
    const { client } = clientWith(duplicate)
    await expect(citeSnapshotInNotebook(client, input)).resolves.toBeTruthy()
  })
})
