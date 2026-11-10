import { describe, expect, it, vi } from 'vitest'
import { Duplex } from 'node:stream'
import { Client } from 'pg'
import type { QueryResultRow } from 'pg'
import { z } from 'zod'
import {
  executePipelineActions,
  resolvePipelineActionValue,
} from './pipeline-actions.server'
import type { ExecConnection } from './pipeline-execute.server'
import { validatePipelineActions } from './pipelines/actions'
import type { PipelineAction } from './pipelines/actions'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from './pipelines/types'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const runId = '00000000-0000-4000-8000-000000000002'

const context = {
  parameters: { title: "Hello'); DROP TABLE api.records;--" },
  previous: [],
  output: {},
}

const fixtureResultSchema = z.object({
  rows: z.array(pipelineJsonObjectSchema),
})

function pgMessage(code: string, payload: Buffer) {
  const header = Buffer.alloc(5)
  header.write(code)
  header.writeInt32BE(payload.length + 4, 1)

  return Buffer.concat([header, payload])
}

function pgRows(rows: z.infer<typeof fixtureResultSchema>['rows']) {
  const columns = Object.keys(rows[0] ?? {})
  const count = Buffer.alloc(2)
  count.writeInt16BE(columns.length)

  const fields = columns.map((name) => {
    const metadata = Buffer.alloc(18)
    metadata.writeInt32BE(3802, 6) // jsonb, decoded by pg's real type parser.
    metadata.writeInt16BE(-1, 10)
    metadata.writeInt32BE(-1, 12)

    return Buffer.concat([Buffer.from(`${name}\0`), metadata])
  })

  const descriptions = pgMessage('T', Buffer.concat([count, ...fields]))

  const data = rows.map((row) =>
    pgMessage(
      'D',
      Buffer.concat([
        count,
        ...columns.map((name) => {
          const value = Buffer.from(JSON.stringify(row[name]))
          const size = Buffer.alloc(4)
          size.writeInt32BE(value.length)

          return Buffer.concat([size, value])
        }),
      ]),
    ),
  )

  return Buffer.concat([
    descriptions,
    ...data,
    pgMessage('C', Buffer.from(`SELECT ${rows.length}\0`)),
    pgMessage('Z', Buffer.from('I')),
  ])
}

/** In-memory PostgreSQL wire transport. No socket, database, or asserted generic rows. */
async function decodeFixtureRows<Row extends QueryResultRow>(
  rows: z.infer<typeof fixtureResultSchema>['rows'],
) {
  let startup = true

  const stream = new Duplex({
    read() {
      /* Backend frames are pushed in response to frontend writes. */
    },
    write(chunk: Buffer, _encoding, done) {
      if (startup) {
        startup = false
        stream.push(
          Buffer.concat([
            pgMessage('R', Buffer.alloc(4)),
            pgMessage('Z', Buffer.from('I')),
          ]),
        )
      } else if (chunk[0] === 81) {
        stream.push(pgRows(rows))
      } else if (chunk[0] === 88) {
        stream.push(null)
      }

      done()
    },
  })

  Object.assign(stream, {
    setNoDelay: () => stream,
    connect: () => {
      queueMicrotask(() => stream.emit('connect'))

      return stream
    },
  })

  const client = new Client({
    user: 'fixture',
    database: 'fixture',
    stream: () => stream,
  })

  await client.connect()

  try {
    return await client.query<Row>('SELECT fixture')
  } finally {
    await client.end()
  }
}

function connection(
  results: Array<z.infer<typeof pipelineJsonValueSchema>> = [
    { id: workspaceId },
  ],
  workspace = workspaceId,
  propose = false,
  actor = 'actor',
) {
  const empty = { rows: [] }

  const query = vi
    .fn<
      (
        sql: string,
        values?: Parameters<ExecConnection['query']>[1],
      ) => Promise<z.infer<typeof fixtureResultSchema>>
    >()
    .mockResolvedValue(empty)

  query.mockResolvedValueOnce({
    ...empty,
    rows: [{ workspace_id: workspace, user_id: actor }],
  })
  query.mockResolvedValueOnce(empty)

  for (const result of results) {
    if (propose)
      query.mockResolvedValueOnce({
        ...empty,
        rows: [
          { definition_id: 'd1', definition_name: 'Prices', version_id: 'v1' },
        ],
      })
    query.mockResolvedValueOnce({ ...empty, rows: [{ result }] })
  }

  const conn: ExecConnection = {
    query: async <Row extends QueryResultRow>(
      sql: string,
      values?: Parameters<ExecConnection['query']>[1],
    ) => {
      const result = fixtureResultSchema.parse(
        await (values === undefined ? query(sql) : query(sql, values)),
      )

      return decodeFixtureRows<Row>(result.rows)
    },
    begin: vi.fn<ExecConnection['begin']>(),
    commit: vi.fn<ExecConnection['commit']>(),
    rollback: vi.fn<ExecConnection['rollback']>(),
    end: vi.fn<ExecConnection['end']>(),
  }

  return { conn, query }
}

describe('ELN pipeline actions', () => {
  it('rejects arbitrary SQL/RPC identifiers and server-owned arguments', () => {
    expect(
      validatePipelineActions([
        { name: 'evil', operation: 'grant_project_access', arguments: {} },
      ]),
    ).not.toEqual([])
    expect(
      validatePipelineActions([
        {
          name: 'create',
          operation: 'create_project',
          arguments: { p_title: 'x', p_workspace_id: workspaceId },
        },
      ]),
    ).not.toEqual([])
    expect(
      validatePipelineActions(
        Array.from({ length: 21 }, (_, i) => ({
          name: `a${i}`,
          operation: 'create_project',
          arguments: { p_title: 'x' },
        })),
      ),
    ).not.toEqual([])
  })
  it('keeps supplied strings as parameters and switches to the RLS role', async () => {
    const { conn, query } = connection()
    await executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'project',
          operation: 'create_project',
          arguments: { p_title: { $ref: 'parameters.title' } },
        },
      ],
      context,
    )
    expect(query).toHaveBeenCalledWith('SET LOCAL ROLE authenticated')
    expect(query).toHaveBeenCalledWith(
      'SELECT to_jsonb(api.create_project(p_title => $1::text)) AS result',
      [context.parameters.title],
    )
    expect(query).toHaveBeenLastCalledWith('SET ROLE NONE')
  })
  it('resolves earlier action results and records without substituting strings', async () => {
    const { conn, query } = connection([{ id: workspaceId }, { id: runId }])

    const result = await executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'project',
          operation: 'create_project',
          arguments: { p_title: 'A project' },
        },
        {
          name: 'record',
          operation: 'create_model_record',
          arguments: {
            p_project_id: { $ref: 'actions.project.id' },
            p_kind: 'experiment',
            p_title: 'parameters.title',
          },
        },
      ],
      context,
    )

    expect(result.record).toEqual({ id: runId })
    expect(
      query.mock.calls.find(([sql]) =>
        sql.includes('api.create_model_record'),
      )?.[1],
    ).toEqual([workspaceId, 'experiment', 'parameters.title'])
  })
  it('binds idempotency to the run and action', async () => {
    const { conn, query } = connection([{ ok: true }])
    await executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'commit',
          operation: 'commit_dataset_row_batch',
          arguments: {
            p_dataset_id: workspaceId,
            p_expected_dataset_revision: 3,
            p_rows: [],
          },
        },
      ],
      context,
    )
    expect(
      query.mock.calls.find(([sql]) =>
        sql.includes('commit_dataset_row_batch'),
      )?.[1],
    ).toEqual([workspaceId, 3, '[]', `pipeline:${runId}:commit`])
  })
  it('fails on domain rejection and never executes subsequent actions', async () => {
    const { conn, query } = connection([
      { ok: false, errors: ['revision conflict'] },
    ])

    await expect(
      executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'first',
            operation: 'create_project',
            arguments: { p_title: 'A' },
          },
          {
            name: 'second',
            operation: 'create_project',
            arguments: { p_title: 'B' },
          },
        ],
        context,
      ),
    ).rejects.toThrow('first')
    expect(
      query.mock.calls.filter(([sql]) => sql.startsWith('SELECT to_jsonb')),
    ).toHaveLength(1)
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false)
  })
  it('rejects a wrong workspace before switching roles or invoking operations', async () => {
    const { conn, query } = connection([], runId)
    await expect(
      executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'project',
            operation: 'create_project',
            arguments: { p_title: 'A' },
          },
        ],
        context,
      ),
    ).rejects.toThrow('identity')
    expect(query).not.toHaveBeenCalledWith('SET LOCAL ROLE authenticated')
  })
  it('requires expected revisions and validates resolved argument types', async () => {
    expect(
      validatePipelineActions([
        {
          name: 'archive',
          operation: 'archive_record',
          arguments: { p_record_id: workspaceId },
        },
      ]),
    ).not.toEqual([])
    const { conn } = connection()
    await expect(
      executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'archive',
            operation: 'archive_record',
            arguments: {
              p_record_id: workspaceId,
              p_expected_metadata_version: 'latest',
            },
          },
        ],
        context,
      ),
    ).rejects.toThrow('p_expected_metadata_version')
  })
  it('rejects missing, inherited and prototype reference paths', () => {
    for (const path of [
      'parameters.missing',
      'parameters.__proto__',
      'actions.future.id',
      'output.constructor',
    ])
      expect(() =>
        resolvePipelineActionValue({ $ref: path }, context),
      ).toThrow()
    expect(
      resolvePipelineActionValue(
        { $ref: 'previous.0.id' },
        { previous: [{ id: 7 }] },
      ),
    ).toBe(7)
    expect(() =>
      resolvePipelineActionValue({ $ref: 'previous', extra: true }, context),
    ).toThrow()
  })

  it('decodes malformed raw values and contexts at the reference boundary', () => {
    for (const value of [
      undefined,
      Number.NaN,
      Infinity,
      new Date(),
      () => 1,
      { value: undefined },
    ])
      expect(() => resolvePipelineActionValue(value, context)).toThrow(
        z.ZodError,
      )

    for (const scope of [null, [], { parameters: { value: () => 1 } }])
      expect(() =>
        resolvePipelineActionValue({ $ref: 'parameters' }, scope),
      ).toThrow(z.ZodError)
  })

  it('preserves reference error messages and blocks own protected argument keys', () => {
    for (const value of [
      { $ref: 4 },
      { $ref: null },
      { $ref: 'previous', extra: true },
    ])
      expect(() => resolvePipelineActionValue(value, context)).toThrow(
        'A reference must contain only a $ref path.',
      )

    for (const path of [
      'secret.value',
      'parameters.__proto__',
      'parameters.prototype',
      'parameters.constructor',
      'previous.-1',
      'parameters.title.x',
    ]) {
      const message =
        path === 'previous.-1' || path === 'parameters.title.x'
          ? `Action reference ${path} was not found.`
          : 'Invalid action reference.'

      expect(() => resolvePipelineActionValue({ $ref: path }, context)).toThrow(
        message,
      )
    }

    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const value = Object.fromEntries([[key, 1]])
      expect(() =>
        resolvePipelineActionValue({ nested: value }, context),
      ).toThrow('Invalid action argument key.')
    }

    expect(() =>
      resolvePipelineActionValue({ $ref: 'parameters.toString' }, context),
    ).toThrow('Action reference parameters.toString was not found.')
  })

  it('preserves scientific JSON values, keys and literal strings without interpolation', () => {
    const measurement = {
      'Titre (vg/mL)': 1.2e12,
      'Δ titre': -0.005,
      valid: false,
      absent: null,
      values: [1, '2', true, null],
    }

    const scope = {
      ...context,
      previous: [measurement],
      parameters: { value: measurement },
    }

    expect(resolvePipelineActionValue({ $ref: 'previous.0' }, scope)).toEqual(
      measurement,
    )
    expect(
      resolvePipelineActionValue({ $ref: 'parameters.value.values.2' }, scope),
    ).toBe(true)
    expect(resolvePipelineActionValue({ $ref: 'previous.length' }, scope)).toBe(
      1,
    )
    expect(
      resolvePipelineActionValue(
        [
          0,
          false,
          null,
          { measurement: { $ref: 'parameters.value' } },
          'parameters.value',
        ],
        scope,
      ),
    ).toEqual([0, false, null, { measurement }, 'parameters.value'])
    expect(
      resolvePipelineActionValue(
        { $ref: 'parameters.value' },
        { parameters: { value: Object.fromEntries([['__proto__', 7]]) } },
      ),
    ).toEqual(Object.fromEntries([['__proto__', 7]]))
  })

  it('preserves pg scientific values in references without rejecting unrelated columns', async () => {
    const date = new Date('2026-11-10T12:00:00Z')
    const bytes = Buffer.from([1, 2, 3])

    const row = {
      date,
      bytes,
      count: 9007199254740993n,
      absent: undefined,
      nan: Number.NaN,
      infinite: Infinity,
      nested: [date, bytes],
      title: 'Scientific run',
    }

    const scope = { ...context, previous: [row] }

    for (const [key, expected] of Object.entries(row)) {
      const result = resolvePipelineActionValue(
        { $ref: `previous.0.${key}` },
        scope,
      )

      expect(result).toBe(expected)
    }

    expect(
      resolvePipelineActionValue({ $ref: 'previous.0.bytes.1' }, scope),
    ).toBe(2)
    const { conn, query } = connection()
    await expect(
      executePipelineActions(conn, { workspaceId, runId }, [], scope),
    ).resolves.toEqual({})
    expect(query).not.toHaveBeenCalled()
    await executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'project',
          operation: 'create_project',
          arguments: { p_title: { $ref: 'previous.0.title' } },
        },
      ],
      scope,
    )
    expect(query.mock.calls[2][1]).toEqual(['Scientific run'])
  })

  it('serializes referenced pg values only at a JSON SQL argument boundary', async () => {
    const date = new Date('2026-11-10T12:00:00Z')
    const bytes = Buffer.from([1, 2, 3])

    const scientific = {
      date,
      bytes,
      absent: undefined,
      nan: Number.NaN,
      measurements: [0, false, null, -0.05],
    }

    const { conn, query } = connection()
    await executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'record',
          operation: 'create_model_record',
          arguments: {
            p_project_id: workspaceId,
            p_kind: 'experiment',
            p_title: 'Run',
            p_properties: { $ref: 'previous.0' },
          },
        },
      ],
      { ...context, previous: [scientific] },
    )
    expect(query.mock.calls[2][1]).toEqual([
      workspaceId,
      'experiment',
      'Run',
      JSON.stringify(scientific),
    ])
  })

  it('does not turn referenced dates into timestamp strings or accept nonfinite numeric arguments', async () => {
    const { conn, query } = connection()
    await expect(
      executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'task',
            operation: 'create_study_task',
            arguments: {
              p_title: 'Run',
              p_due_at: { $ref: 'previous.0.date' },
            },
          },
        ],
        { ...context, previous: [{ date: new Date('2026-11-10T12:00:00Z') }] },
      ),
    ).rejects.toThrow('Invalid p_due_at: expected timestamptz.')
    expect(
      query.mock.calls.filter(([sql]) => sql.startsWith('SELECT to_jsonb')),
    ).toHaveLength(0)
    const rate = connection()
    await expect(
      executePipelineActions(
        rate.conn,
        { workspaceId, runId },
        [
          {
            name: 'rate',
            operation: 'set_instrument_rate',
            arguments: {
              p_instrument_id: runId,
              p_rate_per_hour: { $ref: 'previous.0.rate' },
              p_currency: null,
            },
          },
        ],
        { ...context, previous: [{ rate: Infinity }] },
      ),
    ).rejects.toThrow('Invalid p_rate_per_hour: expected numeric.')
    expect(
      rate.query.mock.calls.filter(([sql]) =>
        sql.startsWith('SELECT to_jsonb'),
      ),
    ).toHaveLength(0)
  })

  it('allows depth 32 and retains the exact depth-limit error at 33', () => {
    let value: z.infer<typeof pipelineJsonValueSchema> = 'leaf'

    for (let depth = 0; depth < 32; depth++) value = { nested: value }
    expect(resolvePipelineActionValue(value, context)).toEqual(value)
    expect(() =>
      resolvePipelineActionValue({ nested: value }, context),
    ).toThrow('Action arguments exceed the nesting limit.')
    expect(() => resolvePipelineActionValue([], context, 33)).toThrow(
      'Action arguments exceed the nesting limit.',
    )

    for (let depth = 32; depth < 10_000; depth++) value = { nested: value }
    expect(() => resolvePipelineActionValue(value, context)).toThrow(
      'Action arguments exceed the nesting limit.',
    )
  })

  it('rejects malformed executor context before any database query', async () => {
    for (const malformed of [
      null,
      {},
      { ...context, previous: 'rows' },
      { ...context, output: { invalid: undefined } },
    ]) {
      const { conn, query } = connection()
      await expect(
        executePipelineActions(conn, { workspaceId, runId }, [], malformed),
      ).rejects.toThrow(z.ZodError)
      expect(query).not.toHaveBeenCalled()
    }
  })

  it('rejects a missing actor before changing roles', async () => {
    const { conn, query } = connection([], workspaceId, false, '')
    await expect(
      executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'project',
            operation: 'create_project',
            arguments: { p_title: 'A' },
          },
        ],
        context,
      ),
    ).rejects.toThrow('Pipeline action identity does not match its workspace.')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('restores the role on transport failure without owning the transaction', async () => {
    const { conn, query } = connection([])
    query.mockRejectedValueOnce(new Error('SQL failure'))
    await expect(
      executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'project',
            operation: 'create_project',
            arguments: { p_title: 'A' },
          },
        ],
        context,
      ),
    ).rejects.toThrow('SQL failure')
    expect(query).toHaveBeenLastCalledWith('SET ROLE NONE')
    expect(conn.begin).not.toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
    expect(conn.rollback).not.toHaveBeenCalled()
  })

  it('waits for one action before invoking the next', async () => {
    const { conn, query } = connection([])

    let resolveFirst:
      ((result: Awaited<ReturnType<typeof query>>) => void) | undefined

    const first = new Promise<Awaited<ReturnType<typeof query>>>((resolve) => {
      resolveFirst = resolve
    })

    query.mockReturnValueOnce(first)
    query.mockResolvedValueOnce({
      rows: [{ result: { id: runId } }],
    })

    const running = executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'first',
          operation: 'create_project',
          arguments: { p_title: 'A' },
        },
        {
          name: 'next',
          operation: 'create_model_record',
          arguments: {
            p_project_id: { $ref: 'actions.first.id' },
            p_kind: 'experiment',
            p_title: 'B',
          },
        },
      ],
      context,
    )

    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(3))
    expect(query.mock.calls[2][0]).toContain('create_project')

    if (!resolveFirst)
      throw new Error('The action transport was not initialized.')
    resolveFirst({
      rows: [{ result: { id: workspaceId } }],
    })
    await expect(running).resolves.toEqual({
      first: { id: workspaceId },
      next: { id: runId },
    })
    expect(query.mock.calls[3][1]).toEqual([workspaceId, 'experiment', 'B'])
  })

  it('retains scalar and array action results rather than coercing them to objects', async () => {
    for (const result of [
      false,
      0,
      '1.2e12',
      [1, false, null, { unit: 'vg/mL' }],
    ]) {
      const { conn } = connection([result])
      await expect(
        executePipelineActions(
          conn,
          { workspaceId, runId },
          [
            {
              name: 'project',
              operation: 'create_project',
              arguments: { p_title: 'A' },
            },
          ],
          context,
        ),
      ).resolves.toEqual({ project: result })
    }
  })

  it('omits one-time tokens before storing action results', async () => {
    const { conn } = connection([
      { id: runId, token: 'one-time-secret', email: 'person@example.com' },
    ])

    await expect(
      executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'invite',
            operation: 'reissue_invitation',
            arguments: { p_workspace_id: workspaceId, p_invitation_id: runId },
          },
        ],
        context,
      ),
    ).resolves.toEqual({ invite: { id: runId, email: 'person@example.com' } })
  })

  it('builds the four supported proposal forms without executing their RPCs', async () => {
    const cases: Array<{
      operation: string
      arguments: PipelineAction['arguments']
      expected: z.infer<typeof pipelineJsonValueSchema>
    }> = [
      {
        operation: 'insert_block',
        arguments: {
          p_record_id: runId,
          p_type: 'paragraph',
          p_payload: { text: 'scientific note' },
          p_expected_structure_version: 3,
        },
        expected: {
          kind: 'notebook_block.insert',
          recordId: runId,
          afterBlockId: null,
          block: {
            type: 'paragraph',
            payload: { text: 'scientific note' },
            payloadSchemaVersion: 1,
          },
          expectedRevision: 3,
        },
      },
      {
        operation: 'mark_reagent_ordered',
        arguments: {
          p_order_id: runId,
          p_order_reference: null,
          p_supplier: 'Supplier',
          p_total_price: 0,
        },
        expected: {
          kind: 'reagent_order.mark_ordered',
          orderId: runId,
          supplier: 'Supplier',
          totalPrice: 0,
        },
      },
      {
        operation: 'set_reagent_order_price',
        arguments: { p_order_id: runId, p_total_price: null, p_currency: null },
        expected: {
          kind: 'reagent_order.set_price',
          orderId: runId,
          totalPrice: null,
        },
      },
      {
        operation: 'set_instrument_rate',
        arguments: {
          p_instrument_id: runId,
          p_rate_per_hour: 2.5,
          p_currency: 'GBP',
        },
        expected: {
          kind: 'instrument_rate.set',
          instrumentId: runId,
          ratePerHour: 2.5,
          currency: 'GBP',
        },
      },
    ]

    for (const entry of cases) {
      const { conn, query } = connection(
        [{ id: 'proposal' }],
        workspaceId,
        true,
      )

      await expect(
        executePipelineActions(
          conn,
          { workspaceId, runId },
          [
            {
              name: 'proposal',
              operation: entry.operation,
              arguments: entry.arguments,
              mode: 'propose',
            },
          ],
          context,
        ),
      ).resolves.toEqual({ proposal: { id: 'proposal' } })

      const writes = query.mock.calls.filter(([sql]) =>
        sql.startsWith('SELECT to_jsonb'),
      )

      expect(writes).toHaveLength(1)
      expect(writes[0][0]).toContain('api.propose_agent_operation(')
      expect(
        pipelineJsonValueSchema.parse(
          JSON.parse(z.string().parse(writes[0][1]?.[3])),
        ),
      ).toEqual(entry.expected)
      expect(
        pipelineJsonValueSchema.parse(
          JSON.parse(z.string().parse(writes[0][1]?.[4])),
        ),
      ).toEqual({
        kind: 'pipeline',
        pipelineId: 'd1',
        pipelineName: 'Prices',
        definitionVersionId: 'v1',
        runId,
        invocationId: `${runId}:proposal`,
      })
      expect(writes[0][1]?.[5]).toBe(`pipeline:${runId}:proposal`)
    }
  })

  it('retains the missing proposed block revision error and never writes a proposal', async () => {
    const { conn, query } = connection([{ id: 'proposal' }], workspaceId, true)
    await expect(
      executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'block',
            operation: 'insert_block',
            mode: 'propose',
            arguments: {
              p_record_id: runId,
              p_type: 'paragraph',
              p_payload: {},
            },
          },
        ],
        context,
      ),
    ).rejects.toThrow(
      'A proposed block insert needs p_expected_structure_version: the proposal records the revision the pipeline saw.',
    )
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.includes('propose_agent_operation'),
      ),
    ).toHaveLength(0)
    expect(query).toHaveBeenLastCalledWith('SET ROLE NONE')
  })

  it('rejects an invalid proposal response and unsupported proposal modes', async () => {
    for (const response of [null, [], { id: 3 }]) {
      const { conn } = connection([response], workspaceId, true)
      await expect(
        executePipelineActions(
          conn,
          { workspaceId, runId },
          [
            {
              name: 'rate',
              operation: 'set_instrument_rate',
              mode: 'propose',
              arguments: {
                p_instrument_id: runId,
                p_rate_per_hour: null,
                p_currency: null,
              },
            },
          ],
          context,
        ),
      ).rejects.toThrow('could not be proposed.')
    }

    const { conn, query } = connection()
    await expect(
      executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'project',
            operation: 'create_project',
            mode: 'propose',
            arguments: { p_title: 'A' },
          },
        ],
        context,
      ),
    ).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })

  it('calls the order and rate actions with typed, bound values', async () => {
    const { conn, query } = connection([{ id: 'o1' }, { instrument_id: 'i1' }])
    const order = '00000000-0000-4000-8000-0000000000a1'
    const instrument = '00000000-0000-4000-8000-0000000000a2'
    await executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'place',
          operation: 'mark_reagent_ordered',
          arguments: {
            p_order_id: order,
            p_expected_on: '2026-12-01',
            p_total_price: 120.5,
            p_currency: 'GBP',
          },
        },
        {
          name: 'rate',
          operation: 'set_instrument_rate',
          arguments: {
            p_instrument_id: instrument,
            p_rate_per_hour: null,
            p_currency: null,
          },
        },
      ],
      context,
    )

    const calls = query.mock.calls.filter(([sql]) =>
      sql.startsWith('SELECT to_jsonb'),
    )

    expect(calls[0][0]).toContain('p_expected_on => $2::date')
    expect(calls[0][1]).toEqual([order, '2026-12-01', 120.5, 'GBP'])
    expect(calls[1][1]).toEqual([instrument, null, null])
    await expect(
      executePipelineActions(
        connection().conn,
        { workspaceId, runId },
        [
          {
            name: 'bad',
            operation: 'mark_reagent_ordered',
            arguments: { p_order_id: order, p_expected_on: 'tomorrow' },
          },
        ],
        context,
      ),
    ).rejects.toThrow('Invalid p_expected_on')
  })
  describe('bulk import (one action for each row)', () => {
    const order = (n: number) => `00000000-0000-4000-8000-0000000001${n}0`

    const rows = [
      { order_id: order(1), price: 10.5, ccy: 'GBP' },
      { order_id: order(2), price: 20, ccy: 'GBP' },
      { order_id: order(3), price: null, ccy: 'GBP' },
    ]

    const loop = {
      name: 'prices',
      operation: 'set_reagent_order_price',
      forEach: { $ref: 'previous' },
      arguments: {
        p_order_id: { $ref: 'row.order_id' },
        p_total_price: { $ref: 'row.price' },
        p_currency: { $ref: 'row.ccy' },
      },
    }

    it("runs the action for every row with that row's values, in order", async () => {
      const { conn, query } = connection([{ a: 1 }, { a: 2 }, { a: 3 }])

      const results = await executePipelineActions(
        conn,
        { workspaceId, runId },
        [loop],
        { ...context, previous: rows },
      )

      const calls = query.mock.calls.filter(([sql]) =>
        sql.startsWith('SELECT to_jsonb'),
      )

      expect(calls.map(([, values]) => values)).toEqual([
        [order(1), 10.5, 'GBP'],
        [order(2), 20, 'GBP'],
        [order(3), null, 'GBP'],
      ])
      expect(results.prices).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
    })

    it('names the row that failed, and stops there', async () => {
      const { conn, query } = connection([{ a: 1 }, null])
      await expect(
        executePipelineActions(conn, { workspaceId, runId }, [loop], {
          ...context,
          previous: rows,
        }),
      ).rejects.toThrow('Row 2 of 3')
      expect(
        query.mock.calls.filter(([sql]) => sql.startsWith('SELECT to_jsonb')),
      ).toHaveLength(2)
    })

    it('refuses a list that is not rows', async () => {
      await expect(
        executePipelineActions(
          connection().conn,
          { workspaceId, runId },
          [loop],
          { ...context, previous: [1, 2] },
        ),
      ).rejects.toThrow('not a list of rows')
    })

    it('gives each row its own idempotency key and proposal', async () => {
      const proposed = [{ id: 'p1' }, { id: 'p2' }]
      const { conn, query } = connection(proposed, workspaceId, true)
      await executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'rates',
            operation: 'set_instrument_rate',
            mode: 'propose',
            forEach: { $ref: 'parameters.instruments' },
            arguments: {
              p_instrument_id: { $ref: 'row.id' },
              p_rate_per_hour: { $ref: 'row.rate' },
              p_currency: 'GBP',
            },
          },
        ],
        {
          ...context,
          parameters: {
            instruments: [
              { id: order(1), rate: 5 },
              { id: order(2), rate: 6 },
            ],
          },
        },
      )

      const proposals = query.mock.calls.filter(([sql]) =>
        sql.includes('propose_agent_operation'),
      )

      expect(proposals.map(([, values]) => values?.[5])).toEqual([
        `pipeline:${runId}:rates:0`,
        `pipeline:${runId}:rates:1`,
      ])
      expect(
        pipelineJsonValueSchema.parse(
          JSON.parse(z.string().parse(proposals[0][1]?.[3])),
        ),
      ).toEqual({
        kind: 'instrument_rate.set',
        instrumentId: order(1),
        ratePerHour: 5,
        currency: 'GBP',
      })
    })

    it('checks the loop when the pipeline is saved', () => {
      expect(validatePipelineActions([loop])).toEqual([])
      expect(
        validatePipelineActions([{ ...loop, forEach: 'previous' }]),
      ).not.toEqual([])
      expect(
        validatePipelineActions([{ ...loop, forEach: { $ref: 'secrets.x' } }]),
      ).not.toEqual([])
    })
  })
  it('marks a part done with typed, bound values', async () => {
    const { conn, query } = connection([{ part: {} }])
    const part = '00000000-0000-4000-8000-0000000000c1'
    await executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'finish',
          operation: 'set_part_done',
          arguments: { p_part_id: part, p_done: true },
        },
      ],
      context,
    )

    const calls = query.mock.calls.filter(([sql]) =>
      sql.startsWith('SELECT to_jsonb'),
    )

    expect(calls[0][1]).toEqual([part, true])
  })
  it('asks someone to sign off a part with typed, bound values', async () => {
    const { conn, query } = connection([{ request: {} }])
    const part = '00000000-0000-4000-8000-0000000000c2'
    await executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'ask',
          operation: 'request_part_signoff',
          arguments: {
            p_part_id: part,
            p_user_id: 'u-1',
            p_note: 'Over to you',
          },
        },
      ],
      context,
    )

    const calls = query.mock.calls.filter(([sql]) =>
      sql.startsWith('SELECT to_jsonb'),
    )

    expect(calls[0][1]).toEqual([part, 'u-1', 'Over to you'])
  })
  it('finishes a step and records a result with typed, bound values', async () => {
    const { conn, query } = connection([{ done: true }, { block: {} }])
    const step = '00000000-0000-4000-8000-0000000000b1'
    await executePipelineActions(
      conn,
      { workspaceId, runId },
      [
        {
          name: 'finish',
          operation: 'set_step_done',
          arguments: { p_block_id: step, p_done: true, p_note: 'plate 4 read' },
        },
        {
          name: 'result',
          operation: 'add_step_result',
          arguments: {
            p_block_id: step,
            p_label: 'Titre',
            p_value: '1.2e12',
            p_unit: 'vg/mL',
          },
        },
      ],
      context,
    )

    const calls = query.mock.calls.filter(([sql]) =>
      sql.startsWith('SELECT to_jsonb'),
    )

    expect(calls[0][0]).toContain('p_done => $2::boolean')
    expect(calls[0][1]).toEqual([step, true, 'plate 4 read'])
    expect(calls[1][1]).toEqual([step, 'Titre', '1.2e12', 'vg/mL'])
    await expect(
      executePipelineActions(
        connection().conn,
        { workspaceId, runId },
        [
          {
            name: 'bad',
            operation: 'set_step_done',
            arguments: { p_block_id: step, p_done: 'yes' },
          },
        ],
        context,
      ),
    ).rejects.toThrow('Invalid p_done')
  })

  describe('planning actions', () => {
    it('fills in the workspace itself and binds a due date as a timestamp', async () => {
      const { conn, query } = connection([{ id: runId }])
      await executePipelineActions(
        conn,
        { workspaceId, runId },
        [
          {
            name: 'task',
            operation: 'create_study_task',
            arguments: {
              p_title: 'Submit the data',
              p_due_at: '2026-12-01T12:00:00Z',
            },
          },
        ],
        context,
      )

      const calls = query.mock.calls.filter(([sql]) =>
        sql.startsWith('SELECT to_jsonb'),
      )

      expect(calls[0][0]).toContain('p_workspace_id => $1::uuid')
      expect(calls[0][0]).toContain('p_due_at => $3::timestamptz')
      expect(calls[0][1]).toEqual([
        workspaceId,
        'Submit the data',
        '2026-12-01T12:00:00Z',
      ])
    })

    it('refuses a workspace the step supplies, and a date that is not one', async () => {
      expect(
        validatePipelineActions([
          {
            name: 'task',
            operation: 'create_study_task',
            arguments: { p_title: 'x', p_workspace_id: workspaceId },
          },
        ]),
      ).not.toEqual([])
      const { conn } = connection()
      await expect(
        executePipelineActions(
          conn,
          { workspaceId, runId },
          [
            {
              name: 'task',
              operation: 'create_study_task',
              arguments: { p_title: 'x', p_due_at: 'next Tuesday' },
            },
          ],
          context,
        ),
      ).rejects.toThrow('Invalid p_due_at')
    })
  })
})
