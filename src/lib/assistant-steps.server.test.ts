import { describe, expect, it } from 'vitest'

import { FEATURE_ASSISTANT_SERVERS } from '../features/assistant.server.gen'
import {
  ASSISTANT_PROPOSE_TOOL_NAMES,
  ASSISTANT_READ_TOOL_NAMES,
  fromWireToolName,
} from './agent-tool-catalogue'
import { automationProposalDefs } from './assistant-automation.server'
import { benchProposalDefs } from './assistant-bench.server'
import { instrumentsProposalDefs } from './assistant-instruments.server'
import { bookingProposalDefs, labToolDefs } from './assistant-lab-tools.server'
import { labworkProposalDefs } from './assistant-labwork.server'
import { platesProposalDefs } from './assistant-plates.server'
import { plannerProposalDefs } from './assistant-planner.server'
import {
  gatesToolDefs,
  inboxToolDefs,
  partsToolDefs,
  planningProposalDefs,
  seriesToolDefs,
  stepsToolDefs,
} from './assistant-planning.server'
import { proposalToolDefs } from './assistant-proposals'
import { qcProposalDefs } from './assistant-qc.server'
import { studiesProposalDefs } from './assistant-studies.server'
import { upkeepProposalDefs } from './assistant-upkeep.server'
import { recordReadDefs } from './assistant-record-read.server'
import { semanticToolDefs } from './semantic-tools.server'
import {
  READ_STEP_TOOLS,
  callLine,
  groupSteps,
  itemLine,
  proposalAction,
} from './assistant-steps'
import type { StepCall } from './assistant-steps'
import { WORKSPACE_TOOL_NAME } from './assistant-workspace'
import { FIND_TOOLS_NAME } from './assistant-tool-select'

const FEATURES = FEATURE_ASSISTANT_SERVERS

const readDefs = [
  ...labToolDefs(),
  ...inboxToolDefs(),
  ...stepsToolDefs(),
  ...seriesToolDefs(),
  ...partsToolDefs(),
  ...gatesToolDefs(),
  ...semanticToolDefs(true),
  ...recordReadDefs(),
  ...FEATURES.flatMap((feature) => feature.readDefs?.() ?? []),
]

const proposalDefs = [
  ...proposalToolDefs(),
  ...bookingProposalDefs(),
  ...benchProposalDefs(),
  ...planningProposalDefs(),
  ...upkeepProposalDefs(),
  ...platesProposalDefs(),
  ...qcProposalDefs(),
  ...studiesProposalDefs(),
  ...instrumentsProposalDefs(),
  ...automationProposalDefs(),
  ...plannerProposalDefs(),
  ...labworkProposalDefs(),
  ...FEATURES.flatMap((feature) => feature.proposalDefs?.() ?? []),
]

const names = (defs: readonly { name: string }[]) =>
  defs.map((def) => fromWireToolName(def.name))

const READ_TOOLS = [
  ...new Set([
    ...ASSISTANT_READ_TOOL_NAMES,
    ...names(readDefs),
    WORKSPACE_TOOL_NAME,
    fromWireToolName(FIND_TOOLS_NAME),
    'sheetbase.guide',
    'plugin.protocols-io.search',
    'plugin.protocols-io.read',
    'plugin.protocols-io.import',
  ]),
]

const PROPOSE_TOOLS = [
  ...new Set([...ASSISTANT_PROPOSE_TOOL_NAMES, ...names(proposalDefs)]),
]

/** The one item a test expects. */
function only<T>(items: readonly T[]): T {
  const [item] = items

  if (item === undefined) throw new Error('Expected one item')

  return item
}

const call = (
  toolName: string,
  input: Record<string, string | boolean | string[] | Record<string, string>>,
  extra: Partial<StepCall> = {},
): StepCall => ({ toolName, input, state: 'done', ...extra })

describe('every tool the assistant can call has its own step wording', () => {
  it.each(READ_TOOLS)('%s reads with a hand-written step', (name) => {
    expect(READ_STEP_TOOLS, name).toContain(name)
  })

  it.each(PROPOSE_TOOLS)('%s says which card it prepares', (name) => {
    expect(
      proposalAction(name).split(' ').filter(Boolean).length,
    ).toBeGreaterThan(0)
    expect(name).toMatch(/^sheetbase\.[a-z_]+(\.[a-z_]+)*$/)
  })

  it('never falls back to a line that says nothing', () => {
    for (const name of [...READ_TOOLS, ...PROPOSE_TOOLS]) {
      for (const state of ['running', 'done', 'failed'] as const) {
        const line = callLine(call(name, {}, { state, error: 'Not found.' }))

        expect(line, `${name} ${state}`).not.toMatch(
          /something|that up|look that|got that ready/i,
        )
        expect(line.length, `${name} ${state}`).toBeGreaterThan(8)
      }
    }
  })

  it('tells a failed step apart: what it could not do, and why', () => {
    for (const name of [...READ_TOOLS, ...PROPOSE_TOOLS]) {
      expect(
        callLine(call(name, {}, { state: 'failed', error: 'Not found.' })),
        name,
      ).toMatch(/^Couldn’t .+: not found$/)
    }
  })
})

describe('step wording', () => {
  it('says a record read as a read, never as a card', () => {
    expect(
      callLine(call('sheetbase.record.read', { record: 'EXP-4302' })),
    ).toBe('Read record EXP-4302')
    expect(callLine(call('sheetbase.assistant.created', {}))).toBe(
      'Read what the assistant made',
    )
  })

  it('names what was searched for and where', () => {
    expect(
      callLine(call('sheetbase.protocol.read', { query: 'PicoGreen' })),
    ).toBe('Searched protocols for “PicoGreen”')
    expect(
      callLine(
        call(
          'sheetbase.template.list',
          { query: 'PicoGreen' },
          { state: 'running' },
        ),
      ),
    ).toBe('Searching templates for “PicoGreen”')
    expect(callLine(call('sheetbase.search', { query: 'PicoGreen kit' }))).toBe(
      'Searched the workspace for “PicoGreen kit”',
    )
  })

  it('says which area was looked up and any filter used', () => {
    expect(
      callLine(
        call('sheetbase.lab.list', {
          area: 'reagent_orders',
          query: 'PicoGreen',
        }),
      ),
    ).toBe('Looked up reagent orders for “PicoGreen”')
    expect(
      callLine(
        call('sheetbase.canonical.read', {
          resource: 'samples',
          filters: { status: 'open' },
        }),
      ),
    ).toBe('Looked up samples where status is open')
  })

  it('names the record a lookup opened, from the call or from the result', () => {
    expect(
      callLine(
        call(
          'sheetbase.protocol.read',
          { recordId: '11111111-1111-4111-8111-111111111111' },
          { refs: ['PRT-0007', 'MAT-0001'] },
        ),
      ),
    ).toBe('Opened protocol PRT-0007')
    expect(callLine(call('sheetbase.steps.read', { record: 'EXP-0142' }))).toBe(
      'Read steps of experiment EXP-0142',
    )
  })

  it('says why a step failed, in plain words', () => {
    expect(
      callLine(
        call(
          'sheetbase.templates.read',
          { template: 'T-12' },
          { state: 'failed', error: 'Template not found.' },
        ),
      ),
    ).toBe('Couldn’t open template T-12: template not found')
    expect(
      callLine(call('sheetbase.search', { query: 'x' }, { state: 'failed' })),
    ).toBe('Couldn’t search the workspace for “x”: it didn’t finish')
  })

  it('says a plug-in tool by plug-in and tool', () => {
    expect(callLine(call('plugin.sequence-tools.restriction_digest', {}))).toBe(
      'Used restriction digest with sequence-tools',
    )
  })
})

describe('steps that read alike are one line', () => {
  const searches = [
    call('sheetbase.protocol.read', { query: 'PicoGreen' }),
    call('sheetbase.template.list', { query: 'PicoGreen' }),
    call('sheetbase.search', { query: 'PicoGreen' }),
    call('sheetbase.search', { query: 'PicoGreen kit' }),
  ]

  it('merges consecutive searches and counts them', () => {
    const items = groupSteps(searches)

    expect(items).toHaveLength(1)
    expect(itemLine(only(items))).toBe(
      'Searched protocols, templates and the workspace for “PicoGreen” and “PicoGreen kit” (4 searches)',
    )
    expect(items[0]?.calls).toHaveLength(4)
  })

  it('merges opened records of one kind by identifier', () => {
    const items = groupSteps([
      call('sheetbase.templates.read', { template: 'T-12' }),
      call('sheetbase.templates.read', { template: 'T-13' }),
    ])

    expect(itemLine(only(items))).toBe('Opened templates T-12 and T-13')
  })

  it('keeps a running or failed step on its own line', () => {
    const items = groupSteps([
      ...searches.slice(0, 2),
      call(
        'sheetbase.search',
        { query: 'x' },
        { state: 'failed', error: 'No.' },
      ),
      call('sheetbase.search', { query: 'y' }, { state: 'running' }),
    ])

    expect(items.map((item) => item.calls.length)).toEqual([2, 1, 1])
  })

  it('does not merge different kinds of step', () => {
    const items = groupSteps([
      call('sheetbase.search', { query: 'a' }),
      call('sheetbase.steps.read', { record: 'EXP-0142' }),
      call('sheetbase.search', { query: 'b' }),
    ])

    expect(items).toHaveLength(3)
  })
})
