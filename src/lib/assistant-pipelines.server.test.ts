import { describe, expect, it, vi } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import {
  PIPELINES_PROPOSE_TOOL_NAMES,
  PIPELINE_CANCEL_TOOL,
  PIPELINE_PUBLISH_TOOL,
  PIPELINE_RETIRE_TOOL,
  PIPELINE_RETRY_TOOL,
  PIPELINE_RUN_TOOL,
  PIPELINE_SCHEDULE_ADD_TOOL,
  PIPELINE_SCHEDULE_DELETE_TOOL,
  PIPELINE_SCHEDULE_SWITCH_TOOL,
  PLUGIN_REMOVE_TOOL,
  PLUGIN_SWITCH_TOOL,
  isPipelinesAction,
} from './assistant-pipelines'
import {
  buildPipelinesProposal,
  isPipelinesProposalTool,
  pipelinesProposalDefs,
} from './assistant-pipelines.server'
import { runPipelinesAction } from './assistant-pipelines-run'
import type { LabToolContext } from './assistant-lab-tools.server'
import { dataClientTestDouble } from './data-client-test-support'

const PIPELINE = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'nightly_qc',
  name: 'Nightly QC',
  lifecycle: 'active',
}

const PUBLISHED = {
  id: '22222222-2222-4222-8222-222222222222',
  version: 3,
  lifecycle: 'published',
  configuration: { inputs: [{ name: 'plates' }] },
}

const DRAFT = { ...PUBLISHED, id: 'draft-4', version: 4, lifecycle: 'draft' }

const FAILED_RUN = {
  id: 'run-1',
  status: 'failed',
  attempt: 1,
  started_at: '2026-11-09T06:00:00Z',
  error_message: 'Input empty',
}

const PLUGIN = {
  id: 'ext-1',
  key: 'sequence-tools',
  name: 'Sequence tools',
  version: '1.2.0',
  status: 'enabled',
}

/** Fixture rows for one resource, replacing what the context seeds by default. */
const fixtures = (
  entries: readonly (readonly [resource: string, rows: readonly object[]])[],
) => new Map(entries)

function context(
  overrides: ReadonlyMap<string, readonly object[]> = new Map(),
): LabToolContext {
  const rows = new Map<string, readonly object[]>([
    ['pipeline_definitions', [PIPELINE]],
    ['pipeline_runs', [FAILED_RUN]],
    [
      'pipeline_schedules',
      [
        {
          id: 'sch-1',
          kind: 'daily',
          spec: { dailyAt: '06:00' },
          enabled: true,
        },
      ],
    ],
    ['extensions', [PLUGIN]],
    ['datasets', [{ id: 'ds-1', name: 'Plate reads' }]],
    ['dataset_versions', [{ id: 'dv-9', label: 'v9' }]],
  ])

  for (const [resource, fixturesForResource] of overrides) {
    rows.set(resource, fixturesForResource)
  }

  const client = dataClientTestDouble({
    list: async (resource, query = '') => {
      if (resource === 'pipeline_definition_versions') {
        if (query.includes('lifecycle=eq.published'))
          return rows.get('published') ?? [PUBLISHED]

        if (query.includes('lifecycle=eq.draft'))
          return rows.get('draft') ?? [DRAFT]

        return [PUBLISHED, DRAFT]
      }

      return rows.get(resource) ?? []
    },
  })

  return {
    client,
    workspaceId: 'ws-1',
    userId: 'u',
    timeZone: 'Europe/London',
  }
}

const base = { title: 'Do it', summary: 'What was asked' }

describe('pipeline and plugin assistant cards', () => {
  it('registers every tool with the agent catalogue and the model', () => {
    for (const name of PIPELINES_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isPipelinesProposalTool(name)).toBe(true)
    }

    expect(pipelinesProposalDefs().map((d) => d.name)).toEqual(
      PIPELINES_PROPOSE_TOOL_NAMES.map((n) => n.replaceAll('.', '__')),
    )
  })

  it('runs the published version on the newest version of each named dataset', async () => {
    const built = await buildPipelinesProposal(
      PIPELINE_RUN_TOOL,
      {
        ...base,
        pipeline: 'nightly qc',
        inputs: { plates: 'Plate reads' },
        parameters: { threshold: 0.2 },
      },
      context(),
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.action).toEqual({
      kind: 'pipeline.run',
      definitionId: PIPELINE.id,
      versionId: PUBLISHED.id,
      parameters: { threshold: 0.2 },
      inputVersions: { plates: 'dv-9' },
    })
    expect(isPipelinesAction(built.proposal.action ?? { kind: '' })).toBe(true)
  })

  it('asks which dataset a required input reads, and refuses unknown inputs', async () => {
    const missing = await buildPipelinesProposal(
      PIPELINE_RUN_TOOL,
      { ...base, pipeline: 'Nightly QC' },
      context(),
    )

    expect(missing).toMatchObject({ ok: false })

    if (!missing.ok) expect(missing.message).toContain('plates')

    const unknown = await buildPipelinesProposal(
      PIPELINE_RUN_TOOL,
      { ...base, pipeline: 'Nightly QC', inputs: { wells: 'Plate reads' } },
      context(),
    )

    expect(unknown).toMatchObject({ ok: false })
  })

  it('will not run a retired pipeline or one with nothing published', async () => {
    const retired = await buildPipelinesProposal(
      PIPELINE_RUN_TOOL,
      { ...base, pipeline: 'Nightly QC' },
      context(
        fixtures([
          ['pipeline_definitions', [{ ...PIPELINE, lifecycle: 'retired' }]],
        ]),
      ),
    )

    expect(retired).toMatchObject({ ok: false })

    const unpublished = await buildPipelinesProposal(
      PIPELINE_RUN_TOOL,
      { ...base, pipeline: 'Nightly QC' },
      context(fixtures([['published', []]])),
    )

    expect(unpublished).toMatchObject({ ok: false })
  })

  it('retries the newest failed run and cancels a running one', async () => {
    const retry = await buildPipelinesProposal(
      PIPELINE_RETRY_TOOL,
      { ...base, pipeline: 'Nightly QC' },
      context(),
    )

    expect(retry.ok && retry.proposal.action).toEqual({
      kind: 'pipeline.retry',
      definitionId: PIPELINE.id,
      runId: 'run-1',
    })

    const cancel = await buildPipelinesProposal(
      PIPELINE_CANCEL_TOOL,
      { ...base, pipeline: 'Nightly QC' },
      context(
        fixtures([['pipeline_runs', [{ ...FAILED_RUN, status: 'running' }]]]),
      ),
    )

    expect(cancel.ok && cancel.proposal.action).toMatchObject({
      kind: 'pipeline.cancel',
      runId: 'run-1',
    })
  })

  it('publishes the draft and retires or brings back a pipeline', async () => {
    const publish = await buildPipelinesProposal(
      PIPELINE_PUBLISH_TOOL,
      { ...base, pipeline: 'nightly_qc' },
      context(),
    )

    expect(publish.ok && publish.proposal.changes).toEqual([
      { label: 'Published version', before: 'v3', after: 'v4' },
    ])

    const retire = await buildPipelinesProposal(
      PIPELINE_RETIRE_TOOL,
      { ...base, pipeline: 'Nightly QC', retire: true },
      context(),
    )

    expect(retire.ok && retire.proposal.action).toMatchObject({
      kind: 'pipeline.retire',
      lifecycle: 'retired',
    })

    const again = await buildPipelinesProposal(
      PIPELINE_RETIRE_TOOL,
      { ...base, pipeline: 'Nightly QC', retire: false },
      context(),
    )

    expect(again).toMatchObject({ ok: false })
  })

  it('adds a daily schedule in the person’s time zone and refuses two kinds at once', async () => {
    const daily = await buildPipelinesProposal(
      PIPELINE_SCHEDULE_ADD_TOOL,
      { ...base, pipeline: 'Nightly QC', dailyAt: '06:30' },
      context(),
    )

    expect(daily.ok && daily.proposal.action).toMatchObject({
      kind: 'pipeline.schedule_add',
      scheduleKind: 'daily',
      spec: { dailyAt: '06:30', timeZone: 'Europe/London' },
    })

    const both = await buildPipelinesProposal(
      PIPELINE_SCHEDULE_ADD_TOOL,
      { ...base, pipeline: 'Nightly QC', dailyAt: '06:30', everyMinutes: 60 },
      context(),
    )

    expect(both).toMatchObject({ ok: false })

    const event = await buildPipelinesProposal(
      PIPELINE_SCHEDULE_ADD_TOOL,
      { ...base, pipeline: 'Nightly QC', onEvent: 'not.an.event' },
      context(),
    )

    expect(event).toMatchObject({ ok: false })
  })

  it('pauses or deletes the one schedule, and asks which when there are several', async () => {
    const pause = await buildPipelinesProposal(
      PIPELINE_SCHEDULE_SWITCH_TOOL,
      { ...base, pipeline: 'Nightly QC', on: false },
      context(),
    )

    expect(pause.ok && pause.proposal.action).toMatchObject({
      kind: 'pipeline.schedule_switch',
      scheduleId: 'sch-1',
      enabled: false,
    })

    const already = await buildPipelinesProposal(
      PIPELINE_SCHEDULE_SWITCH_TOOL,
      { ...base, pipeline: 'Nightly QC', on: true },
      context(),
    )

    expect(already).toMatchObject({ ok: false })

    const remove = await buildPipelinesProposal(
      PIPELINE_SCHEDULE_DELETE_TOOL,
      { ...base, pipeline: 'Nightly QC' },
      context(),
    )

    expect(remove.ok && remove.proposal.action).toMatchObject({
      kind: 'pipeline.schedule_delete',
      scheduleId: 'sch-1',
    })

    const several = await buildPipelinesProposal(
      PIPELINE_SCHEDULE_DELETE_TOOL,
      { ...base, pipeline: 'Nightly QC' },
      context(
        fixtures([
          [
            'pipeline_schedules',
            [
              {
                id: 'a',
                kind: 'daily',
                spec: { dailyAt: '06:00' },
                enabled: true,
              },
              { id: 'b', kind: 'interval', spec: { intervalMinutes: 60 } },
            ],
          ],
        ]),
      ),
    )

    expect(several).toMatchObject({ ok: false })

    if (!several.ok) expect(several.message).toContain('which one')
  })

  it('switches a plugin off and removes one', async () => {
    const off = await buildPipelinesProposal(
      PLUGIN_SWITCH_TOOL,
      { ...base, plugin: 'sequence tools', on: false },
      context(),
    )

    expect(off.ok && off.proposal.action).toEqual({
      kind: 'plugin.switch',
      workspaceId: 'ws-1',
      extensionId: 'ext-1',
      enabled: false,
    })

    const remove = await buildPipelinesProposal(
      PLUGIN_REMOVE_TOOL,
      { ...base, plugin: 'sequence-tools' },
      context(),
    )

    expect(remove.ok && remove.proposal.action).toMatchObject({
      kind: 'plugin.remove',
      extensionId: 'ext-1',
    })
  })
})

describe('pressing a pipeline or plugin card', () => {
  it('calls the ordinary operations as the person', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'run-2' })
    const client = dataClientTestDouble({ rpc })
    await expect(
      runPipelinesAction(client, {
        kind: 'pipeline.run',
        definitionId: 'd',
        versionId: 'v',
        parameters: {},
        inputVersions: { plates: 'dv' },
      }),
    ).resolves.toEqual({ openHref: '/pipelines/d/runs/run-2' })
    expect(rpc).toHaveBeenLastCalledWith('run_pipeline_version', {
      p_version_id: 'v',
      p_parameters: {},
      p_input_versions: { plates: 'dv' },
    })
    await runPipelinesAction(client, {
      kind: 'plugin.switch',
      workspaceId: 'w',
      extensionId: 'e',
      enabled: false,
    })
    expect(rpc).toHaveBeenLastCalledWith('disable_extension', {
      p_workspace_id: 'w',
      p_extension_id: 'e',
    })
    await runPipelinesAction(client, {
      kind: 'pipeline.schedule_switch',
      workspaceId: 'w',
      definitionId: 'd',
      scheduleId: 's',
      enabled: true,
    })
    expect(rpc).toHaveBeenLastCalledWith('update_pipeline_schedule', {
      p_workspace_id: 'w',
      p_schedule_id: 's',
      p_kind: null,
      p_spec: null,
      p_enabled: true,
    })
  })
})
