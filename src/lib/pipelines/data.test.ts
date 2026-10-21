import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import {
  answerPipelineRunPrompt,
  cancelPipelineRun,
  createPipelineDefinition,
  createPipelineDefinitionVersion,
  createPipelineSchedule,
  deletePipelineSchedule,
  executePipelineRun,
  getPipelineDefinition,
  listPipelineDefinitionVersions,
  listPipelineDefinitions,
  listPipelineRuns,
  listPipelineSchedules,
  listRunCompatiblePipelines,
  publishPipelineDefinitionVersion,
  retirePipelineDefinitionVersion,
  startPipelineRun,
  updatePipelineDefinition,
  updatePipelineDefinitionVersionDraft,
  updatePipelineSchedule,
} from './data'

function capturedClient(): {
  client: DataClient
  calls: Array<{ name: string; args: Record<string, unknown> }>
} {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    client: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { id: 'row-1' }
      },
      list: async () => [],
    } as unknown as DataClient,
  }
}

describe('pipeline data client', () => {
  it('maps definition and version writes to the governed RPCs', async () => {
    const { client, calls } = capturedClient()
    await createPipelineDefinition(client, {
      workspaceId: 'ws-1',
      key: 'norm',
      name: 'Normalize',
    })
    await updatePipelineDefinition(client, {
      workspaceId: 'ws-1',
      definitionId: 'def-1',
      name: 'Renamed',
    })
    await createPipelineDefinitionVersion(client, {
      workspaceId: 'ws-1',
      definitionId: 'def-1',
      configuration: { configVersion: 1 },
    })
    await updatePipelineDefinitionVersionDraft(client, {
      workspaceId: 'ws-1',
      versionId: 'ver-1',
      expectedRevision: 1,
      configuration: { configVersion: 1 },
    })
    await publishPipelineDefinitionVersion(client, {
      workspaceId: 'ws-1',
      versionId: 'ver-1',
    })
    await retirePipelineDefinitionVersion(client, {
      workspaceId: 'ws-1',
      versionId: 'ver-1',
    })
    expect(calls.map((c) => c.name)).toEqual([
      'create_pipeline_definition',
      'update_pipeline_definition',
      'create_pipeline_definition_version',
      'update_pipeline_definition_version_draft',
      'publish_pipeline_definition_version',
      'retire_pipeline_definition_version',
    ])
  })

  it('passes run parameters, inputs and retry lineage through', async () => {
    const { client, calls } = capturedClient()
    await startPipelineRun(client, {
      workspaceId: 'ws-1',
      definitionVersionId: 'ver-1',
      parameters: { factor: 2 },
      inputVersions: { input: 'dv-1' },
      retryOfRunId: 'run-1',
      triggerOccurrenceId: 'evt:00000000-0000-4000-8000-000000000001',
    })
    const call = calls[0]
    expect(call.name).toBe('start_pipeline_run')
    expect(call.args).toMatchObject({
      p_workspace_id: 'ws-1',
      p_definition_version_id: 'ver-1',
      p_parameters: { factor: 2 },
      p_input_versions: { input: 'dv-1' },
      p_retry_of_run_id: 'run-1',
      p_trigger_occurrence_id: 'evt:00000000-0000-4000-8000-000000000001',
      p_trigger_kind: 'manual',
    })
    // The canonical input digest is computed server-side; the client never
    // supplies one.
    expect(call.args).not.toHaveProperty('p_input_digest')
  })

  it('cancels and schedules through the governed RPCs', async () => {
    const { client, calls } = capturedClient()
    await cancelPipelineRun(client, { workspaceId: 'ws-1', runId: 'run-1' })
    await createPipelineSchedule(client, {
      workspaceId: 'ws-1',
      definitionId: 'def-1',
      kind: 'interval',
      spec: { intervalMinutes: 30 },
    })
    await updatePipelineSchedule(client, {
      workspaceId: 'ws-1',
      scheduleId: 'sched-1',
      enabled: false,
    })
    await deletePipelineSchedule(client, {
      workspaceId: 'ws-1',
      scheduleId: 'sched-1',
    })
    expect(calls.map((c) => c.name)).toEqual([
      'cancel_pipeline_run',
      'create_pipeline_schedule',
      'update_pipeline_schedule',
      'delete_pipeline_schedule',
    ])
  })

  it('builds PostgREST read queries with the expected filters', async () => {
    const queries: string[] = []
    const client = {
      list: async (_resource: string, query: string) => {
        queries.push(query)
        return []
      },
    } as unknown as DataClient
    await listPipelineDefinitions(client)
    await getPipelineDefinition(client, 'def-1')
    await listPipelineDefinitionVersions(client, 'def-1')
    await listPipelineRuns(client, 'ver-1')
    await listPipelineSchedules(client, 'def-1')
    expect(queries[0]).toContain('order=name.asc')
    expect(queries[1]).toContain('id=eq.def-1')
    expect(queries[2]).toContain('definition_id=eq.def-1')
    expect(queries[3]).toContain('definition_version_id=eq.ver-1')
    expect(queries[4]).toContain('definition_id=eq.def-1')
  })

  it('lists only single-input published Pipelines as run-compatible', async () => {
    const published = [
      {
        id: 'ver-1',
        definition_id: 'def-1',
        version: 1,
        lifecycle: 'published',
        configuration: {
          configVersion: 1,
          inputs: [{ name: 'measurements', required: true }],
          parameters: [{ name: 'factor', type: 'decimal', required: true }],
        },
      },
      {
        id: 'ver-2',
        definition_id: 'def-2',
        version: 2,
        lifecycle: 'published',
        configuration: {
          configVersion: 1,
          inputs: [
            { name: 'a', required: true },
            { name: 'b', required: true },
          ],
          parameters: [],
        },
      },
    ]
    const definitions = [
      { id: 'def-1', name: 'Scale', key: 'scale', lifecycle: 'active' },
      { id: 'def-2', name: 'Join', key: 'join', lifecycle: 'active' },
      { id: 'def-3', name: 'Draft', key: 'draft', lifecycle: 'active' },
    ]
    let index = 0
    const client = {
      list: async (resource: string) => {
        if (resource === 'pipeline_definitions') return definitions
        if (resource === 'pipeline_definition_versions') return published
        index += 1
        return []
      },
    } as unknown as DataClient
    const compatible = await listRunCompatiblePipelines(client)
    expect(compatible).toHaveLength(1)
    expect(compatible[0]).toMatchObject({
      definitionId: 'def-1',
      definitionName: 'Scale',
      versionId: 'ver-1',
      inputName: 'measurements',
      hasParameters: true,
    })
  })
})

describe('following a queued run', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const state = (job: unknown, status = 'running') =>
    Response.json({ run: { id: 'run-1', status }, job })

  it('queues the run, then polls until its job settles and returns the run', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'run-1' }, { status: 202 }))
      .mockResolvedValueOnce(state({ state: 'queued', lastError: null }))
      .mockResolvedValueOnce(state({ state: 'claimed', lastError: null }))
      .mockResolvedValueOnce(
        state({ state: 'done', lastError: null }, 'succeeded'),
      )
    vi.stubGlobal('fetch', fetchMock)
    const pending = executePipelineRun('run-1')
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toMatchObject({ status: 'succeeded' })
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/pipelines/execute',
      expect.objectContaining({ method: 'POST' }),
    ])
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/pipelines/execute?runId=run-1',
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('reports a job the workers gave up on', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: 'run-1' }, { status: 202 }))
        .mockResolvedValueOnce(
          Response.json({
            run: {
              id: 'run-1',
              status: 'failed',
              error_message: 'worker lost',
            },
            job: { state: 'dead', lastError: 'gave up' },
          }),
        ),
    )
    await expect(executePipelineRun('run-1')).rejects.toThrow('worker lost')
  })

  it('surfaces a refused request without polling', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: 'run_not_found',
              message: 'Pipeline run not found.',
            },
          },
          { status: 404 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(executePipelineRun('run-1')).rejects.toThrow(
      'Pipeline run not found.',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows a decision to the end the same way', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: 'run-1' }, { status: 202 }))
        .mockResolvedValueOnce(
          state({ state: 'done', lastError: null }, 'succeeded'),
        ),
    )
    await expect(
      answerPipelineRunPrompt('run-1', { decision: 'confirm' }),
    ).resolves.toMatchObject({ status: 'succeeded' })
  })
})
