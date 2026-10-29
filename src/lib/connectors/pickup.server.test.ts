import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '../data-client'
import type { DataClient } from '../data-client'
import type { ExternalClaims } from '../external-token'
import { ExternalTokenError } from '../external-token'
import { ParserResolutionError } from './parser-resolution'

import {
  handlePickup,
  parsePickupConfig,
  renderDatasetName,
  sanitiseFileName,
} from './pickup.server'
import type { PickupDeps } from './pickup.server'

const ingest = vi.fn()
vi.mock('./instrument-ingestion', () => ({
  ingestInstrumentPayload: (...args: unknown[]) => ingest(...args),
}))

const WS = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const SCHEMA = '33333333-3333-4333-8333-333333333333'
const INSTRUMENT = '44444444-4444-4444-8444-444444444444'

const personal: ExternalClaims = {
  workspace_id: WS,
  credential_id: 'cred',
  scopes: ['files:write', 'datasets:write'],
  sub: 'user-1',
  kind: 'personal',
  role: 'authenticated',
}

function connector(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    workspace_id: WS,
    key: 'qpcr-bench',
    name: 'qPCR bench',
    connector_type: 'instrument',
    direction: 'inbound',
    status: 'active',
    parser_id: 'sheetbase.plate-reader-csv',
    config: { pickup: { projectId: PROJECT, schemaVersionId: SCHEMA } },
    ...overrides,
  }
}

function setup(options: {
  claims?: ExternalClaims
  connector?: Record<string, unknown> | null
  rpcFail?: string
}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client: DataClient = {
    list: async <T>(resource: string): Promise<T[]> => {
      if (resource === 'connectors') {
        return (
          options.connector === null ? [] : [connector(options.connector ?? {})]
        ) as T[]
      }
      if (resource === 'dataset_schema_version_fields') {
        return [
          {
            field_id: 'f1',
            key: 'well',
            label: 'Well',
            logical_type: 'text',
            nullable: false,
            lifecycle: 'active',
          },
          {
            field_id: 'f2',
            key: 'old',
            label: 'Old',
            logical_type: 'text',
            nullable: true,
            lifecycle: 'retired',
          },
        ] as T[]
      }
      return [] as T[]
    },
    rpc: async <T>(name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      if (name === options.rpcFail) throw new Error('boom')
      if (name === 'create_instrument_run') return { id: 'run-9' } as T
      return {} as T
    },
    count: async () => 0,
    insert: async () => ({}) as never,
    patch: async () => [],
    remove: async () => [],
  }
  const retain = vi.fn(async () => ({
    fileRecordId: 'rec-1',
    fileObjectId: 'obj-1',
    byteSize: 20,
    checksum: 'abcdef0123456789abcdef',
  }))
  const deps: PickupDeps = {
    verifyCredential: async () => options.claims ?? personal,
    createClient: () => client,
    retain,
  }
  return { deps, retain, rpcCalls }
}

function req(
  query: string,
  body: BodyInit | null = 'Well,Sample\nA1,s1\n',
  headers: Record<string, string> = { authorization: 'Bearer tok' },
) {
  return new Request(`http://localhost/api/connectors/pickup?${query}`, {
    method: 'POST',
    headers,
    body,
  })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>
}

beforeEach(() => {
  ingest.mockReset()
  ingest.mockResolvedValue({
    runId: 'run-1',
    attempt: 1,
    alreadyCompleted: false,
    parser: { identity: 'sheetbase.delimited@1' },
    metadata: {},
    warnings: ['w'],
    rowCount: 1,
    datasetId: 'ds-1',
    datasetRevision: 2,
  })
})

describe('pickup request handling', () => {
  it('requires a bearer token', async () => {
    const { deps } = setup({})
    const res = await handlePickup(
      req('connector=c&fileName=a.csv', 'x', {}),
      deps,
    )
    expect(res.status).toBe(401)
  })

  it('maps credential failures from the verifier', async () => {
    const { deps } = setup({})
    deps.verifyCredential = async () => {
      throw new ExternalTokenError('revoked', 'Credential has been revoked.')
    }
    const res = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect(res.status).toBe(401)
    expect((await json(res)).error.code).toBe('revoked')
  })

  it('refuses service credentials and missing scopes', async () => {
    const service = {
      workspace_id: WS,
      credential_id: 'c',
      scopes: ['files:write', 'datasets:write'],
      role: 'api_client',
    } as ExternalClaims
    let { deps } = setup({ claims: service })
    let res = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect(res.status).toBe(403)
    expect((await json(res)).error.code).toBe('personal_token_required')

    ;({ deps } = setup({ claims: { ...personal, scopes: ['files:write'] } }))
    res = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect((await json(res)).error.message).toMatch(/datasets:write/)
  })

  it('404s an unknown connector and 409s a paused one', async () => {
    let { deps } = setup({ connector: null })
    let res = await handlePickup(req('connector=nope&fileName=a.csv'), deps)
    expect(res.status).toBe(404)
    ;({ deps } = setup({ connector: { status: 'paused' } }))
    res = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect(res.status).toBe(409)
  })

  it('reports a connector with no pickup settings', async () => {
    const { deps, retain } = setup({ connector: { config: {} } })
    const res = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect(res.status).toBe(422)
    expect((await json(res)).error.code).toBe('pickup_not_configured')
    expect(retain).not.toHaveBeenCalled()
  })

  it('keeps a binary file and writes its reason down, and writes down one too large to keep', async () => {
    const { deps, retain, rpcCalls } = setup({})
    const binary = await handlePickup(
      req('connector=c&fileName=a.xlsx', new Uint8Array([80, 75, 0, 3])),
      deps,
    )
    expect(binary.status).toBe(415)
    expect(retain).toHaveBeenCalledTimes(1)
    deps.maxBytes = 4
    const big = await handlePickup(
      req('connector=c&fileName=a.csv', 'abcdefgh'),
      deps,
    )
    expect(big.status).toBe(413)
    expect(retain).toHaveBeenCalledTimes(1)
    const recorded = rpcCalls.filter((c) => c.name === 'record_intake_failure')
    expect(
      recorded.map((c) => [c.args.p_code, c.args.p_file_record_id]),
    ).toEqual([
      ['unsupported_format', 'rec-1'],
      ['file_too_large', null],
    ])
    expect(recorded[0].args.p_source).toBe('agent')
  })

  it('retains the file, ingests it and reports the run', async () => {
    const { deps, retain, rpcCalls } = setup({})
    const res = await handlePickup(
      req('connector=qpcr-bench&fileName=..%2F..%2Frun%2001.csv'),
      deps,
    )
    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body).toMatchObject({
      runId: 'run-1',
      datasetId: 'ds-1',
      rowCount: 1,
      fileRecordId: 'rec-1',
      instrumentLink: 'skipped',
    })
    expect(retain).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        fileName: 'run 01.csv',
        mediaType: 'text/csv',
      }),
    )
    const input = ingest.mock.calls[0][1]
    expect(input).toMatchObject({
      connectorId: 'conn-1',
      parserId: 'sheetbase.plate-reader-csv',
      fileRecordId: 'rec-1',
      triggerKind: 'event',
    })
    expect(input.target.fields.map((f: { key: string }) => f.key)).toEqual([
      'well',
    ])
    expect(input.target.newDatasetName).toBe('qPCR bench — run 01.csv')
    expect(rpcCalls.map((c) => c.name)).toEqual([
      'resolve_intake_failures_for_file',
    ])
  })

  it('detects the parser when asked to, and honours an explicit override', async () => {
    let { deps } = setup({
      connector: {
        config: {
          pickup: {
            projectId: PROJECT,
            schemaVersionId: SCHEMA,
            autoDetect: true,
          },
        },
      },
    })
    await handlePickup(
      req('connector=c&fileName=a.json', '[{"Well":"A1"}]'),
      deps,
    )
    expect(ingest.mock.calls[0][1].parserId).toBe('sheetbase.json-records')
    ;({ deps } = setup({}))
    await handlePickup(
      req('connector=c&fileName=a.csv&parser=sheetbase.delimited'),
      deps,
    )
    expect(ingest.mock.calls[1][1].parserId).toBe('sheetbase.delimited')
    ingest.mockRejectedValueOnce(
      new ParserResolutionError('parser_unknown', 'no parser', 'nope'),
    )
    const bad = await handlePickup(
      req('connector=c&fileName=a.csv&parser=nope'),
      deps,
    )
    expect(bad.status).toBe(422)
    expect((await json(bad)).error.code).toBe('parser_unknown')
  })

  it('records an instrument run with the raw file when configured', async () => {
    const { deps, rpcCalls } = setup({
      connector: {
        config: {
          pickup: {
            projectId: PROJECT,
            schemaVersionId: SCHEMA,
            instrumentId: INSTRUMENT,
          },
        },
      },
    })
    const res = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect((await json(res)).instrumentLink).toBe('linked')
    expect(rpcCalls.map((c) => c.name)).toEqual([
      'resolve_intake_failures_for_file',
      'create_instrument_run',
      'start_instrument_run',
      'register_raw_file',
      'link_run_record',
      'complete_instrument_run',
    ])
    expect(rpcCalls[1].args.p_run_identifier).toBe('pickup-abcdef0123456789')
    expect(rpcCalls[3].args.p_file_id).toBe('obj-1')
    expect(rpcCalls[4].args.p_linked_record_id).toBe('rec-1')
  })

  it('still succeeds when the instrument link fails', async () => {
    const { deps } = setup({
      rpcFail: 'register_raw_file',
      connector: {
        config: {
          pickup: {
            projectId: PROJECT,
            schemaVersionId: SCHEMA,
            instrumentId: INSTRUMENT,
          },
        },
      },
    })
    const res = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect(res.status).toBe(201)
    expect((await json(res)).instrumentLink).toBe('failed')
  })

  it('returns 200 for a replayed file and a bounded 422 for a failed run', async () => {
    const { deps } = setup({})
    ingest.mockResolvedValueOnce({
      runId: 'run-1',
      attempt: 1,
      alreadyCompleted: true,
      parser: { identity: 'x@1' },
      metadata: {},
      warnings: [],
      rowCount: 1,
      datasetId: 'ds-1',
    })
    const replay = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect(replay.status).toBe(200)
    ingest.mockRejectedValueOnce(new Error('Column Well is required\nstack'))
    const failed = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect(failed.status).toBe(422)
    expect((await json(failed)).error.message).toBe('Column Well is required')
  })
})

describe('pickup refusals from the database', () => {
  it('reports a row-level security refusal as a permanent 403', async () => {
    const { deps, retain } = setup({})
    retain.mockRejectedValueOnce(
      new DataClientError(
        '42501',
        'new row violates row-level security policy "records_live_insert" for table "records"',
        403,
      ),
    )
    const res = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect(res.status).toBe(403)
    expect((await json(res)).error.code).toBe('forbidden')
  })
})

describe('pickup helpers', () => {
  it('keeps only a safe base file name', () => {
    expect(sanitiseFileName('C:\\data\\run 1.csv')).toBe('run 1.csv')
    expect(() => sanitiseFileName('..')).toThrow()
    expect(() => sanitiseFileName(null)).toThrow()
  })

  it('validates pickup config', () => {
    expect(() => parsePickupConfig({})).toThrow(/pickup/)
    expect(() =>
      parsePickupConfig({
        pickup: { projectId: 'x', schemaVersionId: SCHEMA },
      }),
    ).toThrow(/UUID/)
  })

  it('renders dataset names from a pattern', () => {
    expect(
      renderDatasetName('{connector} {date} {file}', {
        connector: 'A',
        file: 'f.csv',
        date: '2026-10-21',
      }),
    ).toBe('A 2026-10-21 f.csv')
  })
})
