import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import type { FieldDefinition } from './field-definition'
import {
  mutateSheetLocalState,
  createAdHocTextField,
  sheetLocalValueError,
} from './sheet-local-data'
import { validSheetInstanceState } from './sheet-instance.test'

const field = (
  logicalType: FieldDefinition['logicalType'],
  overrides: Partial<FieldDefinition> = {},
): FieldDefinition => ({
  fieldId: '19000000-0000-4000-8000-000000000001',
  key: 'local_value',
  label: 'Local value',
  description: null,
  logicalType,
  nullable: false,
  defaultValue: null,
  cardinality: 'one',
  quantity: null,
  validation: {},
  category: null,
  relationship: null,
  computation: { mode: 'stored' },
  lifecycle: 'active',
  ...overrides,
})

describe('canonical Sheet local values', () => {
  it('builds unique ad-hoc text fields from a column label', () => {
    const first = createAdHocTextField('Yield %', ['yield'])
    expect(first.key).toBe('yield_2')
    expect(first.logicalType).toBe('text')
    expect(first.nullable).toBe(true)
    expect(first.lifecycle).toBe('active')
  })

  it('sends the bounded authoritative row-address contract to the local mutation RPC', async () => {
    const instanceId = crypto.randomUUID()
    const retryToken = crypto.randomUUID()
    const rpc = vi.fn().mockResolvedValue({
      id: instanceId,
      workspace_id: crypto.randomUUID(),
      project_id: null,
      notebook_record_id: null,
      source_definition_version_id: null,
      name: 'Local values',
      description: null,
      lifecycle: 'active',
      revision: 2,
      state: validSheetInstanceState(),
      duplicated_from_instance_id: null,
      created_at: '2026-08-15T10:00:00Z',
      updated_at: '2026-08-15T10:00:00Z',
      created_by_user_id: 'user',
      updated_by_user_id: 'user',
    })
    await mutateSheetLocalState(
      {
        instanceId,
        expectedRevision: 1,
        retryToken,
        rows: [
          {
            kind: 'local',
            rowKey: '19000000-0000-4000-8000-000000000005',
          },
        ],
        cells: [
          {
            rowKey: '19000000-0000-4000-8000-000000000005',
            fieldId: '19000000-0000-4000-8000-000000000001',
            value: 'observation',
          },
        ],
      },
      { rpc } as unknown as DataClient,
    )
    expect(rpc).toHaveBeenCalledWith('mutate_sheet_instance_local_state', {
      p_instance_id: instanceId,
      p_expected_revision: 1,
      p_retry_token: retryToken,
      p_field_changes: [],
      p_rows: [
        {
          kind: 'local',
          rowKey: '19000000-0000-4000-8000-000000000005',
        },
      ],
      p_cells: [
        {
          rowKey: '19000000-0000-4000-8000-000000000005',
          fieldId: '19000000-0000-4000-8000-000000000001',
          value: 'observation',
        },
      ],
    })
  })

  it.each([
    ['text', 'observation'],
    ['integer', 42],
    ['decimal', 4.2],
    ['boolean', true],
    ['date', '2026-02-28'],
    ['timestamp', '2026-08-15T10:20:30Z'],
    ['reference', '19000000-0000-4000-8000-000000000002'],
  ] as const)('accepts canonical %s scalars', (type, value) => {
    expect(sheetLocalValueError(field(type), value)).toBeNull()
  })

  it('validates every many item while preserving array semantics', () => {
    const many = field('integer', { cardinality: 'many' })
    expect(sheetLocalValueError(many, [3, 1, 2])).toBeNull()
    expect(sheetLocalValueError(many, [3, '1', 2])).toBe('invalid_value')
    expect(sheetLocalValueError(many, [])).toBe('invalid_cardinality')
  })

  it('enforces strict calendar, timestamp, range, null/default and active category rules', () => {
    expect(sheetLocalValueError(field('date'), '2025-02-29')).toBe(
      'invalid_value',
    )
    expect(
      sheetLocalValueError(field('timestamp'), '2026-01-01 00:00:00'),
    ).toBe('invalid_value')
    expect(
      sheetLocalValueError(field('integer', { validation: { min: 2 } }), 1),
    ).toBe('numeric_validation')
    expect(sheetLocalValueError(field('text'), null)).toBe('required_value')
    expect(
      sheetLocalValueError(field('text', { defaultValue: 'default' }), null),
    ).toBeNull()
    const option = '19000000-0000-4000-8000-000000000003'
    expect(
      sheetLocalValueError(
        field('category', {
          category: {
            kind: 'embedded',
            options: [
              {
                id: option,
                key: 'active',
                label: 'Active',
                displayOrder: 0,
                lifecycle: 'active',
              },
            ],
          },
        }),
        option,
      ),
    ).toBeNull()
    expect(
      sheetLocalValueError(
        field('category', {
          category: { kind: 'embedded', options: [] },
        }),
        option,
      ),
    ).toBe('invalid_category_option')
  })
})
