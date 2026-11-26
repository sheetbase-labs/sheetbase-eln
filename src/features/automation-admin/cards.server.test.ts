import { describe, expect, it, vi } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import { AUTOMATION_ADMIN_PROPOSE_TOOL_NAMES } from './cards'
import { runAutomationAdminAction } from './cards-run'
import {
  automationAdminProposalDefs,
  buildAutomationAdminProposal,
  isAutomationAdminProposalTool,
} from './cards.server'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

/** Answers each table by name; anything not listed is empty. */
function context(tables: Record<string, core.util.JSONType[]>): LabToolContext {
  const fetchFixture: typeof fetch = async (input) =>
    Response.json(tables[urlOf(input).pathname.split('/').at(-1) ?? ''] ?? [])

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

const hook = {
  id: 'h1',
  key: 'lims-sync',
  description: 'LIMS sync',
  url: 'https://lims.example/hook',
  status: 'active',
  event_types: ['sample.created'],
  max_retries: 5,
  failure_threshold: 10,
  rate_limit_per_minute: null,
}

describe('the automation cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      automationAdminProposalDefs().map((def) =>
        def.name.replaceAll('__', '.'),
      ),
    ).toEqual([...AUTOMATION_ADMIN_PROPOSE_TOOL_NAMES])

    for (const name of AUTOMATION_ADMIN_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
      expect(isAutomationAdminProposalTool(name)).toBe(true)
    }
  })

  it('finds a webhook by its description and shows what changes', async () => {
    const result = await buildAutomationAdminProposal(
      'sheetbase.webhook.update',
      { ...base, webhook: 'lims sync', status: 'paused', maxRetries: 3 },
      context({ webhook_subscriptions: [hook] }),
    )

    if (!result.ok) throw new Error(result.message)

    expect(result.proposal.changes).toEqual([
      { label: 'Status', before: 'active', after: 'paused' },
      { label: 'Retries', before: '5', after: '3' },
    ])

    expect(result.proposal.action.params).toEqual({
      p_workspace_id: 'ws',
      p_subscription_id: 'h1',
      p_status: 'paused',
      p_max_retries: 3,
    })
  })

  it('asks what to change rather than saving nothing', async () => {
    const result = await buildAutomationAdminProposal(
      'sheetbase.webhook.update',
      { ...base, webhook: 'lims-sync' },
      context({ webhook_subscriptions: [hook] }),
    )

    expect(result.ok).toBe(false)
  })

  it('retires the published version of a pipeline found by name', async () => {
    const result = await buildAutomationAdminProposal(
      'sheetbase.pipeline.retire_version',
      { ...base, pipeline: 'Nightly QC' },
      context({
        pipeline_definitions: [
          {
            id: 'd1',
            key: 'nightly-qc',
            name: 'Nightly QC',
            lifecycle: 'active',
          },
        ],
        pipeline_definition_versions: [
          { id: 'v3', version: 3, lifecycle: 'published' },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)

    expect(result.proposal.action.params).toEqual({
      p_workspace_id: 'ws',
      p_version_id: 'v3',
    })
  })

  it('will not remind when the pipeline has nothing waiting', async () => {
    const result = await buildAutomationAdminProposal(
      'sheetbase.pipeline.remind_run',
      { ...base, pipeline: 'Nightly QC' },
      context({
        pipeline_definitions: [
          {
            id: 'd1',
            key: 'nightly-qc',
            name: 'Nightly QC',
            lifecycle: 'active',
          },
        ],
        pipeline_definition_versions: [{ id: 'v3' }],
        pipeline_runs: [],
      }),
    )

    expect(result.ok).toBe(false)
  })

  it('needs an end for a repeat, and the days for a weekly one', async () => {
    const weekly = await buildAutomationAdminProposal(
      'sheetbase.recurring.create',
      {
        ...base,
        kind: 'booking',
        name: 'Monday qPCR',
        frequency: 'weekly',
        startsOn: '2026-12-07',
        endsOn: '2027-03-01',
      },
      context({}),
    )

    expect(weekly.ok).toBe(false)

    const open = await buildAutomationAdminProposal(
      'sheetbase.recurring.create',
      {
        ...base,
        kind: 'booking',
        name: 'Daily',
        frequency: 'daily',
        startsOn: '2026-12-07',
      },
      context({}),
    )

    expect(open.ok).toBe(false)
  })

  it('sets up a repeating booking on an instrument named by its INS number', async () => {
    const result = await buildAutomationAdminProposal(
      'sheetbase.recurring.create',
      {
        ...base,
        kind: 'booking',
        name: 'Monday qPCR',
        frequency: 'weekly',
        weekdays: [1],
        startsOn: '2026-12-07',
        maxOccurrences: 8,
        instrument: 'INS-0004',
        startTime: '09:00',
        endTime: '11:00',
      },
      context({
        instruments: [
          {
            id: 'i1',
            name: 'qPCR',
            display_id: 'INS-0004',
            location: null,
            instrument_type: 'qpcr',
            retired_at: null,
            out_of_service_at: null,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)

    expect(result.proposal.action.params).toMatchObject({
      p_kind: 'booking',
      p_resource_id: 'i1',
      p_weekdays: [1],
      p_timezone: 'Europe/London',
      p_max_occurrences: 8,
    })
  })

  it('runs a watcher found by its plain name', async () => {
    const result = await buildAutomationAdminProposal(
      'sheetbase.watcher.run',
      { ...base, watcher: 'stock expiring' },
      context({
        lab_watchers: [
          { id: 'w1', kind: 'stock_expiring', enabled: true },
          { id: 'w2', kind: 'stock_low', enabled: true },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action.params).toEqual({ p_watcher_id: 'w1' })
  })

  it('runs only the function the kind names, whatever the card carries', async () => {
    const rpc = vi.fn().mockResolvedValue(3)

    await runAutomationAdminAction(
      { rpc },
      {
        kind: 'events.retention',
        params: { p_workspace_id: 'ws', p_days: 90 },
        openHref: null,
      },
    )

    expect(rpc).toHaveBeenCalledWith('set_event_stream_retention', {
      p_workspace_id: 'ws',
      p_days: 90,
    })
  })
})
