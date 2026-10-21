import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  rpc: vi.fn(),
  receipt: vi.fn(),
}))

vi.mock('../request-auth', () => ({
  resolveSessionAuth: async (headers: Headers) =>
    headers.get('x-test-user')
      ? {
          ok: true,
          context: {
            userId: headers.get('x-test-user'),
            workspaceId: 'ws',
            sessionId: 's',
            token: 'tok',
          },
        }
      : {
          ok: false,
          status: 401,
          code: 'unauthenticated',
          message: 'Sign in.',
        },
  requestErrorResponse: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  postgrestSelect: mocks.select,
  postgrestRpc: mocks.rpc,
  recordDataExportReceipt: mocks.receipt,
}))
vi.mock('../file-storage', () => ({ getObjectStorage: () => null }))

import { readZip } from './zip-read'
import { buildElnArchive } from './eln-archive'
import {
  handleElnImport,
  handleProjectElnExport,
  handleRecordElnExport,
} from './routes'

const REC = '11111111-1111-4111-8111-111111111111'
const PROJ = '22222222-2222-4222-8222-222222222222'
const FILE = '33333333-3333-4333-8333-333333333333'
const deps = {} as never
const asUser = { 'x-test-user': 'u1' }
const get = (path: string, headers: Record<string, string> = asUser) =>
  new Request(`http://t/api/${path}`, { headers })

const record = {
  id: REC,
  workspace_id: 'ws',
  project_id: PROJ,
  identifier: 'EXP-001',
  title: 'Run 1',
  kind: 'experiment',
  status: 'draft',
  tags: ['a'],
  properties: {},
  custom_fields: {},
  created_at: '2026-10-01T00:00:00Z',
}
const textBlock = {
  id: 'b1',
  type: 'rich_text',
  order: 1,
  payload_schema_version: 1,
  payload: {
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
    },
  },
}
const fileBlock = {
  id: 'b2',
  type: 'file',
  order: 2,
  payload_schema_version: 1,
  payload: { fileRecordId: FILE },
}

const storage = {
  getStream: async () => ({
    stream: new Blob(['abc']).stream() as ReadableStream<Uint8Array>,
    byteSize: 3,
  }),
}

beforeEach(() => {
  mocks.select.mockReset()
  mocks.rpc.mockReset()
  mocks.receipt.mockReset()
  mocks.select.mockImplementation(async (resource: string, query: string) => {
    switch (resource) {
      case 'records':
        if (query.includes('project_id='))
          return {
            status: 200,
            body: [
              record,
              {
                ...record,
                id: '44444444-4444-4444-8444-444444444444',
                identifier: 'EXP-002',
              },
            ],
          }
        return {
          status: 200,
          body: [record, { id: FILE, identifier: 'FIL-001' }],
        }
      case 'blocks':
        return { status: 200, body: [textBlock, fileBlock] }
      case 'file_objects':
        return {
          status: 200,
          body: [
            {
              record_id: FILE,
              storage_key: 'k',
              display_name: 'a.txt',
              media_type: 'text/plain',
              byte_size: 3,
              status: 'active',
            },
          ],
        }
      case 'signatures':
        return {
          status: 200,
          body: [
            {
              id: 'sig',
              revision_id: 'rev',
              signer_user_id: 'u1',
              signer_name: 'Ada',
              signer_role: 'scientist',
              signature_meaning: 'authored',
              auth_method: 'password',
              revision_integrity_digest: 'f'.repeat(64),
              signed_at: '2026-10-02T00:00:00Z',
            },
          ],
        }
      case 'projects':
        return {
          status: 200,
          body: [
            {
              id: PROJ,
              workspace_id: 'ws',
              key: 'P1',
              title: 'Proj',
              status: 'active',
            },
          ],
        }
    }
    return { status: 200, body: [] }
  })
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'audit_events'
      ? {
          status: 200,
          body: {
            formatVersion: 1,
            events: [],
            hasMore: false,
            nextCursor: null,
          },
        }
      : { status: 200, body: {} },
  )
})

describe('handleRecordElnExport', () => {
  it('returns an .eln with file bytes, signatures and audit, and a receipt', async () => {
    const res = await handleRecordElnExport(
      get(`export/record/${REC}/eln`),
      REC,
      deps,
      storage as never,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.eln+zip')
    expect(res.headers.get('content-disposition')).toContain('.eln"')
    const entries = readZip(new Uint8Array(await res.arrayBuffer()))
    const names = [...entries.keys()]
    expect(names).toContain('EXP-001 Run 1/EXP-001 Run 1/files/a.txt')
    expect(names.some((n) => n.endsWith('/signatures.json'))).toBe(true)
    expect(names.some((n) => n.endsWith('/audit.csv'))).toBe(true)
    expect(mocks.receipt).toHaveBeenCalledOnce()
    expect(mocks.receipt.mock.calls[0][0]).toMatchObject({
      objectType: 'record',
      objectId: REC,
      format: 'eln',
      actorUserId: 'u1',
    })
  })

  it('404s on a record the caller cannot see, with no receipt', async () => {
    mocks.select.mockResolvedValue({ status: 200, body: [] })
    const res = await handleRecordElnExport(
      get(`export/record/${REC}/eln`),
      REC,
      deps,
      storage as never,
    )
    expect(res.status).toBe(404)
    expect(mocks.receipt).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated and malformed requests', async () => {
    expect((await handleRecordElnExport(get('x', {}), REC, deps)).status).toBe(
      401,
    )
    expect(
      (await handleRecordElnExport(get('x'), 'not-a-uuid', deps)).status,
    ).toBe(404)
  })

  it('fails with 502 when audit history is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ status: 500, body: {} })
    const res = await handleRecordElnExport(
      get('x'),
      REC,
      deps,
      storage as never,
    )
    expect(res.status).toBe(502)
    expect(mocks.receipt).not.toHaveBeenCalled()
  })

  it('lists unreadable stored files as missing instead of failing', async () => {
    const res = await handleRecordElnExport(get('x'), REC, deps, {
      getStream: async () => {
        throw new Error('gone')
      },
    } as never)
    expect(res.status).toBe(200)
    const names = [...readZip(new Uint8Array(await res.arrayBuffer())).keys()]
    expect(names.some((n) => n.includes('/files/'))).toBe(false)
  })
})

describe('handleProjectElnExport', () => {
  it('bundles every experiment and writes one receipt each', async () => {
    const res = await handleProjectElnExport(
      get(`export/project/${PROJ}/eln`),
      PROJ,
      deps,
      storage as never,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('P1 Proj.eln')
    expect(mocks.receipt).toHaveBeenCalledTimes(2)
  })

  it('404s for an unknown project', async () => {
    mocks.select.mockResolvedValue({ status: 200, body: [] })
    const res = await handleProjectElnExport(get('x'), PROJ, deps)
    expect(res.status).toBe(404)
  })
})

describe('handleElnImport', () => {
  async function archive() {
    const { bytes } = await buildElnArchive({
      name: 'x',
      workspaceId: 'ws',
      exportedAt: '2026-10-21T00:00:00Z',
      experiments: [
        {
          record: {
            id: REC,
            identifier: 'EXP-009',
            title: 'Imported',
            kind: 'experiment',
            status: 'draft',
            tags: ['t'],
          },
          blocks: [
            {
              id: 'b',
              type: 'rich_text',
              order: 1,
              payloadSchemaVersion: 1,
              payload: textBlock.payload,
            },
          ],
          files: [],
          datasets: [],
          signatures: [],
          auditCsv: '',
        },
      ],
    })
    return bytes
  }
  const post = (body: Uint8Array | null, project = PROJ) =>
    new Request(`http://t/api/import/eln?projectId=${project}`, {
      method: 'POST',
      headers: asUser,
      body: body as BodyInit | null,
    })

  it('creates draft experiments with a provenance block', async () => {
    mocks.select.mockResolvedValue({ status: 200, body: [{ id: PROJ }] })
    mocks.rpc.mockResolvedValue({
      status: 200,
      body: { record: { id: 'new', identifier: 'EXP-050', title: 'Imported' } },
    })
    const res = await handleElnImport(post(await archive()), deps)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.created).toEqual([
      { id: 'new', identifier: 'EXP-050', title: 'Imported' },
    ])
    const args = mocks.rpc.mock.calls[0][1]
    expect(args).toMatchObject({
      p_project_id: PROJ,
      p_kind: 'experiment',
      p_status: 'draft',
      p_tags: ['t'],
    })
    expect(args.p_blocks).toHaveLength(2)
    expect(JSON.stringify(args.p_blocks[1])).toContain('EXP-009')
  })

  it('rejects non-.eln bodies and unknown projects', async () => {
    expect(
      (await handleElnImport(post(new Uint8Array([1, 2, 3])), deps)).status,
    ).toBe(400)
    mocks.select.mockResolvedValue({ status: 200, body: [] })
    expect((await handleElnImport(post(await archive()), deps)).status).toBe(
      404,
    )
    expect((await handleElnImport(post(null), deps)).status).toBe(400)
  })

  it('reports a partial failure with what was created', async () => {
    mocks.select.mockResolvedValue({ status: 200, body: [{ id: PROJ }] })
    mocks.rpc.mockResolvedValue({ status: 422, body: { error: 'nope' } })
    const res = await handleElnImport(post(await archive()), deps)
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('import_failed')
  })
})
