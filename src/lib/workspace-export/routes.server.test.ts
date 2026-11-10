// @vitest-environment node
import { createHash } from 'node:crypto'
import { strFromU8, unzipSync } from 'fflate'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionAuthDeps } from '#/lib/request-auth'

import type { BackupDeps } from './backup.server'
import { handleBackupDownload, handleWorkspaceExport } from './routes.server'
import type { WorkspaceExportRouteDeps } from './routes.server'

vi.hoisted(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://unused:unused@127.0.0.1:1/unused')
  vi.stubEnv(
    'FORMULA_DATABASE_URL',
    'postgresql://unused:unused@127.0.0.1:1/unused',
  )
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters')
  vi.stubEnv('PGRST_JWT_SECRET', 'test-jwt-secret-at-least-thirty-two-chars')
})

afterAll(() => vi.unstubAllEnvs())

const WS = '00000000-0000-4000-8000-000000000002'
const BACKUP = '00000000-0000-4000-8000-0000000000b1'

const auth: SessionAuthDeps = {
  getSession: async () => ({ user: { id: 'u1' }, session: { id: 's1' } }),
  getWorkspaceForUser: async () => ({ id: WS }),
  mintToken: async () => 'token',
}

function setup(
  options: {
    canManage?: boolean
    backupRow?: { status?: 'failed'; storage_key?: string | null } | null
  } = {},
) {
  const queries: { text: string; values: unknown[] }[] = []
  const stored = new Uint8Array([1, 2, 3, 4, 5])
  const pool = new Pool()
  const archivePool = new Pool()
  let fetched = false

  vi.spyOn(archivePool, 'query').mockImplementation(async (text) => {
    let rows: object[] = []

    if (text.includes('FROM pg_class c')) {
      rows = [{ schema: 'api', name: 'workspaces', columns: ['id', 'name'] }]
    } else if (text.includes('FROM pg_constraint con')) {
      rows = []
    } else if (text.includes('SELECT id::text, name, slug')) {
      rows = [{ id: WS, name: 'My lab', slug: 'my lab!' }]
    } else if (text.startsWith('FETCH')) {
      rows = fetched
        ? []
        : [{ row: JSON.stringify({ id: WS, name: 'My lab' }) }]
      fetched = true
    } else if (text.includes('FROM api.file_objects')) {
      rows = [
        {
          id: 'file-1',
          record_id: null,
          storage_key: 'file-1',
          display_name: 'data.bin',
          media_type: 'application/octet-stream',
          byte_size: '5',
          checksum: null,
          checksum_algorithm: null,
        },
      ]
    } else if (!/^(BEGIN|DECLARE|CLOSE|COMMIT|ROLLBACK)/.test(text)) {
      throw new Error(`unexpected archive query: ${text}`)
    }

    return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] }
  })

  vi.spyOn(pool, 'query').mockImplementation(async (text, values) => {
    queries.push({ text, values })

    const rows = text.includes('FROM api.workspaces')
      ? [{ slug: 'my lab!' }]
      : text.includes('FROM internal.workspace_backups') &&
          options.backupRow !== null
        ? [
            {
              id: BACKUP,
              trigger: 'scheduled',
              status: 'succeeded',
              started_at: '2026-10-29T03:00:00Z',
              finished_at: '2026-10-29T03:01:00Z',
              destination: 'database',
              byte_size: '5',
              row_count: '42',
              storage_key: `backups/${WS}/b.zip`,
              ...options.backupRow,
            },
          ]
        : []

    return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] }
  })

  const storage = {
    putStream: async () => {
      throw new Error('unexpected write')
    },
    getStream: async () => ({
      stream: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(stored)
          c.close()
        },
      }),
      byteSize: stored.length,
    }),
    head: async () => {
      throw new Error('unexpected head')
    },
    delete: async () => {
      throw new Error('unexpected delete')
    },
  }

  const backup: BackupDeps = {
    pool,
    archive: {
      connect: async () => ({
        query: (text, values) => archivePool.query(text, values),
        end: async () => undefined,
      }),
      storage,
    },
    destination: {
      name: 'database',
      separate: false,
      storage,
    },
    now: () => new Date('2026-10-30T09:00:00Z'),
  }

  const deps: WorkspaceExportRouteDeps = {
    auth,
    canManage: async () => options.canManage ?? true,
    backup: () => backup,
  }

  return { deps, queries, backup }
}

const request = () => new Request('http://localhost/api/export/workspace')

describe('handleWorkspaceExport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('needs a signed-in person', async () => {
    const { deps } = setup()
    deps.auth = { ...auth, getSession: async () => null }
    expect((await handleWorkspaceExport(request(), deps)).status).toBe(401)
  })

  it('refuses someone who cannot manage backups', async () => {
    const { deps } = setup({ canManage: false })
    const response = await handleWorkspaceExport(request(), deps)
    expect(response.status).toBe(403)
  })

  it('streams the archive as a named ZIP and records a receipt when it ends', async () => {
    const { deps, queries } = setup()
    const response = await handleWorkspaceExport(request(), deps)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="sheetbase-my-lab-20261030.zip"',
    )
    expect(
      queries.some((q) => q.text.includes('INSERT INTO api.data_exports')),
    ).toBe(false)
    const body = new Uint8Array(await response.arrayBuffer())
    expect(body.slice(0, 4)).toEqual(new Uint8Array([80, 75, 3, 4]))
    const entries = unzipSync(body)
    const row = `${JSON.stringify({ id: WS, name: 'My lab' })}\n`
    expect(strFromU8(entries['data/api.workspaces.ndjson'])).toBe(row)
    expect([...entries['files/file-1']]).toEqual([1, 2, 3, 4, 5])
    expect(JSON.parse(strFromU8(entries['manifest.json']))).toMatchObject({
      totals: { tables: 1, rows: 1, files: 1, missingFiles: 0 },
      tables: [
        {
          name: 'api.workspaces',
          rows: 1,
          sha256: createHash('sha256').update(row).digest('hex'),
        },
      ],
      files: [
        {
          id: 'file-1',
          sha256: createHash('sha256')
            .update(new Uint8Array([1, 2, 3, 4, 5]))
            .digest('hex'),
          status: 'ok',
        },
      ],
    })

    const receipt = queries.find((q) =>
      q.text.includes('INSERT INTO api.data_exports'),
    )

    expect(receipt?.values).toEqual([
      WS,
      expect.any(String),
      'zip',
      1,
      body.length,
      'u1',
    ])
  })
})

describe('handleBackupDownload', () => {
  it('refuses someone who cannot manage backups', async () => {
    const { deps } = setup({ canManage: false })
    expect((await handleBackupDownload(request(), BACKUP, deps)).status).toBe(
      403,
    )
  })

  it('does not look up an id that is not a UUID', async () => {
    const { deps, queries } = setup()
    expect((await handleBackupDownload(request(), '../etc', deps)).status).toBe(
      404,
    )
    expect(queries).toHaveLength(0)
  })

  it('is not found for another workspace’s or an unfinished backup', async () => {
    expect(
      (
        await handleBackupDownload(
          request(),
          BACKUP,
          setup({ backupRow: null }).deps,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await handleBackupDownload(
          request(),
          BACKUP,
          setup({ backupRow: { status: 'failed', storage_key: null } }).deps,
        )
      ).status,
    ).toBe(404)
  })

  it('sends the stored bytes with their length and records a receipt', async () => {
    const { deps, queries } = setup()
    const response = await handleBackupDownload(request(), BACKUP, deps)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('5')
    expect(response.headers.get('content-disposition')).toContain(
      'sheetbase-my-lab-20261029.zip',
    )
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      1, 2, 3, 4, 5,
    ])

    expect(
      queries.find((q) => q.text.includes('FROM internal.workspace_backups'))
        ?.values,
    ).toEqual([WS, BACKUP])

    const receipt = queries.find((q) =>
      q.text.includes('INSERT INTO api.data_exports'),
    )

    expect(receipt?.values).toEqual([
      WS,
      BACKUP,
      'backup-download',
      42,
      5,
      'u1',
    ])
  })
})
