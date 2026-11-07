import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import type { SessionAuthDeps } from '../request-auth'
import {
  CodeCellError,
  canonicalJson,
  digestRows,
  handleCodeCell,
  runCodeCell,
  singleSelect,
} from './run.server'
import type { CodeCellDeps } from './run.server'

// The real module opens the database; a session check against the fake deps is
// all these tests need.
vi.mock('../request-auth', () => ({
  realSessionAuthDeps: {},
  requestErrorResponse: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  resolveSessionAuth: async (headers: Headers, deps: SessionAuthDeps) => {
    const session = await deps.getSession(headers)
    if (!session) {
      return { ok: false, status: 401, code: 'unauthenticated', message: '' }
    }
    const workspace = await deps.getWorkspaceForUser(session.user.id)
    return {
      ok: true,
      context: {
        userId: session.user.id,
        workspaceId: workspace!.id,
        sessionId: session.session.id,
        token: 'jwt',
      },
    }
  },
}))

const RECORD = '11111111-1111-4111-8111-111111111111'
const BLOCK = '22222222-2222-4222-8222-222222222222'
const VERSION = '33333333-3333-4333-8333-333333333333'
const RUN = '44444444-4444-4444-8444-444444444444'

const dataset = {
  versionId: VERSION,
  datasetId: '55555555-5555-4555-8555-555555555555',
  label: 'Plate reads v2',
  columns: [{ key: 'well', label: 'Well', type: 'text' }],
  rowCount: 2,
  truncated: false,
  rows: [{ well: 'A1' }, { well: 'A2' }],
}

function fakeClient(extra: { original?: unknown } = {}) {
  const recorded: Array<Record<string, unknown>> = []
  const client = {
    list: vi.fn(async () => (extra.original ? [extra.original] : [])),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'dataset_version_rows_json') return dataset
      recorded.push(args)
      return { id: RUN, number: 7, ran_at: '2026-11-07T10:00:00Z' }
    }),
  } as unknown as DataClient
  return { client, recorded }
}

const python = (rows: Array<Record<string, unknown>>) =>
  vi.fn(async () => ({
    rows,
    logs: ['hello'],
    runtime: 'registry/py@sha256:' + 'a'.repeat(64),
    environment: null,
  }))

describe('digests', () => {
  it('does not depend on key order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      '{"a":[2,{"c":2,"d":1}],"b":1}',
    )
    expect(digestRows([{ a: 1, b: 2 }])).toBe(digestRows([{ b: 2, a: 1 }]))
  })
})

describe('singleSelect', () => {
  it('accepts a select and drops the trailing semicolon', () => {
    expect(singleSelect('-- hi\nSELECT 1;')).toBe('-- hi\nSELECT 1')
    expect(singleSelect('with a as (select 1) select * from a')).toContain('with')
  })
  it('refuses writes and several statements', () => {
    expect(() => singleSelect('DROP TABLE samples')).toThrow(CodeCellError)
    expect(() => singleSelect('select 1; select 2')).toThrow(/one query/i)
    expect(() => singleSelect('  ')).toThrow(CodeCellError)
  })
})

describe('runCodeCell', () => {
  it('runs Python on the dataset version and records the run', async () => {
    const { client, recorded } = fakeClient()
    const executePython = python([{ well: 'A1', n: 1 }])
    const out = await runCodeCell(
      client,
      {
        action: 'run',
        recordId: RECORD,
        blockId: BLOCK,
        language: 'python',
        source: 'def transform(inputs, parameters):\n    return inputs["s"]\n',
        inputs: [{ alias: 's', datasetVersionId: VERSION }],
      },
      { executePython, executeSql: vi.fn() },
    )
    expect(executePython).toHaveBeenCalledWith({
      source: expect.stringContaining('transform'),
      inputs: { s: dataset.rows },
    })
    expect(out.status).toBe('ok')
    expect(out.reference).toBe('CC-0007')
    expect(out.columns).toEqual(['well', 'n'])
    expect(out.runtime).toContain('@sha256:')
    expect(out.inputs[0]).toMatchObject({ alias: 's', rowCount: 2 })
    expect(recorded[0]).toMatchObject({
      p_block_id: BLOCK,
      p_language: 'python',
      p_status: 'ok',
      p_output_digest: out.outputDigest,
    })
  })

  it('records a failure and carries the message', async () => {
    const { client, recorded } = fakeClient()
    const out = await runCodeCell(
      client,
      {
        action: 'run',
        recordId: RECORD,
        language: 'sql',
        source: 'select * from nope',
        inputs: [],
      },
      {
        executePython: vi.fn(),
        executeSql: vi.fn(async () => {
          throw new CodeCellError(422, 'code_failed', 'relation "nope" does not exist')
        }),
      },
    )
    expect(out.status).toBe('error')
    expect(out.errorMessage).toContain('nope')
    expect(recorded[0]).toMatchObject({ p_status: 'error', p_output: null })
  })

  it('does not record a run when the runner is not there', async () => {
    const { client, recorded } = fakeClient()
    await expect(
      runCodeCell(
        client,
        { action: 'run', recordId: RECORD, language: 'python', source: 'x', inputs: [] },
        {
          executePython: vi.fn(async () => {
            throw new CodeCellError(503, 'runner_unavailable', 'not configured')
          }),
          executeSql: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ status: 503 })
    expect(recorded).toHaveLength(0)
  })

  it('reproduces a run with its own code and says whether it came out the same', async () => {
    const rows = [{ well: 'A1', n: 1 }]
    const original = {
      id: RUN,
      number: 3,
      block_id: BLOCK,
      record_id: RECORD,
      language: 'python',
      source: 'def transform(i, p): return []',
      inputs: [{ alias: 's', datasetVersionId: VERSION }],
      output: { rows },
      output_digest: digestRows(rows),
      ran_at: '2026-11-06T10:00:00Z',
    }
    const same = fakeClient({ original })
    const a = await runCodeCell(
      same.client,
      { action: 'reproduce', recordId: RECORD, runId: RUN },
      { executePython: python(rows), executeSql: vi.fn() },
    )
    expect(a.reproducedFrom).toEqual({ runId: RUN, reference: 'CC-0003', matches: true })
    expect(same.recorded[0]).toMatchObject({ p_reproduces_run_id: RUN, p_matches: true })

    const changed = fakeClient({ original })
    const b = await runCodeCell(
      changed.client,
      { action: 'reproduce', recordId: RECORD, runId: RUN },
      { executePython: python([{ well: 'A1', n: 2 }]), executeSql: vi.fn() },
    )
    expect(b.reproducedFrom?.matches).toBe(false)
    expect(changed.recorded[0]).toMatchObject({ p_matches: false })
    expect(changed.recorded[0]?.['p_diff']).toMatchObject({ changedCells: 1 })
  })
})

describe('handleCodeCell', () => {
  function deps(client: DataClient): CodeCellDeps {
    return {
      getSession: async () => ({ user: { id: 'u1' }, session: { id: 's1' } }),
      getWorkspaceForUser: async () => ({ id: 'w1' }),
      mintToken: async () => 'token',
      createClient: () => client,
      executePython: python([{ well: 'A1' }]),
      executeSql: vi.fn(),
    }
  }
  const post = (body: unknown) =>
    new Request('http://x/api/notebook/code-cell', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('runs a cell for the signed-in person', async () => {
    const { client } = fakeClient()
    const response = await handleCodeCell(
      post({
        action: 'run',
        recordId: RECORD,
        language: 'python',
        source: 'def transform(i, p): return []',
        inputs: [{ alias: 's', datasetVersionId: VERSION }],
      }),
      deps(client),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok', reference: 'CC-0007' })
  })

  it('refuses a bad request before reading any data', async () => {
    const { client } = fakeClient()
    const response = await handleCodeCell(
      post({ action: 'run', recordId: RECORD, language: 'ruby', source: 'x' }),
      deps(client),
    )
    expect(response.status).toBe(400)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('refuses two inputs with the same name', async () => {
    const { client } = fakeClient()
    const response = await handleCodeCell(
      post({
        action: 'run',
        recordId: RECORD,
        language: 'sql',
        source: 'select 1',
        inputs: [
          { alias: 'a', datasetVersionId: VERSION },
          { alias: 'a', datasetVersionId: VERSION },
        ],
      }),
      deps(client),
    )
    expect(response.status).toBe(400)
  })
})
