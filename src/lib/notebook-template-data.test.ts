import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { instantiateNotebookTemplateVersion } from './notebook-template-data'
import type { NotebookTemplateInstantiationResult } from './notebook-template-data'

/** The arguments the transport hands an RPC. */
type RpcArguments = Parameters<DataClient['rpc']>[1]

/** The instantiation answer, without the composition the fixture leaves out. */
type RpcAnswerResult = Omit<NotebookTemplateInstantiationResult, 'composition'>

type RpcAnswer = (name: string, args: RpcArguments) => RpcAnswerResult

function makeClient(rpcAnswer: RpcAnswer): DataClient {
  // SAFETY: this double answers only the one RPC `instantiateNotebookTemplateVersion` issues; `rpc` is a spy narrowed to the transport's generic signature, and the remaining methods exist to satisfy `DataClient`, never called on this path.
  const client: DataClient = {
    list: async <T>(): Promise<T[]> => [],
    insert: async <T>(): Promise<T> => ({}) as T,
    patch: async <T>(): Promise<T[]> => [],
    count: async () => 0,
    remove: async () => [],
    rpc: vi.fn(async (name: string, args: RpcArguments) =>
      rpcAnswer(name, args),
    ) as DataClient['rpc'],
  }

  return client
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
