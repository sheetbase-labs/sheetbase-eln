import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient, DataClientError } from '../data-client'
import type { ExternalClaims } from '../external-token'
import { ExternalTokenError } from '../external-token'
import { BUILTIN_PARSERS } from './builtin-parsers'
import type { IntakeFailureRow } from './intake.server'
import type { ConnectorRunWire, ConnectorWire } from './types'
import { zipStore } from '../import-parse'

import {
  handlePickup,
  parsePickupConfig,
  renderDatasetName,
  sanitiseFileName,
} from './pickup.server'
import type { PickupDeps } from './pickup.server'

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

function connector(overrides: Partial<ConnectorWire> = {}): ConnectorWire {
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
    created_at: '2026-10-21T00:00:00Z',
    updated_at: '2026-10-21T00:00:00Z',
    ...overrides,
  }
}

function setup(options: {
  claims?: ExternalClaims
  connector?: Partial<ConnectorWire> | null
  rpcFail?: string
  rejectFirstWarning?: boolean
}) {
  const rpcCalls: Array<{ name: string; args: ConnectorWire['config'] }> = []
  const queries: URL[] = []
  const datasets: Array<ConnectorWire['config']> = []

  const logWrites: Array<{ sequence: number; message: string; level: string }> =
    []

  let run: ConnectorRunWire = {
    id: 'run-1',
    workspace_id: WS,
    connector_id: 'conn-1',
    trigger_kind: 'event',
    status: 'running',
    attempt: 1,
    retry_of_run_id: null,
    request_digest: null,
    result: {},
    error_code: null,
    error_message: null,
    started_at: '2026-10-21T00:00:00Z',
    finished_at: null,
  }

  let logSequence = 0

  const transport: typeof fetch = async (input, init) => {
    const address = input instanceof Request ? input.url : input.toString()
    const request = new Request(new URL(address, 'http://localhost'), init)
    const url = new URL(request.url)
    const resource = url.pathname.replace('/api/db/', '')

    if (request.method === 'GET') {
      queries.push(url)

      if (resource === 'connectors') {
        return Response.json(
          options.connector === null
            ? []
            : [connector(options.connector ?? {})],
        )
      }

      if (resource === 'dataset_schema_version_fields') {
        return Response.json([
          {
            field_id: 'f1',
            key: 'well',
            label: 'Well',
            description: null,
            logical_type: 'text',
            nullable: false,
            cardinality: 'one',
            lifecycle: 'active',
            display_order: 1,
          },
          {
            field_id: 'f2',
            key: 'old',
            label: 'Old',
            description: null,
            logical_type: 'text',
            nullable: true,
            cardinality: 'one',
            lifecycle: 'retired',
            display_order: 2,
          },
        ])
      }

      if (resource === 'parsers') {
        const parser = BUILTIN_PARSERS.find(
          (entry) => `eq.${entry.key}` === url.searchParams.get('key'),
        )

        return Response.json(
          parser
            ? [
                {
                  id: `parser-${parser.key}`,
                  key: parser.key,
                  name: parser.name,
                  format: parser.format,
                  parser_versions: [
                    {
                      id: `version-${parser.key}`,
                      version: parser.version,
                      status: 'approved',
                      signature: parser.signature,
                    },
                  ],
                },
              ]
            : [],
        )
      }

      if (resource === 'intake_failures') return Response.json([])
      throw new Error(`Unexpected GET ${url}`)
    }

    const args = z.record(z.string(), z.json()).parse(await request.json())

    if (resource === 'datasets') {
      datasets.push(args)

      return Response.json([{ ...args, id: 'ds-1', revision: 1 }])
    }

    const name = resource.replace('rpc/', '')
    rpcCalls.push({ name, args })

    if (name === options.rpcFail)
      return Response.json(
        { code: 'XX000', message: 'Column Well is required\nstack' },
        { status: 500 },
      )

    switch (name) {
      case 'ensure_builtin_parsers':
      case 'resolve_intake_failures_for_file':
      case 'start_instrument_run':
      case 'register_raw_file':
      case 'link_run_record':
      case 'complete_instrument_run':
        return new Response(null, { status: 204 })
      case 'start_connector_run':
        if (
          run.request_digest === args.p_request_digest &&
          run.status === 'succeeded'
        )
          return Response.json(run)
        run = {
          ...run,
          status: 'running',
          request_digest: z.string().parse(args.p_request_digest),
        }

        return Response.json(run)
      case 'append_connector_run_log': {
        const sequence = logSequence + 1
        await new Promise((resolve) => setTimeout(resolve, 1))

        if (options.rejectFirstWarning && args.p_level === 'warning')
          return Response.json(
            { code: 'XX000', message: 'Warning log refused' },
            { status: 500 },
          )
        logSequence = sequence
        logWrites.push({
          sequence,
          message: z.string().parse(args.p_message),
          level: z.string().parse(args.p_level),
        })

        return Response.json({
          id: `log-${logSequence}`,
          workspace_id: WS,
          run_id: run.id,
          sequence: logSequence,
          level: args.p_level,
          stage: args.p_stage,
          message: args.p_message,
          detail: args.p_detail,
          at: '2026-10-21T00:00:00Z',
        })
      }

      case 'commit_dataset_import':
        return Response.json({
          ok: true,
          datasetId: 'ds-1',
          datasetRevision: 2,
        })
      case 'complete_connector_run':
        run = {
          ...run,
          status: 'succeeded',
          result: z.record(z.string(), z.json()).parse(args.p_result),
          finished_at: '2026-10-21T00:01:00Z',
        }

        return Response.json(run)
      case 'fail_connector_run':
        run = {
          ...run,
          status: 'failed',
          error_code: z.string().parse(args.p_error_code),
          error_message: z.string().parse(args.p_error_message),
          finished_at: '2026-10-21T00:01:00Z',
        }

        return Response.json(run)
      case 'record_intake_failure':
        return Response.json({
          id: 'failure-1',
          connector_id: z.string().parse(args.p_connector_id),
          instrument_id: null,
          connector_run_id: z
            .string()
            .nullable()
            .parse(args.p_connector_run_id),
          file_record_id: z.string().nullable().parse(args.p_file_record_id),
          file_name: z.string().parse(args.p_file_name),
          checksum: z.string().nullable().parse(args.p_checksum),
          byte_size: z.number().nullable().parse(args.p_byte_size),
          source: z.enum(['agent', 'upload']).parse(args.p_source),
          code: z.string().parse(args.p_code),
          message: z.string().parse(args.p_message),
          parser_key: z.string().nullable().parse(args.p_parser_key),
          target: z.record(z.string(), z.json()).parse(args.p_target),
          status: 'open',
          attempts: 1,
          created_at: '2026-10-21T00:00:00Z',
          last_attempt_at: '2026-10-21T00:00:00Z',
        } satisfies IntakeFailureRow)
      case 'create_instrument_run':
        return Response.json({ id: 'run-9' })
      case 'link_intake_dataset':
        return Response.json({ experimentId: null, experimentIdentifier: null })
      case 'record_run_sample_results':
        return Response.json({ linked: 0, checks: 0, unknown: ['s1'] })
      default:
        throw new Error(`Unexpected RPC ${name}`)
    }
  }

  const client = createDataClient(transport)

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

  return { deps, retain, rpcCalls, queries, datasets, logWrites }
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
  return z
    .object({
      error: z.object({ code: z.string(), message: z.string() }),
    })
    .parse(await response.json())
}

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
    const service: ExternalClaims = {
      workspace_id: WS,
      credential_id: 'c',
      scopes: ['files:write', 'datasets:write'],
      role: 'api_client',
    }

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

  it('reads an Excel workbook the way it reads the same rows as text', async () => {
    const { deps, retain, rpcCalls } = setup({
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

    const workbook = new Uint8Array(
      zipStore({
        'xl/workbook.xml':
          '<workbook><sheets><sheet name="Run" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/sharedStrings.xml':
          '<sst><si><t>Well</t></si><si><t>Sample</t></si><si><t>A1</t></si><si><t>s1</t></si></sst>',
        'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
        </sheetData></worksheet>`,
      }),
    )

    const res = await handlePickup(
      req('connector=qpcr-bench&fileName=run.xlsx', workbook),
      deps,
    )

    expect(res.status, await res.clone().text()).toBe(201)
    expect(
      rpcCalls.find((call) => call.name === 'commit_dataset_import')?.args,
    ).toMatchObject({
      p_rows: [{ operation: 'create', values: { f1: 'A1' } }],
      p_source_provenance: { source: { fileName: 'run.xlsx' } },
    })
    expect(
      rpcCalls.find((call) => call.name === 'record_run_sample_results')?.args
        .p_results,
    ).toEqual([{ sample: 's1', checks: [] }])
    const text = setup({})
    expect(
      (await handlePickup(req('connector=c&fileName=run.csv'), text.deps))
        .status,
    ).toBe(201)

    const committedRows = z.array(
      z.object({
        operation: z.literal('create'),
        values: z.record(z.string(), z.json()),
      }),
    )

    expect(
      committedRows.parse(
        text.rpcCalls.find((call) => call.name === 'commit_dataset_import')
          ?.args.p_rows,
      ),
    ).toEqual(
      committedRows.parse(
        rpcCalls.find((call) => call.name === 'commit_dataset_import')?.args
          .p_rows,
      ),
    )
    expect(retain).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )
  })

  it('keeps a workbook it can’t open and says so', async () => {
    const { deps, rpcCalls } = setup({})

    const res = await handlePickup(
      req(
        'connector=c&fileName=run.xlsx',
        new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]),
      ),
      deps,
    )

    expect(res.status).toBe(422)
    expect((await json(res)).error.code).toBe('unreadable_workbook')
    const recorded = rpcCalls.filter((c) => c.name === 'record_intake_failure')
    expect(recorded.map((c) => c.args.p_code)).toEqual(['unreadable_workbook'])
  })

  it('retains the file, ingests it and reports the run', async () => {
    const { deps, retain, rpcCalls, datasets, queries } = setup({})

    const res = await handlePickup(
      req(
        'connector=qpcr-bench&fileName=..%2F..%2Frun%2001.csv',
        'Well,Sample,Old\nA1,s1,retired\n',
      ),
      deps,
    )

    expect(res.status).toBe(201)
    const body: unknown = await res.json()
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
    expect(
      rpcCalls.find((call) => call.name === 'start_connector_run')?.args,
    ).toMatchObject({
      p_connector_id: 'conn-1',
      p_trigger_kind: 'event',
      p_workspace_id: WS,
    })
    expect(
      queries
        .find((url) => url.pathname.endsWith('/dataset_schema_version_fields'))
        ?.searchParams.get('schema_version_id'),
    ).toBe(`eq.${SCHEMA}`)
    expect(datasets).toMatchObject([
      {
        name: 'qPCR bench — run 01.csv',
        schema_version_id: SCHEMA,
        workspace_id: WS,
      },
    ])

    const commit = rpcCalls.find(
      (call) => call.name === 'commit_dataset_import',
    )?.args

    expect(commit).toMatchObject({
      p_rows: [{ operation: 'create', values: { f1: 'A1' } }],
      p_parser_id: 'parser-sheetbase.plate-reader-csv',
      p_parser_version_id: 'version-sheetbase.plate-reader-csv',
      p_connector_run_id: 'run-1',
      p_source_provenance: {
        fileRecordId: 'rec-1',
        checksum: 'abcdef0123456789abcdef',
        source: { kind: 'instrument_upload', fileName: 'run 01.csv' },
      },
    })
    expect(commit?.p_mapping).toMatchObject([
      { kind: 'field', field: { id: 'f1', key: 'well' } },
      { kind: 'ignore' },
      { kind: 'ignore' },
    ])
    expect(
      rpcCalls.find((call) => call.name === 'complete_connector_run')?.args
        .p_result,
    ).toMatchObject({
      parser: 'sheetbase.plate-reader-csv@1',
      schemaVersionId: SCHEMA,
      fileRecordId: 'rec-1',
      fileName: 'run 01.csv',
    })
    expect(rpcCalls.slice(-2).map((c) => c.name)).toEqual([
      'resolve_intake_failures_for_file',
      'link_intake_dataset',
    ])
    expect(rpcCalls.at(-1)?.args.p_project_id).toBe(PROJECT)
    expect(rpcCalls.at(-1)?.args.p_run_id).toBeNull()
  })

  it('detects the parser when asked to, and honours an explicit override', async () => {
    const detected = setup({
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

    const auto = await handlePickup(
      req('connector=c&fileName=a.json', '[{"Well":"A1"}]'),
      detected.deps,
    )

    expect(auto.status).toBe(201)
    expect(await auto.json()).toMatchObject({
      parser: 'sheetbase.json-records@1',
    })
    expect(
      detected.queries
        .find((url) => url.pathname.endsWith('/parsers'))
        ?.searchParams.get('key'),
    ).toBe('eq.sheetbase.json-records')
    const { deps, queries } = setup({})

    const override = await handlePickup(
      req('connector=c&fileName=a.csv&parser=sheetbase.delimited'),
      deps,
    )

    expect(override.status).toBe(201)
    expect(await override.json()).toMatchObject({
      parser: 'sheetbase.delimited@1',
    })
    expect(
      queries
        .find((url) => url.pathname.endsWith('/parsers'))
        ?.searchParams.get('key'),
    ).toBe('eq.sheetbase.delimited')

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
    expect(await res.json()).toMatchObject({ instrumentLink: 'linked' })

    const links = rpcCalls.slice(
      rpcCalls.findIndex(
        (call) => call.name === 'resolve_intake_failures_for_file',
      ),
    )

    expect(links.map((c) => c.name)).toEqual([
      'resolve_intake_failures_for_file',
      'create_instrument_run',
      'start_instrument_run',
      'register_raw_file',
      'link_run_record',
      'complete_instrument_run',
      'record_run_sample_results',
      'link_intake_dataset',
    ])
    expect(links[7].args.p_project_id).toBe(PROJECT)
    expect(links[7].args.p_run_id).toBe('run-9')
    expect(links[1].args.p_run_identifier).toBe('pickup-abcdef0123456789')
    expect(links[3].args.p_file_id).toBe('obj-1')
    expect(links[4].args.p_linked_record_id).toBe('rec-1')
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
    expect(await res.json()).toMatchObject({ instrumentLink: 'failed' })
  })

  it('returns 200 for a replayed file and a bounded 422 for failed parser registration', async () => {
    const { deps, rpcCalls, datasets } = setup({})
    expect(
      (await handlePickup(req('connector=c&fileName=a.csv'), deps)).status,
    ).toBe(201)
    const replay = await handlePickup(req('connector=c&fileName=a.csv'), deps)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({
      datasetId: 'ds-1',
      rowCount: 1,
      runId: 'run-1',
    })
    expect(datasets).toHaveLength(1)
    expect(
      rpcCalls.filter((call) => call.name === 'commit_dataset_import'),
    ).toHaveLength(1)
    const failure = setup({ rpcFail: 'ensure_builtin_parsers' })

    const failed = await handlePickup(
      req('connector=c&fileName=a.csv'),
      failure.deps,
    )

    expect(failed.status).toBe(422)
    expect((await json(failed)).error.message).toBe('Column Well is required')
    expect(
      failure.rpcCalls.find((call) => call.name === 'record_intake_failure')
        ?.args,
    ).toMatchObject({
      p_code: 'ingestion_failed',
      p_message: 'Column Well is required',
    })
  })

  it('records a failed connector run and intake problem when the commit is refused', async () => {
    const { deps, rpcCalls } = setup({ rpcFail: 'commit_dataset_import' })
    const res = await handlePickup(req('connector=c&fileName=a.csv'), deps)

    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.code).toBe('commit_failed')
    expect(
      rpcCalls.find((call) => call.name === 'fail_connector_run')?.args,
    ).toMatchObject({ p_run_id: 'run-1', p_error_code: 'commit_failed' })
    expect(
      rpcCalls.find((call) => call.name === 'record_intake_failure')?.args,
    ).toMatchObject({ p_connector_run_id: 'run-1', p_code: 'commit_failed' })
    expect(
      rpcCalls.some((call) => call.name === 'complete_connector_run'),
    ).toBe(false)
    expect(body.error.message).toBe('Column Well is required')
  })

  it('writes real parser warnings in order before mapping and committing', async () => {
    const { deps, rpcCalls, logWrites } = setup({})

    const res = await handlePickup(
      req(
        'connector=c&fileName=warnings.csv',
        '# malformed\nWell,Sample\nA1,s1\n# trailing\n',
      ),
      deps,
    )

    expect(res.status).toBe(201)

    const warnings = [
      'Unrecognised metadata line: # malformed',
      'Trailing metadata line ignored: # trailing',
    ]

    expect(await res.json()).toMatchObject({ warnings })
    expect(logWrites).toMatchObject([
      { sequence: 1, level: 'info' },
      { sequence: 2, level: 'warning', message: warnings[0] },
      { sequence: 3, level: 'warning', message: warnings[1] },
      { sequence: 4, level: 'info' },
      { sequence: 5, level: 'info' },
      { sequence: 6, level: 'info' },
      { sequence: 7, level: 'info' },
    ])
    expect(
      rpcCalls
        .filter((call) => call.name === 'append_connector_run_log')
        .map((call) => call.args.p_stage),
    ).toEqual(['start', 'parse', 'parse', 'parse', 'map', 'target', 'commit'])
    expect(
      rpcCalls.findIndex((call) => call.name === 'commit_dataset_import'),
    ).toBeGreaterThan(
      rpcCalls.findIndex((call) => call.args.p_message === warnings[1]),
    )
  })

  it('stops at the first rejected warning log without writing later warnings or rows', async () => {
    const { deps, rpcCalls, datasets, logWrites } = setup({
      rejectFirstWarning: true,
    })

    const res = await handlePickup(
      req(
        'connector=c&fileName=warnings.csv',
        '# malformed\nWell,Sample\nA1,s1\n# trailing\n',
      ),
      deps,
    )

    expect(res.status).toBe(422)
    expect((await json(res)).error.message).toBe('Warning log refused')
    expect(logWrites).toMatchObject([{ sequence: 1, level: 'info' }])
    expect(
      rpcCalls
        .filter((call) => call.name === 'append_connector_run_log')
        .map((call) => [call.args.p_stage, call.args.p_message]),
    ).toEqual([
      ['start', expect.any(String)],
      ['parse', 'Unrecognised metadata line: # malformed'],
    ])
    expect(datasets).toEqual([])
    expect(rpcCalls.map((call) => call.name)).toEqual([
      'ensure_builtin_parsers',
      'start_connector_run',
      'append_connector_run_log',
      'append_connector_run_log',
      'fail_connector_run',
      'record_intake_failure',
    ])
    expect(
      rpcCalls.find((call) => call.name === 'fail_connector_run')?.args,
    ).toMatchObject({
      p_run_id: 'run-1',
      p_error_code: 'unexpected_error',
      p_error_message: 'Warning log refused',
    })
    expect(
      rpcCalls.find((call) => call.name === 'record_intake_failure')?.args,
    ).toMatchObject({ p_connector_run_id: 'run-1', p_code: 'unexpected_error' })
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
