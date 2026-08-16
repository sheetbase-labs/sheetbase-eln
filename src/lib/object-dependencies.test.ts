import { describe, expect, it } from 'vitest'

import {
  discoverObjectDependencies,
  previewHardDelete,
} from './object-dependencies'
import type { DataClient } from './data-client'

describe('object dependency client', () => {
  it('calls the discovery and hard-delete preview RPCs', async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return {
          kind: 'dataset_schema_version',
          id: 'ver-1',
          allowed: false,
          blocking: [],
          dependencies: [],
        }
      },
    } as DataClient
    await discoverObjectDependencies(client, 'dataset_schema_version', 'ver-1')
    await previewHardDelete(client, 'dataset_schema_version', 'ver-1')
    expect(calls.map((item) => item.name)).toEqual([
      'discover_object_dependencies',
      'preview_hard_delete',
    ])
  })
})
