import { describe, expect, it, vi } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  BLOCK_DELETE_TOOL,
  BLOCK_MOVE_TOOL,
  EDIT_RPCS,
  EXPERIMENT_EDITS_CARD_ACTIONS,
  EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES,
  EXPERIMENT_FIELDS_TOOL,
  LEGAL_HOLD_ADD_TOOL,
  MODEL_FIELD_EDIT_TOOL,
  MODEL_UPGRADE_TOOL,
  PART_AMEND_TOOL,
  PART_DELETE_TOOL,
  PART_GATE_TOOL,
  PART_MOVE_TOOL,
  PART_PLAN_TOOL,
  PART_SLIP_TOOL,
  PART_SPLIT_TOOL,
  PROTOCOL_IMPORT_TOOL,
  QC_POINT_TOOL,
  RECORD_FAVOURITE_TOOL,
  RECORD_TRANSITION_TOOL,
  SERIES_DAY_TOOL,
  SERIES_START_TOOL,
} from './cards'
import { runExperimentEditsAction } from './cards-run'
import {
  buildExperimentEditsProposal,
  experimentEditsProposalDefs,
} from './cards.server'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

/** Answers each table or RPC by name; anything not listed is empty. */
function context(tables: Record<string, core.util.JSONType>): LabToolContext {
  const fetchFixture: typeof fetch = async (input) =>
    Response.json(tables[urlOf(input).pathname.split('/').at(-1) ?? ''] ?? [])

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

const experiment = {
  id: 'r1',
  identifier: 'EXP-4302',
  title: 'Dose response',
  kind: 'experiment',
  status: 'in_progress',
  project_id: 'p1',
  metadata_version: 4,
  archived_at: null,
  assignee_user_id: null,
}

const part = (n: number, title: string, extra = {}) => ({
  part_id: `part${n}`,
  part_number: n,
  title,
  day_offset: n - 1,
  due_on: null,
  assignee_user_id: null,
  status: 'later',
  is_current: n === 1,
  block_count: 2,
  ...extra,
})

const parts = [part(1, 'Seed cells'), part(2, 'Dose'), part(3, 'Read plate')]

const blocks = [
  {
    id: 'b1',
    type: 'rich_text',
    payload: { text: 'Aim of the day' },
    order: 1,
    version: 1,
  },
  {
    id: 'b2',
    type: 'procedure_step',
    payload: { text: 'Seed 5k cells' },
    order: 2,
    version: 1,
  },
  {
    id: 'b3',
    type: 'procedure_step',
    payload: { text: 'Add compound' },
    order: 3,
    version: 1,
  },
]

const world = {
  records: [{ ...experiment, structure_version: 9 }],
  record_parts: parts,
  blocks,
}

async function card(
  tool: Parameters<typeof buildExperimentEditsProposal>[0],
  args: Record<string, core.util.JSONType>,
  tables: Record<string, core.util.JSONType> = world,
) {
  const result = await buildExperimentEditsProposal(
    tool,
    { ...base, ...args },
    context(tables),
  )

  if (!result.ok) throw new Error(result.message)

  return result.proposal
}

async function refusal(
  tool: Parameters<typeof buildExperimentEditsProposal>[0],
  args: Record<string, core.util.JSONType>,
  tables: Record<string, core.util.JSONType> = world,
) {
  const result = await buildExperimentEditsProposal(
    tool,
    { ...base, ...args },
    context(tables),
  )

  if (result.ok) throw new Error('Expected a refusal.')

  return result.message
}

describe('the experiment edit cards', () => {
  it('offers every tool, on the gateway allowlist, with its words and an RPC', () => {
    expect(
      experimentEditsProposalDefs().map((def) =>
        def.name.replaceAll('__', '.'),
      ),
    ).toEqual([...EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES])

    for (const name of EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
      expect(Object.hasOwn(EXPERIMENT_EDITS_CARD_ACTIONS, name), name).toBe(
        true,
      )
    }

    expect(Object.keys(EDIT_RPCS)).toHaveLength(
      EXPERIMENT_EDITS_PROPOSE_TOOL_NAMES.length,
    )
  })

  it('finds an experiment by its ID and moves a part after another by number or words', async () => {
    const proposal = await card(PART_MOVE_TOOL, {
      experiment: 'EXP-4302',
      part: '3',
      after: 'seed',
    })

    expect(proposal.target).toBe('EXP-4302 · Dose response')
    expect(proposal.action).toMatchObject({
      kind: 'experiment_edits.part_move',
      params: { p_part_id: 'part3', p_after_part_id: 'part1' },
    })
  })

  it('moves a part to the front when no part is named to go after', async () => {
    const proposal = await card(PART_MOVE_TOOL, {
      experiment: 'EXP-4302',
      part: 'Read plate',
    })

    expect(proposal.action).toMatchObject({
      params: { p_part_id: 'part3', p_after_part_id: null },
    })
  })

  it('asks where the blocks of a deleted part go, then names the part', async () => {
    expect(
      await refusal(PART_DELETE_TOOL, { experiment: 'EXP-4302', part: '2' }),
    ).toMatch(/which part takes them/)

    const proposal = await card(PART_DELETE_TOOL, {
      experiment: 'EXP-4302',
      part: '2',
      moveBlocksTo: '1',
    })

    expect(proposal.action).toMatchObject({
      kind: 'experiment_edits.part_delete',
      params: { p_part_id: 'part2', p_move_blocks_to: 'part1' },
    })
  })

  it('reopens a signed part with the reason', async () => {
    const proposal = await card(PART_AMEND_TOOL, {
      experiment: 'EXP-4302',
      part: '1',
      reason: 'Wrong cell line recorded',
    })

    expect(proposal.action).toMatchObject({
      params: { p_part_id: 'part1', p_reason: 'Wrong cell line recorded' },
    })
  })

  it('sets a gate from named parts and dates', async () => {
    const proposal = await card(PART_GATE_TOOL, {
      experiment: 'EXP-4302',
      part: 'Read plate',
      conditions: [
        { kind: 'part_done', part: 'dose' },
        { kind: 'date_reached', date: '2026-12-01' },
      ],
      mode: 'block',
    })

    expect(proposal.action).toMatchObject({
      kind: 'experiment_edits.part_gate',
      params: {
        p_part_id: 'part3',
        p_conditions: [
          { kind: 'part_done', partId: 'part2' },
          { kind: 'date_reached', date: '2026-12-01' },
        ],
        p_gate_mode: 'block',
        p_steps_in_order: null,
      },
    })
  })

  it('takes a gate off with an empty list', async () => {
    const proposal = await card(PART_GATE_TOOL, {
      experiment: 'EXP-4302',
      part: '2',
      conditions: [],
    })

    expect(proposal.action).toMatchObject({
      params: { p_conditions: null },
    })
  })

  it('plans a part with the instrument it needs', async () => {
    const proposal = await card(
      PART_PLAN_TOOL,
      {
        experiment: 'EXP-4302',
        part: '2',
        handsOnMinutes: 45,
        waitAfterMinutes: 120,
        needs: [{ resource: 'Plate reader', minutes: 30 }],
      },
      { ...world, calendar_resources: [{ id: 'res1', name: 'Plate reader' }] },
    )

    expect(proposal.action).toMatchObject({
      params: {
        p_part_id: 'part2',
        p_hands_on_minutes: 45,
        p_wait_after_minutes: 120,
        p_needs: [{ resourceId: 'res1', minutes: 30 }],
      },
    })
  })

  it('slips a part, and refuses a slip of nothing', async () => {
    const proposal = await card(PART_SLIP_TOOL, {
      experiment: 'EXP-4302',
      part: '2',
      days: 2,
    })

    expect(proposal.action).toMatchObject({
      params: { p_part_id: 'part2', p_days: 2 },
    })
    expect(
      await refusal(PART_SLIP_TOOL, {
        experiment: 'EXP-4302',
        part: '2',
        days: 0,
      }),
    ).toMatch(/changes nothing/)
  })

  it('splits an experiment with no parts at the blocks named', async () => {
    const proposal = await card(
      PART_SPLIT_TOOL,
      {
        experiment: 'EXP-4302',
        parts: [
          { title: 'Seeding', firstBlock: '1' },
          { title: 'Dosing', firstBlock: 'compound' },
        ],
      },
      { ...world, record_parts: [] },
    )

    expect(proposal.action).toMatchObject({
      kind: 'experiment_edits.part_split',
      params: {
        p_record_id: 'r1',
        p_parts: [
          { title: 'Seeding', first_block_id: 'b1', day_offset: 0 },
          { title: 'Dosing', first_block_id: 'b3', day_offset: 1 },
        ],
      },
    })
    expect(
      await refusal(PART_SPLIT_TOOL, {
        experiment: 'EXP-4302',
        parts: [{ title: 'A', firstBlock: '1' }],
      }),
    ).toMatch(/already has parts/)
  })

  it('moves and deletes a block at the structure version it saw', async () => {
    const moved = await card(BLOCK_MOVE_TOOL, {
      experiment: 'EXP-4302',
      block: '3',
      after: '1',
    })

    expect(moved.action).toMatchObject({
      kind: 'experiment_edits.block_move',
      params: {
        p_block_id: 'b3',
        p_after_block_id: 'b1',
        p_expected_structure_version: 9,
      },
    })

    const deleted = await card(BLOCK_DELETE_TOOL, {
      experiment: 'EXP-4302',
      block: 'seed 5k',
    })

    expect(deleted.action).toMatchObject({
      params: { p_block_id: 'b2', p_expected_structure_version: 9 },
    })
    expect(
      await refusal(BLOCK_DELETE_TOOL, {
        experiment: 'EXP-4302',
        block: 'step',
      }),
    ).toMatch(/More than one block/)
  })

  it('changes a reviewer by name and the planned finish', async () => {
    const proposal = await card(
      EXPERIMENT_FIELDS_TOOL,
      {
        experiment: 'EXP-4302',
        reviewer: 'Ada Lovelace',
        plannedEnd: '2026-12-10',
      },
      {
        ...world,
        workspace_members_list: [{ user_id: 'u9', name: 'Ada Lovelace' }],
      },
    )

    expect(proposal.action).toMatchObject({
      kind: 'experiment_edits.fields',
      params: {
        p_record_id: 'r1',
        p_reviewer_user_id: 'u9',
        p_planned_end: '2026-12-10',
      },
    })
  })

  it('moves any record to another status and refuses a move to the same one', async () => {
    const proposal = await card(RECORD_TRANSITION_TOOL, {
      record: 'EXP-4302',
      status: 'In review',
    })

    expect(proposal.action).toMatchObject({
      params: {
        p_record_id: 'r1',
        p_target_status: 'in_review',
        p_expected_metadata_version: 4,
      },
    })
    expect(
      await refusal(RECORD_TRANSITION_TOOL, {
        record: 'EXP-4302',
        status: 'in_progress',
      }),
    ).toMatch(/already/)
  })

  it('favourites a record', async () => {
    const proposal = await card(RECORD_FAVOURITE_TOOL, {
      record: 'EXP-4302',
      favourite: true,
    })

    expect(proposal.action).toMatchObject({
      params: { p_object_kind: 'record', p_object_id: 'r1', p_favourite: true },
    })
  })

  it('puts records under an active hold found by name', async () => {
    const proposal = await card(
      LEGAL_HOLD_ADD_TOOL,
      { hold: 'Audit 2026', records: ['EXP-4302'] },
      { ...world, legal_holds: [{ id: 'h1', name: 'Audit 2026' }] },
    )

    expect(proposal.action).toMatchObject({
      params: { p_hold_id: 'h1', p_record_ids: ['r1'] },
    })
  })

  it('records a point on a series found by name', async () => {
    const proposal = await card(
      QC_POINT_TOOL,
      { series: 'Plate reader Z', value: 0.71 },
      { qc_series: [{ id: 's1', name: 'Plate reader Z', enabled: true }] },
    )

    expect(proposal.action).toMatchObject({
      kind: 'experiment_edits.qc_point',
      params: { p_series_id: 's1', p_value: 0.71 },
    })
  })

  it('starts a series and plans a member day', async () => {
    const started = await card(SERIES_START_TOOL, { experiment: 'EXP-4302' })

    expect(started.action).toMatchObject({
      params: { p_record_id: 'r1' },
    })

    const day = await card(SERIES_DAY_TOOL, {
      member: 'EXP-4302',
      plannedOn: '2026-12-02',
    })

    expect(day.action).toMatchObject({
      params: { p_member_record_id: 'r1', p_planned_on: '2026-12-02' },
    })
  })

  it('upgrades a record to the latest published version of its type', async () => {
    const proposal = await card(
      MODEL_UPGRADE_TOOL,
      { record: 'EXP-4302', reason: 'New fields' },
      {
        ...world,
        record_models: [{ id: 'm1', key: 'experiment', name: 'Experiment' }],
        record_model_versions: [
          { id: 'v3', version: 3, lifecycle: 'draft' },
          { id: 'v2', version: 2, lifecycle: 'published' },
        ],
      },
    )

    expect(proposal.action).toMatchObject({
      params: {
        p_record_id: 'r1',
        p_version_id: 'v2',
        p_expected_metadata_version: 4,
        p_reason: 'New fields',
      },
    })
  })

  it('imports a protocol with its steps and source', async () => {
    const proposal = await card(PROTOCOL_IMPORT_TOOL, {
      name: 'PicoGreen assay',
      steps: [{ text: 'Dilute the dye 1:200 in TE', section: 'Prepare' }],
      source: { provider: 'protocols.io', url: 'https://protocols.io/x' },
    })

    expect(proposal.action).toMatchObject({
      kind: 'experiment_edits.protocol_import',
      params: {
        p_title: 'PicoGreen assay',
        p_steps: [{ text: 'Dilute the dye 1:200 in TE', section: 'Prepare' }],
      },
      href: '/protocols',
    })
  })

  it('says so when the experiment is not found or a part is ambiguous', async () => {
    expect(
      await refusal(PART_MOVE_TOOL, { experiment: 'EXP-9999', part: '1' }, {}),
    ).toMatch(/No record matches/)
    expect(
      await refusal(PART_MOVE_TOOL, { experiment: 'EXP-4302', part: 'e' }),
    ).toMatch(/More than one part/)
  })
})

describe('editing a field of a draft version', () => {
  const tables = {
    record_models: [{ id: 'm1', key: 'experiment', name: 'Experiment' }],
    record_model_versions: [
      {
        id: 'v3',
        revision: 5,
        definition: {
          fields: [
            { label: 'Cell line', field_name: 'cell_line', nullable: true },
            { label: 'Passage', field_name: 'passage', nullable: true },
          ],
        },
      },
    ],
  }

  it('changes one field and sends the whole definition at its revision', async () => {
    const proposal = await card(
      MODEL_FIELD_EDIT_TOOL,
      {
        model: 'Experiment',
        field: 'cell line',
        required: true,
        label: 'Cell line used',
        reason: 'Needed for review',
      },
      tables,
    )

    expect(proposal.action).toMatchObject({
      kind: 'experiment_edits.version_edit',
      params: {
        p_version_id: 'v3',
        p_expected_revision: 5,
        p_reason: 'Needed for review',
        p_definition: {
          fields: [
            { label: 'Cell line used', nullable: false },
            { label: 'Passage', nullable: true },
          ],
        },
      },
    })
  })

  it('puts a field in each record’s header, and refuses a fifth', async () => {
    const proposal = await card(
      MODEL_FIELD_EDIT_TOOL,
      { model: 'Experiment', field: 'passage', header: true, reason: 'x' },
      tables,
    )

    expect(proposal.action).toMatchObject({
      params: {
        p_definition: {
          fields: [
            { label: 'Cell line' },
            { label: 'Passage', show_in_header: true },
          ],
        },
      },
    })

    const full = {
      ...tables,
      record_model_versions: [
        {
          ...tables.record_model_versions[0],
          definition: {
            fields: [
              ...['a', 'b', 'c', 'd'].map((name) => ({
                label: name,
                field_name: name,
                nullable: true,
                show_in_header: true,
              })),
              { label: 'Passage', field_name: 'passage', nullable: true },
            ],
          },
        },
      ],
    }

    expect(
      await refusal(
        MODEL_FIELD_EDIT_TOOL,
        { model: 'Experiment', field: 'passage', header: true, reason: 'x' },
        full,
      ),
    ).toMatch(/already shows 4 fields/)
  })

  it('asks for a draft version first', async () => {
    expect(
      await refusal(
        MODEL_FIELD_EDIT_TOOL,
        { model: 'Experiment', field: 'passage', required: true, reason: 'x' },
        { ...tables, record_model_versions: [] },
      ),
    ).toMatch(/no draft version/)
  })
})

describe('pressing an experiment edit card', () => {
  it('calls the one RPC with the resolved arguments, as the person', async () => {
    const rpc = vi.fn().mockResolvedValue(undefined)

    const result = await runExperimentEditsAction(
      { rpc },
      {
        kind: 'experiment_edits.part_slip',
        params: { p_part_id: 'part2', p_days: 2 },
      },
    )

    expect(rpc).toHaveBeenCalledWith('slip_experiment_part', {
      p_part_id: 'part2',
      p_days: 2,
    })
    expect(result).toBeUndefined()
  })

  it('opens the page the card names', async () => {
    const result = await runExperimentEditsAction(
      { rpc: vi.fn().mockResolvedValue(undefined) },
      {
        kind: 'experiment_edits.protocol_import',
        params: { p_title: 'X', p_steps: [] },
        href: '/protocols',
      },
    )

    expect(result).toEqual({ openHref: '/protocols' })
  })
})
