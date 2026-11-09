import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import {
  DATASETS_PROPOSE_TOOL_NAMES,
  DATASET_CLEAR_FLAG_TOOL,
  DATASET_FLAG_TOOL,
  DATASET_PLAN_TOOL,
  DATASET_UNIT_TOOL,
  INTAKE_RESOLVE_TOOL,
  TABLE_CREATE_TOOL,
  TABLE_EDIT_TOOL,
  TABLE_PUBLISH_TOOL,
  TABLE_RETIRE_TOOL,
  isDatasetsAction,
  keyFromLabel,
} from './assistant-datasets'
import {
  buildDatasetsProposal,
  datasetsProposalDefs,
  isDatasetsProposalTool,
} from './assistant-datasets.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const TABLE = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'elisa_plate',
  name: 'ELISA plate',
  lifecycle: 'active',
  display_id: 'MT-0003',
}

const PUBLISHED = { id: 'v-2', version: 2, lifecycle: 'active', revision: 5 }

const FIELDS = [
  {
    field_id: 'f-well',
    key: 'well',
    label: 'Well',
    description: null,
    logical_type: 'text',
    nullable: false,
    quantity: null,
    lifecycle: 'active',
    display_order: 1,
  },
  {
    field_id: 'f-od',
    key: 'od450',
    label: 'OD450',
    description: null,
    logical_type: 'decimal',
    nullable: true,
    quantity: { unit: 'AU' },
    lifecycle: 'active',
    display_order: 2,
  },
]

const DATASET = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Plate 7 readout',
  display_id: 'DS-0012',
  schema_version_id: 'v-2',
  revision: 9,
  lifecycle: 'active',
  intended_use: 'exploratory_research',
}

const ROW = '33333333-3333-4333-8333-333333333333'

function context(extra: Record<string, unknown[]> = {}): LabToolContext {
  const rows: Record<string, unknown[]> = {
    dataset_schema_definitions: [TABLE],
    dataset_schema_versions: [PUBLISHED],
    dataset_schema_version_fields: FIELDS,
    datasets: [DATASET],
    dataset_rows: [{ id: ROW }],
    ...extra,
  }

  const client = {
    list: (resource: string) => Promise.resolve(rows[resource] ?? []),
    rpc: () => Promise.resolve({ blocked: false }),
  } as unknown as DataClient

  return { client, workspaceId: 'ws-1', userId: 'u', timeZone: 'UTC' }
}

const base = { title: 'Do it', summary: 'What was asked' }

describe('dataset and measurement table assistant cards', () => {
  it('registers every tool with the agent catalogue and the model', () => {
    const offered = datasetsProposalDefs().map((def) => def.name)

    for (const name of DATASETS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isDatasetsProposalTool(name)).toBe(true)
      expect(offered).toContain(name.replaceAll('.', '__'))
    }
  })

  it('makes a key the database accepts from a label', () => {
    expect(keyFromLabel('ELISA plate (v2)', new Set())).toBe('elisa_plate_v2')
    expect(keyFromLabel('2nd read', new Set())).toBe('f_2nd_read')
    expect(keyFromLabel('Well', new Set(['well']))).toBe('well_2')
  })

  it('proposes a new measurement table as a draft with its columns', async () => {
    const built = await buildDatasetsProposal(
      TABLE_CREATE_TOOL,
      {
        ...base,
        name: 'Cell counts',
        fields: [
          { label: 'Sample', type: 'text', required: true },
          { label: 'Viable cells', type: 'integer' },
        ],
      },
      context(),
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    const action = built.proposal.action
    expect(action && isDatasetsAction(action)).toBe(true)
    expect(action).toMatchObject({
      kind: 'measurement_table.create',
      key: 'cell_counts',
      parentId: null,
      fields: [
        { key: 'sample', logical_type: 'text', nullable: false },
        { key: 'viable_cells', logical_type: 'integer', nullable: true },
      ],
    })
  })

  it('starts a new draft when the table is published', async () => {
    const built = await buildDatasetsProposal(
      TABLE_EDIT_TOOL,
      {
        ...base,
        table: 'ELISA plate',
        add: [{ label: 'Dilution', type: 'decimal' }],
        remove: ['OD450'],
      },
      context(),
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.action).toMatchObject({
      kind: 'measurement_table.edit',
      definitionId: TABLE.id,
      draftVersionId: null,
      fields: [{ key: 'well' }, { key: 'dilution', field_id: null }],
    })
    expect(built.proposal.changes.at(-1)).toEqual({
      label: 'Version',
      before: 'v2',
      after: 'v3 draft',
    })
  })

  it('refuses to remove a column the table does not have', async () => {
    const built = await buildDatasetsProposal(
      TABLE_EDIT_TOOL,
      { ...base, table: 'ELISA plate', remove: ['Colour'] },
      context(),
    )

    expect(built).toMatchObject({ ok: false })

    if (built.ok) return
    expect(built.message).toContain('Well, OD450')
  })

  it('needs a draft to publish', async () => {
    const none = await buildDatasetsProposal(
      TABLE_PUBLISH_TOOL,
      { ...base, table: 'ELISA plate' },
      context(),
    )

    expect(none.ok).toBe(false)
    const draft = { id: 'v-3', version: 3, lifecycle: 'draft', revision: 1 }

    const built = await buildDatasetsProposal(
      TABLE_PUBLISH_TOOL,
      { ...base, table: 'ELISA plate' },
      context({ dataset_schema_versions: [draft, PUBLISHED] }),
    )

    expect(built.ok && built.proposal.action).toEqual({
      kind: 'measurement_table.publish',
      definitionId: TABLE.id,
      versionId: 'v-3',
    })
  })

  it('does not retire a retired table', async () => {
    const built = await buildDatasetsProposal(
      TABLE_RETIRE_TOOL,
      { ...base, table: 'ELISA plate' },
      context({
        dataset_schema_definitions: [{ ...TABLE, lifecycle: 'retired' }],
      }),
    )

    expect(built.ok).toBe(false)
  })

  it('flags a value on a column named by its label', async () => {
    const built = await buildDatasetsProposal(
      DATASET_FLAG_TOOL,
      {
        ...base,
        dataset: 'DS-0012',
        rowId: ROW,
        field: 'od450',
        kind: 'out_of_range',
        reason: 'Above the top standard',
      },
      context(),
    )

    expect(built.ok && built.proposal.action).toMatchObject({
      kind: 'dataset.flag_value',
      datasetId: DATASET.id,
      rowId: ROW,
      fieldId: 'f-od',
      flagKind: 'out_of_range',
    })
  })

  it('asks which flag when more than one is open', async () => {
    const flags = [
      { id: 'a', kind: 'high_cv', reason: 'CV 30%' },
      { id: 'b', kind: 'high_cv', reason: 'CV 25%' },
    ]

    const built = await buildDatasetsProposal(
      DATASET_CLEAR_FLAG_TOOL,
      { ...base, dataset: 'Plate 7', field: 'OD450' },
      context({ dataset_value_flags: flags }),
    )

    expect(built.ok).toBe(false)

    const one = await buildDatasetsProposal(
      DATASET_CLEAR_FLAG_TOOL,
      { ...base, dataset: 'Plate 7', field: 'OD450' },
      context({ dataset_value_flags: [flags[0]] }),
    )

    expect(one.ok && one.proposal.action).toMatchObject({
      kind: 'dataset.clear_flag',
      flagId: 'a',
    })
  })

  it('shows the unit a column had before', async () => {
    const built = await buildDatasetsProposal(
      DATASET_UNIT_TOOL,
      {
        ...base,
        dataset: 'Plate 7',
        field: 'OD450',
        unit: 'OD',
        reason: 'The reader reports OD',
      },
      context(),
    )

    expect(built.ok && built.proposal.changes).toEqual([
      { label: 'OD450 unit', before: 'AU', after: 'OD' },
    ])
  })

  it('plans one row per key, without repeats', async () => {
    const built = await buildDatasetsProposal(
      DATASET_PLAN_TOOL,
      {
        ...base,
        dataset: 'Plate 7',
        rows: ['T0', 'T1', 'T0'],
        dueOn: '2026-12-01',
      },
      context(),
    )

    expect(built.ok && built.proposal.action).toEqual({
      kind: 'dataset.plan_rows',
      datasetId: DATASET.id,
      keys: ['T0', 'T1'],
      scheduledAt: '2026-12-01T12:00:00Z',
    })
  })

  it('closes an open intake problem found by file name', async () => {
    const built = await buildDatasetsProposal(
      INTAKE_RESOLVE_TOOL,
      { ...base, file: 'plate7.csv', resolution: 'dismissed' },
      context({
        intake_failures: [
          {
            id: 'p-1',
            file_name: 'plate7.csv',
            code: 'parse_failed',
            message: 'No header row',
          },
        ],
      }),
    )

    expect(built.ok && built.proposal.action).toEqual({
      kind: 'intake.resolve',
      failureId: 'p-1',
      resolution: 'dismissed',
    })
  })
})
