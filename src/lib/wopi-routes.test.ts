// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WopiLocks, signWopiToken } from './office-editor'

const select = vi.fn()
const store = vi.fn()

vi.mock('#/lib/request-auth', () => ({ postgrestSelect: select }))

vi.mock('#/lib/file-routes', () => ({ storeFileVersion: store }))

vi.mock('#/lib/file-storage', () => ({ getObjectStorage: vi.fn() }))

const {
  handleCheckFileInfo,
  handleGetFile,
  handleLockOperation,
  handlePutFile,
} = await import('./wopi-routes')

const SECRET = 's'.repeat(40)

const FILE = {
  id: 'fo1',
  storage_key: 'k',
  status: 'active',
  version: 3,
  display_name: 'Plan.docx',
  media_type:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  byte_size: '12',
  created_at: '2026-11-04T10:00:00Z',
  workspace_id: 'w1',
}

const base = {
  fileRecordId: 'f1',
  userId: 'u1',
  userName: 'Ada',
  workspaceId: 'w1',
  sessionId: 's1',
  canWrite: true,
}

const storage = {
  head: vi.fn(async () => ({})),
  getStream: vi.fn(async () => ({
    stream: new Response('hello').body!,
    byteSize: 5,
  })),
}

function deps(locks = new WopiLocks()) {
  return {
    secret: SECRET,
    appOrigin: 'https://app.example',
    locks,
    storage: storage as never,
    mintToken: async () => 'pg-token',
  }
}

async function req(
  claims: Partial<typeof base> & { hostRecordId?: string } = {},
  init: RequestInit = {},
  path = '',
) {
  const token = await signWopiToken(SECRET, { ...base, ...claims })

  return new Request(
    `http://x/api/wopi/files/f1${path}?access_token=${token}`,
    init,
  )
}

beforeEach(() => {
  select.mockReset()
  store.mockReset()
  select.mockImplementation(async (resource: string) =>
    resource === 'file_objects'
      ? { status: 200, body: [FILE] }
      : { status: 200, body: [{ locked_at: null, archived_at: null }] },
  )
})

describe('WOPI host', () => {
  it('refuses a missing, wrong-file or bad token', async () => {
    const none = await handleCheckFileInfo(
      new Request('http://x/y'),
      'f1',
      deps(),
    )

    expect(none.status).toBe(401)
    const other = await handleCheckFileInfo(await req(), 'f2', deps())
    expect(other.status).toBe(401)
  })

  it('describes the file and the user', async () => {
    const res = await handleCheckFileInfo(await req(), 'f1', deps())
    const info = await res.json()
    expect(info).toMatchObject({
      BaseFileName: 'Plan.docx',
      Version: '3',
      UserCanWrite: true,
      SupportsLocks: true,
      PostMessageOrigin: 'https://app.example',
    })
  })

  it('is read-only for a view token or once the experiment is signed', async () => {
    const view = await handleCheckFileInfo(
      await req({ canWrite: false }),
      'f1',
      deps(),
    )

    expect((await view.json()).UserCanWrite).toBe(false)
    select.mockImplementation(async (resource: string) =>
      resource === 'file_objects'
        ? { status: 200, body: [FILE] }
        : {
            status: 200,
            body: [{ locked_at: '2026-11-04', archived_at: null }],
          },
    )

    const signed = await handleCheckFileInfo(
      await req({ hostRecordId: 'r1' }),
      'f1',
      deps(),
    )

    expect((await signed.json()).UserCanWrite).toBe(false)
  })

  it('serves the latest bytes', async () => {
    const res = await handleGetFile(
      await req({}, {}, '/contents'),
      'f1',
      deps(),
    )

    expect(await res.text()).toBe('hello')
    expect(res.headers.get('x-wopi-itemversion')).toBe('3')
  })

  it('saves a new version through the shared version path', async () => {
    store.mockResolvedValue({
      ok: true,
      version: 4,
      byteSize: '9',
      checksum: 'c',
      id: 'fo2',
    })

    const res = await handlePutFile(
      await req({}, { method: 'POST', body: 'new' }, '/contents'),
      'f1',
      deps(),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('x-wopi-itemversion')).toBe('4')
    expect(store.mock.calls[0][0]).toMatchObject({
      context: { workspaceId: 'w1', token: 'pg-token' },
      displayName: 'Plan.docx',
    })
  })

  it('refuses to save for a view token, a signed record or a foreign lock', async () => {
    const view = await handlePutFile(
      await req(
        { canWrite: false },
        { method: 'POST', body: 'x' },
        '/contents',
      ),
      'f1',
      deps(),
    )

    expect(view.status).toBe(401)

    const locks = new WopiLocks()
    locks.lock('fo1', 'theirs')

    const locked = await handlePutFile(
      await req(
        {},
        { method: 'POST', body: 'x', headers: { 'x-wopi-lock': 'mine' } },
        '/contents',
      ),
      'f1',
      deps(locks),
    )

    expect(locked.status).toBe(409)
    expect(locked.headers.get('x-wopi-lock')).toBe('theirs')

    select.mockImplementation(async (resource: string) =>
      resource === 'file_objects'
        ? { status: 200, body: [FILE] }
        : {
            status: 200,
            body: [{ locked_at: '2026-11-04', archived_at: null }],
          },
    )

    const signed = await handlePutFile(
      await req(
        { hostRecordId: 'r1' },
        { method: 'POST', body: 'x' },
        '/contents',
      ),
      'f1',
      deps(),
    )

    expect(signed.status).toBe(401)
    expect(store).not.toHaveBeenCalled()
  })

  it('handles lock, refresh, get and unlock', async () => {
    const locks = new WopiLocks()

    const call = async (override: string, lock: string) =>
      handleLockOperation(
        await req(
          {},
          {
            method: 'POST',
            headers: { 'x-wopi-override': override, 'x-wopi-lock': lock },
          },
        ),
        'f1',
        deps(locks),
      )

    expect((await call('LOCK', 'a')).status).toBe(200)
    const clash = await call('LOCK', 'b')
    expect(clash.status).toBe(409)
    expect(clash.headers.get('x-wopi-lock')).toBe('a')
    expect((await call('REFRESH_LOCK', 'a')).status).toBe(200)
    expect((await call('GET_LOCK', '')).headers.get('x-wopi-lock')).toBe('a')
    expect((await call('UNLOCK', 'a')).status).toBe(200)
    expect(locks.current('fo1')).toBeNull()
  })
})
