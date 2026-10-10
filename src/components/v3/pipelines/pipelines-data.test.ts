import { describe, expect, it } from 'vitest'

import {
  buildPipelineRows,
  currentVersion,
  draftVersion,
  runStatus,
} from './pipelines-data'
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
