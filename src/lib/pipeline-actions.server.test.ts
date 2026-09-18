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
})
