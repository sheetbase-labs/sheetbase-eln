import { describe, expect, it } from 'vitest'

import {
  AUTOMATION_PROPOSE_TOOL_NAMES,
  ROBOT_SEND_TOOL,
  SCHEDULE_ACCEPT_TOOL,
  SCHEDULE_PLAN_TOOL,
  isAutomationAction,
} from './assistant-automation'
import {
  automationProposalDefs,
  buildAutomationProposal,
  isAutomationProposalTool,
} from './assistant-automation.server'
import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const WORKLIST = {
  id: '11111111-1111-4111-8111-111111111111',
  number: 4,
  name: 'Serial dilution',
  status: 'planned',
  format: 'opentrons',
  record_id: null,
}

const ROBOT = {
  id: '22222222-2222-4222-8222-222222222222',
  display_id: 'INS-0007',
  name: 'OT-2 bench',
  location: null,
  retired_at: null,
}

const EXPERIMENT = {
  id: '33333333-3333-4333-8333-333333333333',
  identifier: 'EXP-0145',
  title: 'Cell assay',
}

const PROPOSAL = {
  id: '44444444-4444-4444-8444-444444444444',
  number: 9,
  reason: 'plan',
  conflict_count: 1,
  items: [
    { kind: 'instrument', startsAt: '2026-11-09T09:00:00Z' },
    { kind: 'hands_on', startsAt: '2026-11-09T09:00:00Z' },
  ],
}

function context(
  rows: Partial<Record<string, Array<Record<string, unknown>>>> = {},
): LabToolContext {
  const defaults: Record<string, Array<Record<string, unknown>>> = {
    plate_worklists: [WORKLIST],
    instruments: [ROBOT],
    instrument_robot_settings: [
      { driver: 'opentrons', worklist_format: 'opentrons' },
    ],
    instrument_jobs: [],
    records: [EXPERIMENT],
    experiment_parts: [{ id: 'part-1' }, { id: 'part-2' }],
    part_resource_needs: [{ id: 'need-1' }],
    schedule_proposals: [PROPOSAL],
  }

  const client = {
    list: (resource: string) =>
      Promise.resolve(rows[resource] ?? defaults[resource]),
  } as unknown as DataClient

  return { client, workspaceId: 'w', userId: 'u', timeZone: 'UTC' }
}

const base = { title: 'Do it', summary: 'A short summary' }

describe('automation assistant cards', () => {
  it('registers every tool with the agent catalogue and the model', () => {
    for (const name of AUTOMATION_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isAutomationProposalTool(name)).toBe(true)
    }

    expect(automationProposalDefs().map((d) => d.name)).toEqual(
      AUTOMATION_PROPOSE_TOOL_NAMES.map((n) => n.replaceAll('.', '__')),
    )
  })

  it('proposes sending a planned worklist to a robot and says a person starts it', async () => {
    const built = await buildAutomationProposal(
      ROBOT_SEND_TOOL,
      { ...base, worklist: 'WL-0004', robot: 'OT-2', note: 'Use fresh tips' },
      context(),
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.action).toEqual({
      kind: 'robot.send',
      worklistId: WORKLIST.id,
      instrumentId: ROBOT.id,
      note: 'Use fresh tips',
    })
    expect(isAutomationAction(built.proposal.action ?? { kind: '' })).toBe(true)
    expect(JSON.stringify(built.proposal.changes)).toContain('Start')
  })

  it('does not send to an instrument that is not a robot, or a worklist already on one', async () => {
    const notARobot = await buildAutomationProposal(
      ROBOT_SEND_TOOL,
      { ...base, worklist: 'WL-0004', robot: 'OT-2' },
      context({ instrument_robot_settings: [] }),
    )

    expect(notARobot.ok).toBe(false)

    const busy = await buildAutomationProposal(
      ROBOT_SEND_TOOL,
      { ...base, worklist: 'WL-0004', robot: 'OT-2' },
      context({ instrument_jobs: [{ number: 2, status: 'staged' }] }),
    )

    expect(busy.ok).toBe(false)

    if (!busy.ok) expect(busy.message).toContain('already on a robot')
  })

  it('has no card when no planned worklist matches', async () => {
    const built = await buildAutomationProposal(
      ROBOT_SEND_TOOL,
      { ...base, worklist: 'nothing', robot: 'OT-2' },
      context({ plate_worklists: [] }),
    )

    expect(built.ok).toBe(false)
  })

  it('proposes asking for a schedule only when parts say what they need', async () => {
    const ok = await buildAutomationProposal(
      SCHEDULE_PLAN_TOOL,
      { ...base, experiment: 'EXP-0145' },
      context(),
    )

    expect(ok.ok && ok.proposal.action).toEqual({
      kind: 'schedule.plan',
      recordId: EXPERIMENT.id,
    })

    const noParts = await buildAutomationProposal(
      SCHEDULE_PLAN_TOOL,
      { ...base, experiment: 'EXP-0145' },
      context({ experiment_parts: [] }),
    )

    expect(noParts.ok).toBe(false)

    const noNeeds = await buildAutomationProposal(
      SCHEDULE_PLAN_TOOL,
      { ...base, experiment: 'EXP-0145' },
      context({ part_resource_needs: [] }),
    )

    expect(noNeeds.ok).toBe(false)
  })

  it('proposes accepting the latest proposed schedule and says what needs a look', async () => {
    const built = await buildAutomationProposal(
      SCHEDULE_ACCEPT_TOOL,
      { ...base, experiment: 'EXP-0145' },
      context(),
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.action).toEqual({
      kind: 'schedule.accept',
      proposalId: PROPOSAL.id,
      recordId: EXPERIMENT.id,
    })
    const text = JSON.stringify(built.proposal.changes)
    expect(text).toContain('1 instrument slot booked')
    expect(text).toContain('Needs a look')
  })

  it('has nothing to accept when no schedule is proposed', async () => {
    const built = await buildAutomationProposal(
      SCHEDULE_ACCEPT_TOOL,
      { ...base, experiment: 'EXP-0145' },
      context({ schedule_proposals: [] }),
    )

    expect(built.ok).toBe(false)
  })
})
