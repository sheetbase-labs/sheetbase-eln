import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { ChatAttachment } from '#/lib/assistant-attachments'
import { ask } from '#/lib/assistant-rpc-cards.fixture'

import { DATASET_CARDS } from './cards'
import { DATASET_CARD_SPECS as BASE_SPECS } from './cards.server'
import { importFileCard } from './import-file.server'
import type { readStoredSheet } from './stored-file.server'

const readStored: typeof readStoredSheet = async (file, sheet) =>
  file.filename === 'broken.csv'
    ? { ok: false, message: 'broken.csv could not be read: damaged.' }
    : {
        ok: true,
        headings: ['Sample', 'OD600', 'Notes'],
        rowCount: 40,
        sheetName: sheet ?? 'Sheet 1',
      }

const DATASET_CARD_SPECS = [...BASE_SPECS, importFileCard(readStored)]

const F1 = '11111111-1111-4111-8111-111111111111'

const dataset = {
  id: 'ds1',
  name: 'Plate reads',
  display_id: 'DS-0311',
  revision: 7,
  schema_version_id: 'sv1',
  lifecycle: 'active',
}

const fields = [
  {
    field_id: F1,
    key: 'sample',
    label: 'Sample',
    lifecycle: 'active',
    logical_type: 'text',
  },
  {
    field_id: '22222222-2222-4222-8222-222222222222',
    key: 'od600',
    label: 'OD600',
    lifecycle: 'active',
    logical_type: 'decimal',
  },
]

const sheet = {
  id: 's1',
  name: 'Plate A',
  display_id: 'SHT-0001',
  revision: 3,
  lifecycle: 'active',
  state: {
    localFields: [
      { fieldId: F1, key: 'mass', label: 'Mass', lifecycle: 'active' },
    ],
    instanceCalculations: [
      { id: 'c1', key: 'density', label: 'Density', lifecycle: 'active' },
    ],
  },
}

const table = {
  id: 't1',
  key: 'plate_reads',
  name: 'Plate reads table',
  display_id: null,
  lifecycle: 'active',
}

const ask1 = (
  tool: string,
  input: Parameters<typeof ask>[2],
  tables: Parameters<typeof ask>[3],
) => ask(DATASET_CARD_SPECS, tool, input, tables)

describe('the dataset cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(DATASET_CARD_SPECS.map((card) => card.tool)).toEqual(
      DATASET_CARDS.map((card) => card.tool),
    )

    for (const card of DATASET_CARD_SPECS) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, card.tool).toContain(card.tool)
    }
  })

  it('adds rows to a dataset found by its ID, keyed by column ID', async () => {
    const result = await ask1(
      'sheetbase.dataset.add_rows',
      {
        dataset: 'DS-0311',
        rows: [{ Sample: 'S-1', OD600: 0.42 }, { sample: 'S-2' }],
      },
      { datasets: [dataset], dataset_schema_version_fields: fields },
    )

    expect(result.action?.rpc).toBe('commit_dataset_row_batch')

    expect(result.action?.args).toMatchObject({
      p_dataset_id: 'ds1',
      p_expected_dataset_revision: 7,
      p_rows: [
        { operation: 'create', values: { [F1]: 'S-1' } },
        { operation: 'create' },
      ],
    })
  })

  it('uses the atomic call for a very large batch, and names a missing column', async () => {
    const many = await ask1(
      'sheetbase.dataset.add_rows',
      {
        dataset: 'DS-0311',
        rows: Array.from({ length: 1_200 }, () => ({ Sample: 'x' })),
      },
      { datasets: [dataset], dataset_schema_version_fields: fields },
    )

    expect(many.action?.rpc).toBe('commit_dataset_row_batch_atomic')

    const missing = await ask1(
      'sheetbase.dataset.add_rows',
      { dataset: 'DS-0311', rows: [{ Nope: 1 }] },
      { datasets: [dataset], dataset_schema_version_fields: fields },
    )

    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('Sample, OD600')
  })

  it('makes a dataset structure from a list of columns', async () => {
    const result = await ask1(
      'sheetbase.dataset.create_from_columns',
      {
        name: 'Growth reads',
        columns: [
          { label: 'Time point' },
          { label: 'OD 600', type: 'decimal' },
        ],
      },
      {},
    )

    expect(result.action?.rpc).toBe('create_dataset_structure_from_file')
    expect(result.action?.args).toMatchObject({
      p_workspace_id: 'ws',
      p_fields: [
        { key: 'time_point', label: 'Time point', logical_type: 'text' },
        { key: 'od_600', label: 'OD 600', logical_type: 'decimal' },
      ],
    })
  })

  it('adds columns to a dataset, keeping its old ones', async () => {
    const result = await ask1(
      'sheetbase.dataset.add_columns',
      { dataset: 'Plate reads', columns: [{ label: 'Operator' }] },
      { datasets: [dataset], dataset_schema_version_fields: fields },
    )

    expect(result.action?.rpc).toBe('apply_dataset_schema_evolution')

    expect(result.action?.args).toMatchObject({
      p_schema_version_id: 'sv1',
      p_fields: [
        { label: 'Sample' },
        { label: 'OD600' },
        { label: 'Operator' },
      ],
    })

    const clash = await ask1(
      'sheetbase.dataset.add_columns',
      { dataset: 'Plate reads', columns: [{ label: 'sample' }] },
      { datasets: [dataset], dataset_schema_version_fields: fields },
    )

    expect(clash.ok).toBe(false)
  })

  it('moves a measurement table under another, or to the top', async () => {
    const under = await ask1(
      'sheetbase.measurement_table.move_under',
      { table: 'plate_reads', under: 'Parent table' },
      {
        dataset_schema_definitions: (url) =>
          url.search.includes('plate_reads')
            ? [table]
            : [{ ...table, id: 't0', name: 'Parent table', key: 'parent' }],
      },
    )

    expect(under.action?.rpc).toBe('reparent_dataset_schema')
    expect(under.action?.args).toEqual({
      p_definition_id: 't1',
      p_parent_id: 't0',
    })

    const top = await ask1(
      'sheetbase.measurement_table.move_under',
      { table: 'plate_reads' },
      { dataset_schema_definitions: [table] },
    )

    expect(top.action?.args).toEqual({
      p_definition_id: 't1',
      p_parent_id: null,
    })
  })

  it('asks to promote a sheet column into a measurement table', async () => {
    const result = await ask1(
      'sheetbase.dataset.promote_column',
      {
        sheet: 'SHT-0001',
        column: 'Mass',
        table: 'plate_reads',
        reason: 'Every plate has it',
      },
      { sheet_instances: [sheet], dataset_schema_definitions: [table] },
    )

    expect(result.action?.rpc).toBe('request_column_promotion')
    expect(result.action?.args).toMatchObject({
      p_instance_id: 's1',
      p_field_id: F1,
      p_target: 'dataset_schema',
      p_schema_definition_id: 't1',
      p_reason: 'Every plate has it',
    })
  })

  it('needs one home for a promoted column', async () => {
    const result = await ask1(
      'sheetbase.dataset.promote_column',
      { sheet: 'SHT-0001', column: 'Mass', reason: 'x' },
      { sheet_instances: [sheet] },
    )

    expect(result.ok).toBe(false)
  })

  it('settles a decided promotion', async () => {
    const result = await ask1(
      'sheetbase.dataset.apply_promotion',
      { sheet: 'SHT-0001' },
      {
        sheet_instances: [sheet],
        column_promotions: [
          {
            id: 'cp1',
            field_id: F1,
            state: 'approved',
            target: 'dataset_schema',
          },
        ],
      },
    )

    expect(result.action?.rpc).toBe('apply_column_promotion')
    expect(result.action?.args).toMatchObject({ p_promotion_id: 'cp1' })

    const none = await ask1(
      'sheetbase.dataset.apply_promotion',
      { sheet: 'SHT-0001' },
      { sheet_instances: [sheet] },
    )

    expect(none.ok).toBe(false)
  })

  it('promotes a calculation into the sheet layout or a measurement table', async () => {
    const layout = await ask1(
      'sheetbase.dataset.promote_calculation',
      { sheet: 'SHT-0001', calculation: 'Density', target: 'sheet_layout' },
      { sheet_instances: [sheet] },
    )

    expect(layout.action?.rpc).toBe('promote_calculation')
    expect(layout.action?.args).toMatchObject({
      p_calculation_id: 'c1',
      p_target: 'sheet_definition',
      p_schema_definition_id: null,
    })

    const into = await ask1(
      'sheetbase.dataset.promote_calculation',
      {
        sheet: 'SHT-0001',
        calculation: 'Density',
        target: 'measurement_table',
        table: 'plate_reads',
      },
      { sheet_instances: [sheet], dataset_schema_definitions: [table] },
    )

    expect(into.action?.args).toMatchObject({
      p_target: 'dataset_schema',
      p_schema_definition_id: 't1',
    })
  })

  describe('importing a file', () => {
    const chat = (extra: Partial<ChatAttachment> = {}): ChatAttachment => ({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'reads.csv',
      mediaType: 'text/csv',
      bytes: 100,
      kind: 'table' as const,
      sheets: [
        {
          name: 'Sheet 1',
          rows: [
            ['Sample', 'OD600', 'Notes'],
            ['S-1', '0.42', 'ok'],
            ['S-2', '0.51', ''],
            ['', '', ''],
          ],
        },
      ],
      text: '',
      truncated: false,
      ...extra,
    })

    const tables = {
      datasets: [dataset],
      dataset_schema_version_fields: fields,
    }

    it('adds the rows of a file dropped into the chat, matched by heading', async () => {
      const result = await ask(
        DATASET_CARD_SPECS,
        'sheetbase.dataset.import_file',
        { dataset: 'DS-0311', file: 'reads.csv' },
        tables,
        [chat()],
      )

      expect(result.action?.rpc).toBe('commit_dataset_row_batch')

      expect(result.action?.args).toMatchObject({
        p_dataset_id: 'ds1',
        p_expected_dataset_revision: 7,
        p_rows: [
          {
            operation: 'create',
            reason: 'Imported from reads.csv',
            values: {
              [F1]: 'S-1',
              '22222222-2222-4222-8222-222222222222': '0.42',
            },
          },
          { operation: 'create' },
        ],
      })

      expect(result.action?.args.p_rows).toHaveLength(2)

      expect(result.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Rows added', after: '2' }),
          expect.objectContaining({ label: 'Left out', after: 'Notes' }),
        ]),
      )
    })

    it('will not import part of a file, or a file with no matching column', async () => {
      const partial = await ask(
        DATASET_CARD_SPECS,
        'sheetbase.dataset.import_file',
        { dataset: 'DS-0311', file: 'reads.csv' },
        tables,
        [chat({ truncated: true })],
      )

      expect(partial.ok).toBe(false)
      expect(partial.message).toContain('Import screen')

      const none = await ask(
        DATASET_CARD_SPECS,
        'sheetbase.dataset.import_file',
        { dataset: 'DS-0311', file: 'reads.csv' },
        tables,
        [
          chat({
            sheets: [{ name: 'Sheet 1', rows: [['Colour'], ['red']] }],
          }),
        ],
      )

      expect(none.ok).toBe(false)
      expect(none.message).toContain('None of the columns')
    })

    it('imports a file kept in the workspace through the app’s import', async () => {
      const result = await ask(
        DATASET_CARD_SPECS,
        'sheetbase.dataset.import_file',
        { dataset: 'DS-0311', file: 'plate.csv', sheet: 'Data' },
        {
          ...tables,
          dataset_import_files: [
            { id: 'f1', filename: 'plate.csv', workspace_id: 'ws' },
          ],
        },
      )

      expect(result.action?.rpc).toBe('commit_dataset_import')

      expect(result.action?.args).toMatchObject({
        fileId: 'f1',
        datasetId: 'ds1',
        sheetName: 'Data',
        mapping: {
          sheetName: 'Data',
          sources: [
            { source: 'Sample', fieldId: F1 },
            { source: 'OD600' },
            { source: 'Notes', fieldId: null },
          ],
        },
      })
    })

    it('says so when the file is not in the chat or the workspace, or cannot be read', async () => {
      const missing = await ask(
        DATASET_CARD_SPECS,
        'sheetbase.dataset.import_file',
        { dataset: 'DS-0311', file: 'nothing.csv' },
        tables,
      )

      expect(missing.ok).toBe(false)

      const broken = await ask(
        DATASET_CARD_SPECS,
        'sheetbase.dataset.import_file',
        { dataset: 'DS-0311', file: 'broken.csv' },
        {
          ...tables,
          dataset_import_files: [{ id: 'f2', filename: 'broken.csv' }],
        },
      )

      expect(broken.message).toContain('could not be read')
    })
  })
})
