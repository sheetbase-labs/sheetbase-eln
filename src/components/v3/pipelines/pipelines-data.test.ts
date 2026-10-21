import { describe, expect, it, vi } from 'vitest'

import {
  buildPipelineRows,
  currentVersion,
  draftVersion,
  fetchPipelineOutputTargets,
  fetchSchemaVersionFields,
  resolveRunForWorkItem,
  runStatus,
} from './pipelines-data'
import type { DataClient } from '#/lib/data-client'
import type {
  PipelineDefinitionVersionWire,
  PipelineDefinitionWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'

function definition(
  overrides: Partial<PipelineDefinitionWire> = {},
): PipelineDefinitionWire {
  return {
    id: 'def-1',
    workspace_id: 'ws-1',
    key: 'glucose_trend',
    name: 'Glucose trend',
    description: null,
    lifecycle: 'active',
    revision: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_by_user_id: null,
    updated_by_user_id: null,
    ...overrides,
  }
}

function version(
  overrides: Partial<PipelineDefinitionVersionWire> = {},
): PipelineDefinitionVersionWire {
  return {
    id: 'v-1',
    definition_id: 'def-1',
    workspace_id: 'ws-1',
    version: 1,
    lifecycle: 'published',
    configuration_format_version: 1,
    configuration: {},
    revision: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_by_user_id: null,
    published_at: '2026-01-02T00:00:00Z',
    published_by_user_id: null,
    retired_at: null,
    retired_by_user_id: null,
    ...overrides,
  }
}

function run(overrides: Partial<PipelineRunWire> = {}): PipelineRunWire {
  return {
    id: 'run-1',
    workspace_id: 'ws-1',
    definition_version_id: 'v-1',
    trigger_kind: 'manual',
    status: 'succeeded',
    attempt: 1,
    retry_of_run_id: null,
    trigger_occurrence_id: null,
    schedule_id: null,
    input_digest: null,
    parameters: {},
    input_versions: {},
    result: {},
    error_code: null,
    error_message: null,
    started_at: '2026-02-01T10:00:00Z',
    finished_at: '2026-02-01T10:00:02Z',
    actor_user_id: null,
    actor_credential_id: null,
    created_at: '2026-02-01T10:00:00Z',
    ...overrides,
  }
}

describe('buildPipelineRows', () => {
  it('chooses the newest published version and counts runs across versions', () => {
    const rows = buildPipelineRows(
      [definition()],
      [
        version({ id: 'v-1', version: 1, lifecycle: 'retired' }),
        version({ id: 'v-2', version: 2, lifecycle: 'published' }),
        version({ id: 'v-3', version: 3, lifecycle: 'draft' }),
      ],
      [
        run({ id: 'run-a', definition_version_id: 'v-1' }),
        run({
          id: 'run-b',
          definition_version_id: 'v-2',
          started_at: '2026-03-01T10:00:00Z',
        }),
      ],
    )
    expect(rows[0].current?.id).toBe('v-2')
    expect(rows[0].draft?.id).toBe('v-3')
    expect(rows[0].runCount).toBe(2)
    // Newest run first, regardless of which version produced it.
    expect(rows[0].lastRun?.id).toBe('run-b')
  })

  it('reports no current version when only a draft exists', () => {
    const rows = buildPipelineRows(
      [definition()],
      [version({ id: 'v-1', lifecycle: 'draft' })],
      [],
    )
    expect(rows[0].draft?.id).toBe('v-1')
    expect(rows[0].runCount).toBe(0)
    expect(rows[0].lastRun).toBeUndefined()
  })
})

describe('currentVersion and draftVersion', () => {
  it('prefers published over draft and retired', () => {
    const versions = [
      version({ id: 'draft', version: 3, lifecycle: 'draft' }),
      version({ id: 'published', version: 2, lifecycle: 'published' }),
      version({ id: 'retired', version: 1, lifecycle: 'retired' }),
    ]
    expect(currentVersion(versions)?.id).toBe('published')
    expect(draftVersion(versions)?.id).toBe('draft')
  })
})

describe('runStatus', () => {
  it('maps run statuses to tone and label', () => {
    expect(runStatus('running')).toEqual({ tone: 'progress', label: 'Running' })
    expect(runStatus('waiting')).toEqual({
      tone: 'warn',
      label: 'Waiting for a person',
    })
    expect(runStatus('succeeded')).toEqual({ tone: 'ok', label: 'Succeeded' })
    expect(runStatus('failed')).toEqual({ tone: 'bad', label: 'Failed' })
    expect(runStatus('cancelled')).toEqual({
      tone: 'stored',
      label: 'Cancelled',
    })
  })
})

describe('resolveRunForWorkItem', () => {
  const client = (rows: Record<string, unknown[]>) =>
    ({
      list: vi.fn(async (resource: string) => rows[resource] ?? []),
    }) as unknown as DataClient

  it('finds the run a waiting item’s prompt belongs to', async () => {
    const run = await resolveRunForWorkItem(
      { kind: 'run_waiting', sourceId: 'prompt-1', identifier: 'glucose' },
      client({ pipeline_run_prompts: [{ run_id: 'run-7' }] }),
    )
    expect(run).toBe('run-7')
  })

  it('finds the newest failed run of the pipeline a failed item names', async () => {
    const c = client({
      pipeline_definitions: [{ id: 'def-1' }],
      pipeline_definition_versions: [{ id: 'v-1' }, { id: 'v-2' }],
      pipeline_runs: [{ id: 'run-9' }],
    })
    const run = await resolveRunForWorkItem(
      { kind: 'run_failed', sourceId: null, identifier: 'glucose' },
      c,
    )
    expect(run).toBe('run-9')
    expect(vi.mocked(c.list).mock.calls.at(-1)?.[1]).toContain(
      'definition_version_id=in.(v-1,v-2)&status=eq.failed',
    )
  })

  it('has no run for a pipeline that no longer exists, or another kind', async () => {
    expect(
      await resolveRunForWorkItem(
        { kind: 'run_failed', sourceId: null, identifier: 'gone' },
        client({}),
      ),
    ).toBeNull()
    expect(
      await resolveRunForWorkItem(
        { kind: 'data_issue', sourceId: null, identifier: 'DS-1' },
        client({}),
      ),
    ).toBeNull()
  })
})

describe('pipeline output targets', () => {
  const listing = (rows: Record<string, unknown[]>) =>
    ({
      list: vi.fn(async (resource: string) => rows[resource] ?? []),
    }) as unknown as DataClient

  it('offers active schema versions (a schema version is never "published")', async () => {
    const c = listing({
      dataset_schema_versions: [{ id: 'sv-1', schema_id: 's-1', version: 2 }],
      dataset_schema_definitions: [{ id: 's-1', name: 'Viability' }],
      datasets: [
        {
          id: 'd-1',
          name: 'Runs',
          display_id: 'DS-0001',
          schema_version_id: 'sv-1',
        },
      ],
    })
    const targets = await fetchPipelineOutputTargets(c)
    expect(targets.schemaVersions).toEqual([
      { id: 'sv-1', label: 'Viability v2' },
    ])
    expect(targets.datasets).toEqual([
      {
        id: 'd-1',
        name: 'Runs',
        displayId: 'DS-0001',
        schemaVersionId: 'sv-1',
      },
    ])
    const queries = vi.mocked(c.list).mock.calls.map((call) => call[1])
    expect(queries.join(' ')).toContain('lifecycle=eq.active')
    expect(queries.join(' ')).not.toContain('lifecycle=eq.published')
  })

  it('reads a schema version’s fields as the keys a SQL step uses', async () => {
    const c = listing({
      dataset_schema_version_fields: [
        {
          key: 'sample',
          label: 'Sample',
          logical_type: 'text',
          nullable: false,
        },
        { key: 'od', label: 'OD', logical_type: 'decimal', nullable: true },
      ],
    })
    expect(await fetchSchemaVersionFields(c, 'sv-1')).toEqual([
      { key: 'sample', label: 'Sample', type: 'text', required: true },
      { key: 'od', label: 'OD', type: 'decimal', required: false },
    ])
  })
})
