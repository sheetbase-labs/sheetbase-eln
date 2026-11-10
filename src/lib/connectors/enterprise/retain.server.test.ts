// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  LocalFileStorage,
  setObjectStorageForTesting,
} from '#/lib/file-storage'
import { retainExternalBytes } from './retain.server'
import type { RetentionRpc } from './retain.server'

vi.hoisted(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test')
  vi.stubEnv(
    'FORMULA_DATABASE_URL',
    'postgresql://test:test@localhost:5432/test',
  )
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters')
  vi.stubEnv('PGRST_JWT_SECRET', 'test-jwt-secret-at-least-thirty-two-chars')
})

afterAll(() => vi.unstubAllEnvs())

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'connector-retention-'))
  setObjectStorageForTesting(new LocalFileStorage(root))
})

afterEach(async () => {
  setObjectStorageForTesting(null)
  await rm(root, { recursive: true, force: true })
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
        ? [{ record_id: 'rec-1', identifier: 'FIL-001' }]
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
    expect(retained.byteSize).toBe(3)
    expect(retained.checksum).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
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
      rpc: async (name): ReturnType<RetentionRpc> =>
        name === 'create_file_upload' ? { record_id: 'rec-2' } : {},
      readFileObject: async () => fileObject,
    })

    expect(retained.fileRecordId).toBe('rec-2')
  })

  it('rejects malformed creation receipts before writing any bytes', async () => {
    await expect(
      retainExternalBytes({
        workspaceId: 'ws',
        projectId: 'proj',
        fileName: 'run.csv',
        bytes: new TextEncoder().encode('abc'),
        rpc: async () => [{ record_id: 42 }],
        readFileObject: async () => fileObject,
      }),
    ).rejects.toThrow('File retention was rejected by the file platform.')
    expect(await readdir(root)).toEqual([])
  })

  it('deletes retained bytes when finalization is rejected', async () => {
    await expect(
      retainExternalBytes({
        workspaceId: 'ws',
        projectId: 'proj',
        fileName: 'run.csv',
        bytes: new TextEncoder().encode('abc'),
        rpc: async (name) =>
          name === 'create_file_upload'
            ? [{ record_id: 'rec-1' }]
            : { error: 'rejected' },
        readFileObject: async () => fileObject,
      }),
    ).rejects.toThrow('File retention failed during finalization.')

    const remaining = await readdir(root, {
      recursive: true,
      withFileTypes: true,
    })

    expect(remaining.some((entry) => entry.isFile())).toBe(false)
  })
})
