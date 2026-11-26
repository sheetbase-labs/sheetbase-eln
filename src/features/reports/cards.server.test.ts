import { describe, expect, it, vi } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  REPORTS_PROPOSE_TOOL_NAMES,
  REPORT_SCHEDULE_ACTIVE_TOOL,
  REPORT_SCHEDULE_SAVE_TOOL,
  REPORT_SECTIONS_REORDER_TOOL,
  REPORT_SECTION_BIND_TOOL,
  REPORT_UPDATE_TOOL,
} from './cards'
import { runReportsAction } from './cards-run'
import { buildReportsProposal, reportsProposalDefs } from './cards.server'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

function context(
  tables: Record<string, core.util.JSONType[]>,
  rpcs: Record<string, core.util.JSONType> = {},
): LabToolContext {
  const fetchFixture: typeof fetch = async (input) => {
    const url = urlOf(input)
    const last = url.pathname.split('/').at(-1) ?? ''

    return Response.json(
      url.pathname.includes('/rpc/')
        ? (rpcs[last] ?? null)
        : (tables[last] ?? []),
    )
  }

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

const report = {
  id: 'r1',
  record_id: 'rec1',
  title: 'Stability summary',
  document_identifier: 'RPT-0007',
  status: 'draft',
}

const sections = [
  {
    id: 's1',
    title: 'Method',
    position: 1,
    section_type: 'text',
    description: null,
  },
  {
    id: 's2',
    title: 'Results',
    position: 2,
    section_type: 'chart',
    description: null,
  },
]

describe('the report cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      reportsProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([...REPORTS_PROPOSE_TOOL_NAMES])

    for (const name of REPORTS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('finds a report by its document number', async () => {
    const result = await buildReportsProposal(
      REPORT_UPDATE_TOOL,
      { ...base, report: 'RPT-0007', status: 'in_review' },
      context({ report_definitions: [report] }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'report.update',
      id: 'r1',
      status: 'in_review',
    })
  })

  it('never proposes approving or publishing a report', () => {
    const [def] = reportsProposalDefs().filter(
      (each) => each.name === REPORT_UPDATE_TOOL.replaceAll('.', '__'),
    )

    expect(JSON.stringify(def.parameters)).not.toContain('published')
    expect(JSON.stringify(def.parameters)).not.toContain('approved')
  })

  it('reorders sections only when all are named', async () => {
    const ctx = context({
      report_definitions: [report],
      report_sections: sections,
    })

    const partial = await buildReportsProposal(
      REPORT_SECTIONS_REORDER_TOOL,
      { ...base, report: 'RPT-0007', order: ['Results'] },
      ctx,
    )

    expect(partial.ok).toBe(false)

    const full = await buildReportsProposal(
      REPORT_SECTIONS_REORDER_TOOL,
      { ...base, report: 'RPT-0007', order: ['Results', 'Method'] },
      ctx,
    )

    if (!full.ok) throw new Error(full.message)
    expect(full.proposal.action).toMatchObject({
      kind: 'report.sections_reorder',
      sectionIds: ['s2', 's1'],
    })
  })

  it('points a section at the submitted version of an experiment', async () => {
    const ctx = context({
      report_definitions: [report],
      report_sections: [sections[1]],
      records: [
        {
          id: 'e1',
          identifier: 'EXP-0012',
          title: 'Run',
          kind: 'experiment',
          metadata_version: 1,
        },
      ],
      revisions: [
        {
          id: 'v1',
          structure_version: 2,
          block_snapshot: [{ id: 'b1', type: 'chart', payload: {} }],
        },
      ],
    })

    const result = await buildReportsProposal(
      REPORT_SECTION_BIND_TOOL,
      { ...base, report: 'RPT-0007', section: 'Results', record: 'EXP-0012' },
      ctx,
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'report.section_bind',
      workspaceId: 'ws',
      reportId: 'r1',
      sectionId: 's2',
      revisionId: 'v1',
      source: {
        blockId: 'b1',
        recordId: 'e1',
        recordIdentifier: 'EXP-0012',
        revisionVersion: 2,
      },
    })
  })

  it('schedules a report for named people in the person’s time zone', async () => {
    const ctx = context(
      {},
      {
        workspace_members_list: [
          { user_id: 'u1', name: 'Ada Lovelace' },
          { user_id: 'u2', name: 'Grace Hopper' },
        ],
      },
    )

    const result = await buildReportsProposal(
      REPORT_SCHEDULE_SAVE_TOOL,
      {
        ...base,
        schedule: 'Weekly spend',
        report: 'spend',
        period: 'previous_week',
        frequency: 'weekly',
        weekday: 'Friday',
        recipients: ['Ada'],
      },
      ctx,
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'report.schedule_save',
      id: null,
      weekday: 5,
      sendHour: 8,
      timeZone: 'Europe/London',
      recipientUserIds: ['u1'],
    })
  })

  it('does not pause a schedule that is already paused', async () => {
    const result = await buildReportsProposal(
      REPORT_SCHEDULE_ACTIVE_TOOL,
      { ...base, schedule: 'Weekly spend', active: false },
      context({
        scheduled_reports: [
          {
            id: 'sr1',
            name: 'Weekly spend',
            active: false,
            frequency: 'weekly',
          },
        ],
      }),
    )

    expect(result.ok).toBe(false)
  })
})

describe('pressing a report card', () => {
  it('opens the report it made', async () => {
    const rpc = vi.fn(async () => ({ id: 'r1', record_id: 'rec1' }))

    const result = await runReportsAction(
      { rpc },
      {
        kind: 'report.create',
        workspaceId: 'ws',
        title: 'New',
        subtitle: null,
        projectId: null,
      },
    )

    expect(result).toEqual({ openHref: '/reports/rec1' })
  })
})
