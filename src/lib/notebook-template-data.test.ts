import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { instantiateNotebookTemplateVersion } from './notebook-template-data'

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

describe('instantiateNotebookTemplateVersion', () => {
  it('calls instantiate_notebook_template_version with independent-Instance semantics', async () => {
    const client = makeClient(() => ({
      record: { id: 'r1', project_id: 'p1', identifier: 'EXP-2026-0001' },
      templateVersionId: 'v1',
      idempotent: false,
    }))
    const result = await instantiateNotebookTemplateVersion(
      {
        versionId: 'v1',
        targetProjectId: 'p1',
        title: 'Run A',
        idempotencyKey: 'idem-a',
      },
      client,
    )
    expect(client.rpc).toHaveBeenCalledWith(
      'instantiate_notebook_template_version',
      {
        p_version_id: 'v1',
        p_target_project_id: 'p1',
        p_title: 'Run A',
        p_parameter_inputs: [],
        p_idempotency_key: 'idem-a',
      },
    )
    expect(result.idempotent).toBe(false)
    expect(result.record.id).toBe('r1')
  })
})
