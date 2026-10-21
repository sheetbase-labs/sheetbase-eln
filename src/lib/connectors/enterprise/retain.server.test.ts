// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import type * as FileStorage from '#/lib/file-storage'

import { retainExternalBytes } from './retain.server'

vi.mock('#/env.server', () => ({ env: { FILE_STORAGE_BACKEND: 'filesystem' } }))
vi.mock('#/lib/file-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof FileStorage>()
  return {
    ...actual,
    getObjectStorage: () => ({
      putStream: async () => ({ byteSize: 3n, checksum: 'c'.repeat(64) }),
      delete: async () => undefined,
    }),
  }
})

const fileObject = {
  id: 'obj-1',
  storage_key: 'pending/obj-1',
  status: 'pending',
  version: 1,
}

describe('retainExternalBytes', () => {
  it('reads the record from the one-row array PostgREST returns for create_file_upload', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'create_file_upload'
        ? ([{ record_id: 'rec-1', identifier: 'FIL-001' }] as never)
        : {},
    )
    const retained = await retainExternalBytes({
      workspaceId: 'ws',
      projectId: 'proj',
      fileName: 'run.csv',
      bytes: new TextEncoder().encode('abc'),
      rpc,
      readFileObject: async () => fileObject,
    })
    expect(retained.fileRecordId).toBe('rec-1')
    expect(rpc).toHaveBeenCalledWith(
      'finalize_file_upload',
      expect.objectContaining({ p_file_id: 'obj-1' }),
    )
  })

  it('still accepts a single row object', async () => {
    const retained = await retainExternalBytes({
      workspaceId: 'ws',
      projectId: 'proj',
      fileName: 'run.csv',
      bytes: new TextEncoder().encode('abc'),
      rpc: async (name) =>
        name === 'create_file_upload' ? { record_id: 'rec-2' } : {},
      readFileObject: async () => fileObject,
    })
    expect(retained.fileRecordId).toBe('rec-2')
  })
})
