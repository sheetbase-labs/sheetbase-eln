import { describe, expect, it, vi } from 'vitest'
import {
  executePipelineActions,
  resolvePipelineActionValue,
} from './pipeline-actions.server'
import type { ExecConnection } from './pipeline-execute.server'
import { validatePipelineActions } from './pipelines/actions'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const runId = '00000000-0000-4000-8000-000000000002'
const context = {
  parameters: { title: "Hello'); DROP TABLE api.records;--" },
  previous: [],
  output: {},
}
function connection(
  results: unknown[] = [{ id: workspaceId }],
  workspace = workspaceId,
) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.startsWith('SELECT api.current_workspace'))
      return { rows: [{ workspace_id: workspace, user_id: 'actor' }] }
    if (sql.startsWith('SELECT to_jsonb'))
      return { rows: [{ result: results.shift() }] }
    return { rows: [] }
  })
  return { conn: { query } as unknown as ExecConnection, query }
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

    it('refuses a list that is not rows, and an import that is too large', async () => {
      await expect(
        executePipelineActions(
          connection().conn,
          { workspaceId, runId },
          [loop],
          { ...context, previous: [1, 2] as unknown as [] },
        ),
      ).rejects.toThrow('not a list of rows')
      await expect(
        executePipelineActions(
          connection().conn,
          { workspaceId, runId },
          [loop],
          {
            ...context,
            previous: Array.from({ length: 501 }, () => ({})),
          },
        ),
      ).rejects.toThrow('the most is 500')
    })

    it('gives each row its own idempotency key and proposal', async () => {
      const proposed = [{ id: 'p1' }, { id: 'p2' }]
      const query = vi.fn(async (sql: string, _values?: unknown[]) => {
        if (sql.startsWith('SELECT api.current_workspace'))
          return { rows: [{ workspace_id: workspaceId, user_id: 'actor' }] }
        if (sql.includes('FROM api.pipeline_runs'))
          return {
            rows: [
              {
                definition_id: 'd1',
                definition_name: 'Prices',
                version_id: 'v1',
              },
            ],
          }
        if (sql.includes('propose_agent_operation'))
          return { rows: [{ result: proposed.shift() }] }
        return { rows: [] }
      })
      const conn = { query } as unknown as ExecConnection
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
      expect(proposals.map(([, values]) => (values as unknown[])[5])).toEqual([
        `pipeline:${runId}:rates:0`,
        `pipeline:${runId}:rates:1`,
      ])
      expect(
        JSON.parse((proposals[0][1] as string[])[3]) as Record<string, unknown>,
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
})
