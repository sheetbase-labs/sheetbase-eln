import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObjectStorage } from '#/lib/file-storage'
import { handleParserValidation } from './parser-validation.server'

const { select, resolve, query, release, connect } = vi.hoisted(() => {
  const queryMock = vi.fn()
  const releaseMock = vi.fn()
  return {
    select: vi.fn(),
    resolve: vi.fn(),
    query: queryMock,
    release: releaseMock,
    connect: vi.fn(async () => ({ query: queryMock, release: releaseMock })),
  }
})
vi.mock('#/db/client.server', () => ({ db: { $client: { connect } } }))
vi.mock('#/lib/file-storage', () => ({ getObjectStorage: vi.fn() }))
vi.mock('#/lib/request-auth', () => ({
  postgrestSelect: select,
  resolveSessionAuth: resolve,
  realSessionAuthDeps: {},
  requestErrorResponse: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
}))

const VERSION = '00000000-0000-4000-8000-000000000123'
const FILE = '00000000-0000-4000-8000-000000000456'
const WORKSPACE = 'workspace-a'
const bytes = new TextEncoder().encode(
  '# Instrument: TB-02\nsample,ntu\nA,17.25\nB,8.5\n',
)
const checksum = createHash('sha256').update(bytes).digest('hex')
const version = {
  id: VERSION,
  workspace_id: WORKSPACE,
  version: 4,
  status: 'draft',
  signature: { requiredHeaders: ['sample', 'ntu'], requiresMetadata: true },
  mapping: {},
  parsers: { key: 'tb02', name: 'Turbidity', format: 'csv' },
}
const file = {
  id: FILE,
  workspace_id: WORKSPACE,
  filename: 'test.csv',
  format: 'csv',
  storage_key: `${WORKSPACE}/retained-key`,
  checksum,
  byte_size: String(bytes.length),
}
const getStream = vi.fn()
const storage = { getStream } as unknown as ObjectStorage

function request(extra = {}) {
  return new Request('http://app.invalid/api/parsers/validate', {
    method: 'POST',
    body: JSON.stringify({ parserVersionId: VERSION, fileId: FILE, ...extra }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolve.mockResolvedValue({
    ok: true,
    context: {
      userId: 'writer-a',
      workspaceId: WORKSPACE,
      sessionId: 'session-a',
      token: 'scoped-token',
    },
  })
  select.mockImplementation(async (resource) => ({
    status: 200,
    body: [resource === 'parser_versions' ? version : file],
  }))
  getStream.mockImplementation(async () => ({
    byteSize: bytes.length,
    stream: new ReadableStream({
      start(c) {
        c.enqueue(bytes)
        c.close()
      },
    }),
  }))
  query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.includes('record_parser_validation')) {
      const result = JSON.parse(String(args[4]))
      return {
        rows: [
          {
            version: {
              id: VERSION,
              status: result.ok ? 'validated' : 'draft',
              test_result: result,
            },
          },
        ],
      }
    }
    return { rows: [] }
  })
})

describe('server-authoritative retained parser validation', () => {
  it('rejects browser-supplied results/status before reading bytes or writing evidence', async () => {
    for (const extra of [
      { result: { ok: true } },
      { status: 'validated' },
      { checksum: 'forged' },
    ]) {
      expect(
        (await handleParserValidation(request(extra), undefined, storage))
          .status,
      ).toBe(400)
    }
    expect(select).not.toHaveBeenCalled()
    expect(getStream).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('uses retained bytes and the canonical signature, with claims-bound service authority', async () => {
    const response = await handleParserValidation(request(), undefined, storage)
    expect(await response.json()).toMatchObject({
      ok: true,
      parserVersionId: VERSION,
      validation: {
        checksum,
        rowCount: 2,
        headers: ['sample', 'ntu'],
        errors: [],
      },
    })
    expect(select.mock.calls.every((call) => call[2] === 'scoped-token')).toBe(
      true,
    )
    expect(getStream).toHaveBeenCalledWith(`${WORKSPACE}/retained-key`)
    expect(query).toHaveBeenCalledWith('SET LOCAL ROLE service_role')
    const claims = query.mock.calls.find((call) =>
      call[0].includes('request.jwt.claims'),
    )
    expect(JSON.parse(claims![1][0])).toMatchObject({
      sub: 'writer-a',
      workspace_id: WORKSPACE,
      session_id: 'session-a',
    })
    const recorded = query.mock.calls.find((call) =>
      call[0].includes('record_parser_validation'),
    )
    expect(recorded![1].slice(0, 3)).toEqual([VERSION, FILE, checksum])
    expect(JSON.parse(recorded![1][3])).toEqual({
      signature: version.signature,
      mapping: {},
    })
    expect(release).toHaveBeenCalledOnce()
  })

  it('persists a genuine nonmatching test as failure rather than approving it', async () => {
    select.mockImplementation(async (resource) => ({
      status: 200,
      body: [
        resource === 'parser_versions'
          ? {
              ...version,
              signature: { requiredHeaders: ['firmware4_reading'] },
            }
          : file,
      ],
    }))
    const response = await handleParserValidation(request(), undefined, storage)
    expect(await response.json()).toMatchObject({
      ok: false,
      status: 'draft',
      validation: { rowCount: 2 },
    })
    const recorded = query.mock.calls.find((call) =>
      call[0].includes('record_parser_validation'),
    )
    expect(JSON.parse(recorded![1][4]).errors).toHaveLength(1)
  })

  it('executes exact plate-reader and S3 identities but refuses unsupported or stale engines', async () => {
    for (const engine of [
      'sheetbase.plate-reader-csv@1',
      'sheetbase.delimited@1',
    ]) {
      select.mockImplementation(async (resource) => ({
        status: 200,
        body: [
          resource === 'parser_versions'
            ? { ...version, signature: { engine } }
            : file,
        ],
      }))
      expect(
        await (
          await handleParserValidation(request(), undefined, storage)
        ).json(),
      ).toMatchObject({
        ok: true,
        validation: { headers: ['sample', 'ntu'], rowCount: 2 },
      })
    }
    connect.mockClear()
    for (const engine of [
      'sheetbase.postgres-table@1',
      'sheetbase.plate-reader-csv@2',
    ]) {
      select.mockImplementation(async (resource) => ({
        status: 200,
        body: [
          resource === 'parser_versions'
            ? {
                ...version,
                signature: {
                  engine,
                  requiredHeaders: ['sample'],
                  manualMapping: true,
                },
              }
            : file,
        ],
      }))
      expect(
        (await handleParserValidation(request(), undefined, storage)).status,
      ).toBe(422)
    }
    expect(connect).not.toHaveBeenCalled()
  })

  it('evaluates nonempty column mapping with the existing pinned Dataset coercion', async () => {
    const FIELD = '00000000-0000-4000-8000-000000000777'
    select.mockImplementation(async (resource) => ({
      status: 200,
      body:
        resource === 'parser_versions'
          ? [
              {
                ...version,
                mapping: {
                  sources: [{ source: 'ntu', fieldId: FIELD, unit: null }],
                },
              },
            ]
          : resource === 'dataset_import_files'
            ? [{ ...file, dataset_id: 'dataset-a' }]
            : resource === 'datasets'
              ? [
                  {
                    id: 'dataset-a',
                    workspace_id: WORKSPACE,
                    schema_version_id: 'schema-a',
                    revision: 1,
                    lifecycle: 'active',
                  },
                ]
              : [
                  {
                    field_id: FIELD,
                    label: 'NTU',
                    logical_type: 'decimal',
                    nullable: false,
                    quantity: null,
                  },
                ],
    }))
    expect(
      await (
        await handleParserValidation(request(), undefined, storage)
      ).json(),
    ).toMatchObject({ ok: true })
    select.mockImplementation(async (resource) => ({
      status: 200,
      body:
        resource === 'parser_versions'
          ? [
              {
                ...version,
                mapping: {
                  sources: [{ source: 'sample', fieldId: FIELD, unit: null }],
                },
              },
            ]
          : resource === 'dataset_import_files'
            ? [{ ...file, dataset_id: 'dataset-a' }]
            : resource === 'datasets'
              ? [
                  {
                    id: 'dataset-a',
                    workspace_id: WORKSPACE,
                    schema_version_id: 'schema-a',
                    revision: 1,
                    lifecycle: 'active',
                  },
                ]
              : [
                  {
                    field_id: FIELD,
                    label: 'NTU',
                    logical_type: 'decimal',
                    nullable: false,
                    quantity: null,
                  },
                ],
    }))
    const result = await (
      await handleParserValidation(request(), undefined, storage)
    ).json()
    expect(result).toMatchObject({ ok: false, status: 'draft' })
    expect(result.validation.errors).toHaveLength(2)
    expect(result.validation.errors[0]).toContain('Row 1, sample')
  })

  it('refuses altered retained bytes even if the parser could read them', async () => {
    select.mockImplementation(async (resource) => ({
      status: 200,
      body: [
        resource === 'parser_versions'
          ? version
          : { ...file, checksum: 'b'.repeat(64) },
      ],
    }))
    expect(
      (await handleParserValidation(request(), undefined, storage)).status,
    ).toBe(422)
    expect(connect).not.toHaveBeenCalled()
  })

  it('fails closed for another workspace and immutable approved versions', async () => {
    select.mockResolvedValue({
      status: 200,
      body: [{ ...version, workspace_id: 'workspace-b' }],
    })
    expect(
      (await handleParserValidation(request(), undefined, storage)).status,
    ).toBe(404)
    select.mockImplementation(async (resource) => ({
      status: 200,
      body: [
        resource === 'parser_versions'
          ? { ...version, status: 'approved' }
          : file,
      ],
    }))
    expect(
      (await handleParserValidation(request(), undefined, storage)).status,
    ).toBe(409)
    expect(getStream).not.toHaveBeenCalled()
  })

  it('does not invent success when the trusted SQL operation is unavailable', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('record_parser_validation'))
        throw new Error('function does not exist')
      return { rows: [] }
    })
    await expect(
      handleParserValidation(request(), undefined, storage),
    ).rejects.toThrow('function does not exist')
    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
  })
})
