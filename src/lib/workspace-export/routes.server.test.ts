import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionAuthDeps } from '#/lib/request-auth'

import type { BackupDeps } from './backup.server'
import { handleBackupDownload, handleWorkspaceExport } from './routes.server'
import type { WorkspaceExportRouteDeps } from './routes.server'

// The real session and database modules read server environment variables.
vi.mock('#/lib/request-auth', () => ({
  requestErrorResponse: (status: number, code: string, message: string) =>
    new Response(JSON.stringify({ error: { code, message } }), { status }),
  resolveSessionAuth: async (
    headers: Headers,
    deps: {
      getSession: (h: Headers) => Promise<{ user: { id: string } } | null>
      getWorkspaceForUser: (id: string) => Promise<{ id: string } | null>
    },
  ) => {
    const session = await deps.getSession(headers)
    if (!session) {
      return { ok: false, status: 401, code: 'unauthenticated', message: '' }
    }
    const membership = await deps.getWorkspaceForUser(session.user.id)
    return membership
      ? {
          ok: true,
          context: { userId: session.user.id, workspaceId: membership.id },
        }
      : { ok: false, status: 403, code: 'no_workspace', message: '' }
  },
}))
vi.mock('./backup.server', () => ({
  findBackup: async (
    pool: {
      query: (
        t: string,
        v: unknown[],
      ) => Promise<{ rows: Record<string, unknown>[] }>
    },
    workspaceId: string,
    id: string,
  ) => {
    const { rows } = await pool.query(
      'SELECT FROM internal.workspace_backups',
      [workspaceId, id],
    )
    const row = rows.at(0)
    return row
      ? {
          id: row.id,
          status: row.status,
          startedAt: row.started_at,
          byteSize: Number(row.byte_size),
          rowCount: Number(row.row_count),
          storageKey: row.storage_key ?? null,
        }
      : null
  },
}))
vi.mock('./archive.server', () => ({
  createWorkspaceArchive: vi.fn(() => ({
    stream: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([80, 75, 3, 4]))
        c.close()
      },
    }),
    summary: Promise.resolve({
      tableCount: 3,
      rowCount: 42,
      fileCount: 1,
      missingFileCount: 0,
    }),
  })),
}))

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
    backupRow?: Record<string, unknown> | null
  } = {},
) {
  const queries: { text: string; values: unknown[] }[] = []
  const stored = new Uint8Array([1, 2, 3, 4, 5])
  const backup = {
    pool: {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        queries.push({ text, values })
        if (text.includes('FROM api.workspaces'))
          return { rows: [{ slug: 'my lab!' }] }
        if (text.includes('FROM internal.workspace_backups')) {
          return {
            rows:
              options.backupRow === null
                ? []
                : [
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
                  ],
          }
        }
        return { rows: [] }
      }),
    },
    archive: { connect: vi.fn(), storage: {} },
    destination: {
      name: 'database',
      separate: false,
      storage: {
        getStream: vi.fn(async () => ({
          stream: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(stored)
              c.close()
            },
          }),
          byteSize: stored.length,
        })),
      },
    },
    now: () => new Date('2026-10-30T09:00:00Z'),
  } as unknown as BackupDeps
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
    const body = new Uint8Array(await response.arrayBuffer())
    expect([...body]).toEqual([80, 75, 3, 4])
    const receipt = queries.find((q) =>
      q.text.includes('INSERT INTO api.data_exports'),
    )
    expect(receipt?.values).toEqual([
      WS,
      expect.any(String),
      'zip',
      42,
      4,
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
