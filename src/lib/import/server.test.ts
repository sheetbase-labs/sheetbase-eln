import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ObjectStorage } from '#/lib/file-storage'
import {
  handleImportCommit,
  handleImportFileRead,
  handleImportReview,
} from './server'
import { sniffImportFormat, zipStore } from '#/lib/import-parse'

const { rpc, select, resolve, parserFailure } = vi.hoisted(() => ({
  rpc: vi.fn(),
  select: vi.fn(),
  resolve: vi.fn(),
  parserFailure: vi.fn(),
}))
vi.mock('#/lib/request-auth', () => ({
  postgrestRpc: rpc,
  postgrestSelect: select,
  resolveSessionAuth: resolve,
  realSessionAuthDeps: {},
  requestErrorResponse: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
}))
vi.mock('./parser-governance.server', () => ({
  recordParserFailure: parserFailure,
}))

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const DATASET_ID = '33333333-3333-4333-8333-333333333333'
const PARSER_ID = '44444444-4444-4444-8444-444444444444'
const PARSER_VERSION_ID = '55555555-5555-4555-8555-555555555555'
const CSV = 'sample\nS1\nS2\nS3\n'

function fixture(
  csv: string | Uint8Array = CSV,
  parserVersions: unknown[] = [],
  filename = 'cov.csv',
) {
  const bytes = typeof csv === 'string' ? new TextEncoder().encode(csv) : csv
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const storage: ObjectStorage = {
    putStream: vi.fn(),
    getStream: vi.fn(async () => ({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
      byteSize: bytes.byteLength,
    })),
    head: vi.fn(),
    delete: vi.fn(),
  }
  select.mockImplementation(async (resource: string) => {
    if (resource === 'parser_versions')
      return { status: 200, body: parserVersions }
    if (resource === 'dataset_import_files')
      return {
        status: 200,
        body: [
          {
            id: FILE_ID,
            workspace_id: WORKSPACE,
            dataset_id: DATASET_ID,
            filename,
            media_type: 'text/csv',
            byte_size: bytes.byteLength,
            checksum,
            storage_key: `${WORKSPACE}/x/y`,
            format: sniffImportFormat(filename),
            status: 'parsed',
            parse_error: null,
          },
        ],
      }
    if (resource === 'datasets')
      return {
        status: 200,
        body: [
          {
            id: DATASET_ID,
            workspace_id: WORKSPACE,
            schema_version_id: 'sv-1',
            revision: 1,
            lifecycle: 'active',
          },
        ],
      }
    return {
      status: 200,
      body: [
        {
          field_id: 'f1',
          label: 'Sample',
          logical_type: 'text',
          nullable: true,
          quantity: null,
        },
      ],
    }
  })
  rpc.mockImplementation(async (name: string) => {
    if (name === 'ensure_parser')
      return {
        status: 200,
        body: { parserId: PARSER_ID, parserVersionId: PARSER_VERSION_ID },
      }
    if (name === 'preview_dataset_import_rows')
      return {
        status: 200,
        body: {
          summary: {
            total: 3,
            added: 3,
            planned: 0,
            new: 3,
            flagged: 0,
            skipped: 0,
          },
          rows: [
            { index: 1, outcome: 'new', plannedKey: null, flags: [] },
            { index: 2, outcome: 'new', plannedKey: null, flags: [] },
            { index: 3, outcome: 'new', plannedKey: null, flags: [] },
          ],
        },
      }
    return { status: 400, body: {} }
  })
  return storage
}

function request(overrides: Record<string, unknown> = {}) {
  return new Request('http://app.invalid/api/import/commit', {
    method: 'POST',
    body: JSON.stringify({
      fileId: FILE_ID,
      datasetId: DATASET_ID,
      mapping: { sources: [{ source: 'sample', fieldId: 'f1', unit: null }] },
      idempotencyKey: 'key-1',
      ...overrides,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolve.mockResolvedValue({
    ok: true,
    context: {
      workspaceId: WORKSPACE,
      userId: 'user-1',
      sessionId: 'session-1',
      token: 'scoped-token',
    },
  })
})

it('selects measurements after a workbook cover through resume, review and commit, without changing raw identity', async () => {
  const workbook = zipStore({
    'xl/workbook.xml':
      '<workbook><sheets><sheet name="Cover" r:id="rId1"/><sheet name="Measurements" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><row><c t="inlineStr"><is><t>Instrument run cover</t></is></c></row></worksheet>',
    'xl/worksheets/sheet2.xml':
      '<worksheet><row><c t="inlineStr"><is><t>sample</t></is></c></row><row><c t="inlineStr"><is><t>MEASURED-17</t></is></c></row></worksheet>',
  })
  const storage = fixture(new Uint8Array(workbook), [], 'instrument.xlsx')
  const read = await handleImportFileRead(
    new Request(
      `http://app.invalid/api/import/files?fileId=${FILE_ID}&sheetName=Measurements`,
    ),
    undefined,
    storage,
  )
  expect(await read.json()).toMatchObject({
    fileId: FILE_ID,
    checksum: createHash('sha256')
      .update(new Uint8Array(workbook))
      .digest('hex'),
    sheet: {
      name: 'Measurements',
      sheetNames: ['Cover', 'Measurements'],
      sampleRows: [{ sample: 'MEASURED-17' }],
    },
  })
  const missing = await handleImportReview(request(), undefined, storage)
  expect(missing.status).toBe(422)
  expect(await missing.json()).toMatchObject({
    error: { code: 'worksheet_required' },
  })
  const invalid = await handleImportCommit(
    request({ sheetName: 'Missing' }),
    undefined,
    storage,
  )
  expect(invalid.status).toBe(422)
  const review = await handleImportReview(
    request({ sheetName: 'Measurements' }),
    undefined,
    storage,
  )
  expect(await review.json()).toMatchObject({
    ok: true,
    rows: expect.arrayContaining([
      expect.objectContaining({ values: { sample: 'MEASURED-17' } }),
    ]),
  })
  await handleImportCommit(
    request({ sheetName: 'Measurements' }),
    undefined,
    storage,
  )
  const args = rpc.mock.calls.find(
    ([name]) => name === 'commit_dataset_import',
  )?.[1]
  expect(args).toMatchObject({
    p_file_id: FILE_ID,
    p_mapping: { sheetName: 'Measurements' },
    p_rows: [expect.objectContaining({ values: { f1: 'MEASURED-17' } })],
  })
})

it('reports the cause the commit RPC raised, not a canned regulated sentence', async () => {
  const storage = fixture()
  rpc.mockImplementation(async (name: string) => {
    if (name === 'ensure_parser')
      return {
        status: 200,
        body: { parserId: PARSER_ID, parserVersionId: PARSER_VERSION_ID },
      }
    if (name === 'preview_dataset_import_rows')
      return {
        status: 200,
        body: {
          summary: {
            total: 3,
            added: 3,
            planned: 0,
            new: 3,
            flagged: 0,
            skipped: 0,
          },
          rows: [{ index: 1, outcome: 'new', plannedKey: null, flags: [] }],
        },
      }
    return {
      status: 400,
      body: {
        code: '22023',
        message: 'import key belongs to another request',
      },
    }
  })
  const response = await handleImportCommit(request(), undefined, storage)
  expect(await response.json()).toEqual({
    ok: false,
    committed: 0,
    errors: [
      {
        code: 'commit_failed',
        message: 'import key belongs to another request',
      },
    ],
  })
  expect(parserFailure).not.toHaveBeenCalled()
})

it('records the parser receipt the SB107 message names, not always approval', async () => {
  const storage = fixture()
  rpc.mockImplementation(async (name: string) => {
    if (name === 'ensure_parser')
      return {
        status: 200,
        body: { parserId: PARSER_ID, parserVersionId: PARSER_VERSION_ID },
      }
    if (name === 'preview_dataset_import_rows')
      return {
        status: 200,
        body: {
          summary: {
            total: 3,
            added: 3,
            planned: 0,
            new: 3,
            flagged: 0,
            skipped: 0,
          },
          rows: [{ index: 1, outcome: 'new', plannedKey: null, flags: [] }],
        },
      }
    return {
      status: 400,
      body: {
        code: 'SB107',
        message: 'regulated Dataset requires an approved parser version',
      },
    }
  })
  const response = await handleImportCommit(request(), undefined, storage)
  expect(await response.json()).toEqual({
    ok: false,
    committed: 0,
    errors: [
      {
        code: 'commit_failed',
        message: 'regulated Dataset requires an approved parser version',
      },
    ],
  })
  expect(parserFailure).toHaveBeenCalledWith(
    expect.anything(),
    FILE_ID,
    PARSER_VERSION_ID,
    'parser_not_approved',
    expect.any(String),
  )
})

it('describes structured row rejections instead of echoing the bare code', async () => {
  const storage = fixture()
  rpc.mockImplementation(async (name: string) => {
    if (name === 'ensure_parser')
      return {
        status: 200,
        body: { parserId: PARSER_ID, parserVersionId: PARSER_VERSION_ID },
      }
    if (name === 'preview_dataset_import_rows')
      return {
        status: 200,
        body: {
          summary: {
            total: 3,
            added: 3,
            planned: 0,
            new: 3,
            flagged: 0,
            skipped: 0,
          },
          rows: [{ index: 1, outcome: 'new', plannedKey: null, flags: [] }],
        },
      }
    return {
      status: 200,
      body: { ok: false, errors: [{ code: 'required_value', rowIndex: 1 }] },
    }
  })
  const response = await handleImportCommit(request(), undefined, storage)
  expect(await response.json()).toEqual({
    ok: false,
    committed: 0,
    errors: [
      {
        row: 1,
        code: 'required_value',
        message: 'A required field is missing.',
      },
    ],
  })
})

it('names the draft parser instead of repeating the found headers', async () => {
  const csv = 'sample,ntu,dil,timestamp\nS1,1,2,2026-01-01T00:00:00Z\n'
  const storage = fixture(csv, [
    {
      id: PARSER_VERSION_ID,
      parser_id: PARSER_ID,
      version: 4,
      status: 'draft',
      signature: { requiredHeaders: ['sample', 'ntu', 'dil', 'timestamp'] },
      parsers: {
        id: PARSER_ID,
        key: 'sheetbase.tb02-turbidity',
        name: 'TB-02 CSV',
        format: 'csv',
      },
    },
  ])
  rpc.mockImplementation(async () => ({
    status: 200,
    body: { parserId: PARSER_ID, parserVersionId: PARSER_VERSION_ID },
  }))
  const response = await handleImportFileRead(
    new Request(`http://app.invalid/api/import/files?fileId=${FILE_ID}`),
    undefined,
    storage,
  )
  const body = (await response.json()) as {
    parser: unknown
    recognitionMessage: string
  }
  expect(body.parser).toBeNull()
  expect(body.recognitionMessage).toContain('match no approved parser')
  expect(body.recognitionMessage).toContain('TB-02 CSV v4 is a draft')
  expect(body.recognitionMessage).not.toContain('Expected a header set')
})
