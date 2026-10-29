import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import type { ParserSettingsRow } from '../parser-settings'
import {
  findInstrumentConnector,
  intakeSetupValues,
  previewSample,
  saveIntakeSetup,
} from './intake-setup'
import type { ConnectorWire } from './types'

const PROJECT = '22222222-2222-4222-8222-222222222222'
const SCHEMA = '33333333-3333-4333-8333-333333333333'
const INSTRUMENT = '44444444-4444-4444-8444-444444444444'

function connector(overrides: Partial<ConnectorWire> = {}): ConnectorWire {
  return {
    id: 'c1',
    workspace_id: 'w1',
    key: 'qpcr-bench',
    name: 'qPCR bench',
    connector_type: 'instrument',
    direction: 'inbound',
    status: 'active',
    parser_id: null,
    config: {
      pickup: {
        projectId: PROJECT,
        schemaVersionId: SCHEMA,
        autoDetect: true,
        instrumentId: INSTRUMENT,
      },
    },
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function parser(
  key: string,
  signature: Record<string, unknown>,
  format = 'csv',
): ParserSettingsRow {
  return {
    id: `p-${key}`,
    key,
    name: key,
    format,
    instrument_id: null,
    instruments: null,
    parser_versions: [
      {
        id: 'v1',
        version: 1,
        status: 'approved',
        signature,
        mapping: {},
        test_result: null,
        validated_at: null,
        approved_at: null,
        approved_by_user_id: null,
      },
    ],
  }
}

describe('intakeSetupValues', () => {
  it('starts empty and reads the saved setup back', () => {
    expect(intakeSetupValues(null)).toMatchObject({
      parserKey: '',
      projectId: '',
      schemaVersionId: '',
      datasetId: '',
    })
    expect(intakeSetupValues(connector()).parserKey).toBe('')
    expect(
      intakeSetupValues(
        connector({
          parser_id: 'sheetbase.qpcr-results-csv',
          config: {
            pickup: { projectId: PROJECT, schemaVersionId: SCHEMA },
          },
        }),
      ),
    ).toMatchObject({
      parserKey: 'sheetbase.qpcr-results-csv',
      projectId: PROJECT,
    })
  })
})

describe('findInstrumentConnector', () => {
  it('finds the connector that carries this instrument’s files', async () => {
    const client = {
      list: async () => [
        connector({ id: 'other', config: { pickup: { instrumentId: 'x' } } }),
        connector({ id: 'mine' }),
        connector({ id: 'plain', config: {} }),
      ],
    } as unknown as DataClient
    expect((await findInstrumentConnector(client, INSTRUMENT))?.id).toBe('mine')
    expect(await findInstrumentConnector(client, 'nobody')).toBeNull()
  })
})

describe('saveIntakeSetup', () => {
  const instrument = { id: INSTRUMENT, name: 'qPCR bench', displayId: 'INS-3' }
  const values = {
    parserKey: 'sheetbase.qpcr-results-csv',
    projectId: PROJECT,
    schemaVersionId: SCHEMA,
    datasetId: '',
    datasetNamePattern: '{connector} — {file}',
  }

  it('registers the connector with a readable key, the parser and the destination', async () => {
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      id: 'new',
      ...args,
    }))
    const result = await saveIntakeSetup({ rpc } as unknown as DataClient, {
      workspaceId: 'w1',
      instrument,
      existing: null,
      values,
    })
    expect(result.ok).toBe(true)
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('register_connector')
    expect(args).toMatchObject({
      p_key: 'qpcr-bench-ins-3',
      p_name: 'qPCR bench',
      p_connector_type: 'instrument',
      p_parser_id: 'sheetbase.qpcr-results-csv',
    })
    expect(args.p_config).toMatchObject({
      pickup: {
        projectId: PROJECT,
        schemaVersionId: SCHEMA,
        autoDetect: false,
        instrumentId: INSTRUMENT,
      },
    })
  })

  it('updates the existing connector and can go back to reading each file by its content', async () => {
    const rpc = vi.fn(async () => ({ id: 'c1' }))
    await saveIntakeSetup({ rpc } as unknown as DataClient, {
      workspaceId: 'w1',
      instrument,
      existing: connector({ parser_id: 'sheetbase.qpcr-results-csv' }),
      values: { ...values, parserKey: '' },
    })
    expect(rpc).toHaveBeenCalledWith(
      'update_connector',
      expect.objectContaining({
        p_connector_id: 'c1',
        p_clear_parser: true,
      }),
    )
    const sent = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ]
    expect(sent[1]).not.toHaveProperty('p_parser_id')
    expect(sent[1].p_config).toMatchObject({ pickup: { autoDetect: true } })
  })

  it('asks for what’s missing before saving', async () => {
    const rpc = vi.fn()
    const missing = await saveIntakeSetup({ rpc } as unknown as DataClient, {
      workspaceId: 'w1',
      instrument,
      existing: null,
      values: { ...values, projectId: '', schemaVersionId: '' },
    })
    expect(missing).toMatchObject({
      ok: false,
      errors: {
        projectId: expect.any(String),
        schemaVersionId: expect.any(String),
      },
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('previewSample', () => {
  const qpcr = 'Well,Sample,Ct\nA1,S1,21.4\nA2,S2,22.1\n'

  it('shows what each file would be read as when the parser is worked out', () => {
    const preview = previewSample(qpcr, null)
    expect(preview).toMatchObject({ status: 'ok', rowCount: 2 })
  })

  it('reads with the chosen built-in parser', () => {
    const preview = previewSample(
      qpcr,
      parser('sheetbase.delimited', { engine: 'sheetbase.delimited@1' }),
    )
    expect(preview).toMatchObject({
      status: 'ok',
      headers: ['Well', 'Sample', 'Ct'],
    })
  })

  it('checks a column parser’s required columns', () => {
    const columns = parser('mine', { requiredHeaders: ['well', 'od450'] })
    expect(previewSample(qpcr, columns)).toEqual({
      status: 'unreadable',
      reason: 'columns',
      missing: ['od450'],
    })
    expect(previewSample('Well,OD450\nA1,0.4\n', columns)).toMatchObject({
      status: 'ok',
      rowCount: 1,
    })
  })

  it('leaves a service parser or an Excel parser to the first real file', () => {
    expect(
      previewSample(
        qpcr,
        parser('svc', { webhook: { url: 'https://x.test' } }),
      ),
    ).toEqual({ status: 'later', reason: 'service' })
    expect(
      previewSample(qpcr, parser('plate', { requiredHeaders: [] }, 'xlsx')),
    ).toEqual({ status: 'later', reason: 'binary' })
  })

  it('says so when there is nothing to read', () => {
    expect(
      previewSample('', parser('mine', { requiredHeaders: ['a'] })),
    ).toMatchObject({ status: 'unreadable', reason: 'empty' })
  })
})
