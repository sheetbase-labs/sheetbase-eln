import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import { ask } from '#/lib/assistant-rpc-cards.fixture'
import { runRpcAction } from '#/lib/assistant-rpc-cards'
import { createDataClient } from '#/lib/data-client'

import { SHEET_CARDS } from './cards'
import { SHEET_CARD_SPECS } from './cards.server'

const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'

const field = (fieldId: string, key: string, label: string) => ({
  fieldId,
  key,
  label,
  lifecycle: 'active',
})

const sheet = {
  id: 's1',
  name: 'Plate A',
  display_id: 'SHT-0001',
  revision: 3,
  lifecycle: 'active',
  project_id: null,
  notebook_record_id: null,
  source_definition_version_id: 'v1',
  state: {
    localFields: [field(F1, 'mass', 'Mass'), field(F2, 'volume', 'Volume')],
    localValues: {
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1': { [F1]: 4, [F2]: 2 },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2': { [F1]: 9, [F2]: 3 },
    },
  },
}

const record = {
  id: 'r1',
  identifier: 'EXP-0004',
  title: 'Growth curve',
  kind: 'experiment',
  project_id: 'p1',
  structure_version: 5,
}

const layout = {
  id: 'd1',
  key: 'assay',
  name: 'Assay layout',
  lifecycle: 'active',
  revision: 2,
}

const configuration = {
  formatVersion: 1,
  columns: [
    {
      id: F1,
      field: { fieldId: F1, key: 'sample', label: 'Sample' },
      source: { kind: 'declared' },
    },
  ],
  presentation: { columnOrder: [F1] },
}

const ask1 = (
  tool: string,
  input: Parameters<typeof ask>[2],
  tables: Parameters<typeof ask>[3],
) => ask(SHEET_CARD_SPECS, tool, input, tables)

describe('the sheet cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(SHEET_CARD_SPECS.map((card) => card.tool)).toEqual(
      SHEET_CARDS.map((card) => card.tool),
    )

    for (const card of SHEET_CARD_SPECS) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, card.tool).toContain(card.tool)
      expect(card.def().name).toBe(card.tool.replaceAll('.', '__'))
    }
  })

  it('makes a blank sheet with its columns, in the project it was named by ID', async () => {
    const result = await ask1(
      'sheetbase.sheet.create',
      {
        name: 'Plate B',
        project: 'PRJ-0008',
        columns: [{ label: 'Sample' }, { label: 'OD600', type: 'number' }],
      },
      {
        projects: [
          {
            id: 'p8',
            key: 'ASSAY',
            title: 'Assay development',
            display_id: 'PRJ-0008',
          },
        ],
      },
    )

    expect(result.action?.rpc).toBe('create_sheet_instance')
    expect(result.action?.args).toMatchObject({
      p_workspace_id: 'ws',
      p_name: 'Plate B',
      p_project_id: 'p8',
      p_source_definition_version_id: null,
    })
    expect(result.action?.args.p_state).toMatchObject({
      provenance: { createdFrom: 'ad_hoc' },
    })
  })

  it('starts a sheet from the newest published version of a layout', async () => {
    const result = await ask1(
      'sheetbase.sheet.create',
      { name: 'Plate C', layout: 'Assay layout' },
      {
        sheet_definitions: [layout],
        sheet_definition_versions: [
          { id: 'v2', version: 2, lifecycle: 'published', revision: 1 },
          { id: 'v1', version: 1, lifecycle: 'retired', revision: 1 },
        ],
      },
    )

    expect(result.action?.rpc).toBe('create_sheet_instance_from_definition')
    expect(result.action?.args).toMatchObject({
      p_source_definition_version_id: 'v2',
      p_parameter_inputs: [],
    })
  })

  it('adds columns and rows by heading, and takes a column out of use', async () => {
    const result = await ask1(
      'sheetbase.sheet.edit_data',
      {
        sheet: 'SHT-0001',
        addColumns: [{ label: 'Notes' }],
        retireColumns: ['Volume'],
        rows: [{ Mass: 5, Notes: 'clear' }],
      },
      { sheet_instances: [sheet] },
    )

    expect(result.action?.rpc).toBe('mutate_sheet_instance_local_state')
    const args = result.action?.args

    expect(args).toMatchObject({ p_instance_id: 's1', p_expected_revision: 3 })
    expect(args?.p_field_changes).toHaveLength(2)
    expect(args?.p_rows).toHaveLength(1)
    expect(args?.p_cells).toHaveLength(2)
  })

  it('refuses a column the sheet does not have', async () => {
    const result = await ask1(
      'sheetbase.sheet.edit_data',
      { sheet: 'Plate A', rows: [{ Nope: 1 }] },
      { sheet_instances: [sheet] },
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Nope')
  })

  it('adds a calculation from a formula over named columns', async () => {
    const result = await ask1(
      'sheetbase.sheet.calculate',
      { sheet: 'Plate A', label: 'Density', formula: '={Mass}/{Volume}' },
      { sheet_instances: [sheet] },
    )

    expect(result.action?.rpc).toBe('mutate_sheet_instance_calculations')

    expect(result.action?.args).toMatchObject({
      p_changes: [
        {
          operation: 'add',
          calculation: {
            label: 'Density',
            dependencies: [{}, {}],
            expression: { language: 'sheetbase-formula-v1' },
          },
        },
      ],
    })
  })

  it('comments on the cell where one row meets one column', async () => {
    const result = await ask1(
      'sheetbase.sheet.comment',
      {
        sheet: 'Plate A',
        body: 'Check this',
        column: 'Mass',
        row: { column: 'Mass', equals: 9 },
      },
      { sheet_instances: [sheet] },
    )

    expect(result.action?.rpc).toBe('create_sheet_comment')
    expect(result.action?.args).toMatchObject({
      p_target_kind: 'sheet_cell',
      p_body: 'Check this',
      p_target: {
        instanceId: 's1',
        rowKeys: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'],
        fieldIds: [F1],
      },
    })
  })

  it('moves a sheet to the newest published layout version', async () => {
    const result = await ask1(
      'sheetbase.sheet.upgrade_layout',
      { sheet: 'Plate A' },
      {
        sheet_instances: [sheet],
        sheet_definition_versions: (url) =>
          url.searchParams.get('id')
            ? [{ definition_id: 'd1', version: 1 }]
            : [{ id: 'v2', version: 2, lifecycle: 'published', revision: 1 }],
      },
    )

    expect(result.action?.rpc).toBe('apply_sheet_instance_definition_upgrade')
    expect(result.action?.args).toMatchObject({
      p_target_definition_version_id: 'v2',
      p_decisions: [],
    })
  })

  it('puts a sheet in a notebook found by its ID', async () => {
    const result = await ask1(
      'sheetbase.sheet.add_to_notebook',
      { sheet: 'Plate A', notebook: 'EXP-0004' },
      { sheet_instances: [sheet], records: [record] },
    )

    expect(result.action?.rpc).toBe('insert_sheet_instance_block')
    expect(result.action?.args).toMatchObject({
      p_record_id: 'r1',
      p_instance_id: 's1',
    })
  })

  it('copies a sheet block in a notebook', async () => {
    const result = await ask1(
      'sheetbase.sheet.duplicate_in_notebook',
      { notebook: 'EXP-0004' },
      {
        records: [record],
        blocks: [{ id: 'b1', type: 'sheet', version: 2, order: 1 }],
      },
    )

    expect(result.action?.rpc).toBe('duplicate_sheet_instance_block')
    expect(result.action?.args).toEqual({
      p_block_id: 'b1',
      p_expected_structure_version: 5,
    })
  })

  it('saves a sheet’s own columns as a layout draft', async () => {
    const result = await ask1(
      'sheetbase.sheet.save_as_layout',
      { sheet: 'Plate A', name: 'Density layout' },
      { sheet_instances: [sheet] },
    )

    expect(result.action?.rpc).toBe('extract_sheet_definition_draft')
    expect(result.action?.args).toMatchObject({
      p_key: 'density_layout',
      p_selection: {
        localFieldIds: [F1, F2],
        rowIdentity: { kind: 'local', columnIds: [F1] },
      },
    })
  })

  it('creates a layout with its first draft', async () => {
    const result = await ask1(
      'sheetbase.sheet_layout.create',
      {
        name: 'Growth layout',
        columns: [{ label: 'Time' }, { label: 'OD', type: 'number' }],
      },
      {},
    )

    expect(result.action?.rpc).toBe('create_sheet_definition')

    expect(result.action?.args).toMatchObject({
      p_key: 'growth_layout',
      p_workspace_id: 'ws',
      p_configuration: {
        columns: [{}, {}],
        rowIdentity: { kind: 'local' },
      },
    })
  })

  it('renames a layout', async () => {
    const result = await ask1(
      'sheetbase.sheet_layout.rename',
      { layout: 'assay', name: 'Assay v2' },
      { sheet_definitions: [layout] },
    )

    expect(result.action?.rpc).toBe('update_sheet_definition')
    expect(result.action?.args).toEqual({
      p_definition_id: 'd1',
      p_expected_revision: 2,
      p_patch: { name: 'Assay v2' },
    })
  })

  it('starts a new version with a column added, and edits a draft', async () => {
    const tables = {
      sheet_definitions: [layout],
      sheet_definition_versions: [
        {
          id: 'v1',
          version: 1,
          lifecycle: 'published',
          revision: 4,
          configuration,
        },
        {
          id: 'v2',
          version: 2,
          lifecycle: 'draft',
          revision: 1,
          configuration,
        },
      ],
    }

    const added = await ask1(
      'sheetbase.sheet_layout.add_version',
      { layout: 'Assay layout', addColumns: [{ label: 'Result' }] },
      tables,
    )

    expect(added.action?.rpc).toBe('create_sheet_definition_version')
    expect(added.action?.args).toMatchObject({
      p_definition_id: 'd1',
      p_expected_definition_revision: 2,
    })

    const edited = await ask1(
      'sheetbase.sheet_layout.edit_draft',
      { layout: 'Assay layout', removeColumns: ['Sample'] },
      tables,
    )

    expect(edited.action?.rpc).toBe('update_sheet_definition_draft')
    expect(edited.action?.args).toMatchObject({
      p_version_id: 'v2',
      p_expected_revision: 1,
    })
  })

  it('retires one version of a layout', async () => {
    const result = await ask1(
      'sheetbase.sheet_layout.retire_version',
      { layout: 'Assay layout', version: 1 },
      {
        sheet_definitions: [layout],
        sheet_definition_versions: [
          { id: 'v1', version: 1, lifecycle: 'published', revision: 4 },
        ],
      },
    )

    expect(result.action?.rpc).toBe('retire_sheet_definition_version')
    expect(result.action?.args).toEqual({
      p_version_id: 'v1',
      p_expected_revision: 4,
    })
  })

  it('runs only a call its card covers', async () => {
    const calls: string[] = []

    const client = createDataClient(async (input) => {
      calls.push(
        (input instanceof Request
          ? new URL(input.url)
          : new URL(input, 'http://x')
        ).pathname
          .split('/')
          .at(-1) ?? '',
      )

      return Response.json({ status: 'applied' })
    })

    const action = {
      kind: 'sheetbase.sheet.comment' as const,
      rpc: 'create_sheet_comment',
      args: {},
      openHref: '/sheets/s1',
    }

    await expect(runRpcAction(client, SHEET_CARDS, action)).resolves.toEqual({
      openHref: '/sheets/s1',
    })
    await expect(
      runRpcAction(client, SHEET_CARDS, { ...action, rpc: 'archive_dataset' }),
    ).rejects.toThrow('cannot run')
    expect(calls).toEqual(['create_sheet_comment'])
  })
})
