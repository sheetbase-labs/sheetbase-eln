import { describe, expect, it } from 'vitest'

import {
  discoverObjectDependencies,
  previewHardDelete,
} from './object-dependencies'
import type { DataClient } from './data-client'

/** A data client for these tests: the RPCs these helpers call, and no others. */
function asClient<Stub>(client: Stub): DataClient {
  // SAFETY: the call site supplies exactly the rpc method these helpers read,
  // answering the shape they decode; no other method is called.
  return client as DataClient
}

describe('object dependency client', () => {
  it('calls the discovery and hard-delete preview RPCs', async () => {
    const calls: string[] = []

    const client = asClient({
      rpc: async (name: string) => {
        calls.push(name)

        return {
          kind: 'dataset_schema_version',
          id: 'ver-1',
          allowed: false,
          blocking: [],
          dependencies: [],
        }
      },
    })

    await discoverObjectDependencies(client, 'dataset_schema_version', 'ver-1')
    await previewHardDelete(client, 'dataset_schema_version', 'ver-1')
    expect(calls).toEqual([
      'discover_object_dependencies',
      'preview_hard_delete',
    ])
  })
})
