/**
 * R5-CONFIG-03 — the Model editor's draft algebra.
 *
 * Field ordering, validation, and the three-way reconciliation the
 * editor performs after the server refuses a stale save.
 */
import { describe, expect, it } from 'vitest'

import { DataClientError } from './data-client'
import {
  changedKeys,
  computeChanges,
  detectDraftConflict,
  fieldSnapshot,
  isApprovalLock,
  isStaleRevision,
  mergeDraftRows,
  moveField,
  orderedForSave,
  toDraftField,
  validateDraft,
} from './dataset-schema-draft'
import type { DraftField } from './dataset-schema-draft'
import type { CanonicalDatasetSchemaField } from './dataset-schema-definition-rpc'

function row(key: string, overrides: Partial<DraftField> = {}): DraftField {
  return {
    rowKey: `row-${key}`,
    fieldId: `field-${key}`,
    key,
    label: key,
    logicalType: 'text',
    nullable: true,
    displayOrder: 1,
    ...overrides,
  }
}

function published(
  key: string,
  overrides: Partial<CanonicalDatasetSchemaField> = {},
): CanonicalDatasetSchemaField {
  return {
    field_id: `f-${key}`,
    key,
    label: key,
    description: null,
    logical_type: 'text',
    nullable: true,
    cardinality: 'one',
    lifecycle: 'active',
    display_order: 1,
    ...overrides,
  }
}

describe('computeChanges', () => {
  it('detects added, changed and removed fields', () => {
    const changes = computeChanges(
      [
        { key: 'vials', label: 'Vials', logicalType: 'decimal' },
        { key: 'new_one', label: 'New one', logicalType: 'text' },
      ],
      [published('vials'), published('gone', { label: 'Gone' })],
    )
    expect(changes.byKey.get('vials')).toBe('Changed')
    expect(changes.byKey.get('new_one')).toBe('Added')
    expect(changes.removed.map((field) => field.key)).toEqual(['gone'])
    expect(changes.total).toBe(3)
  })

  it('reports no changes when the draft matches the published version', () => {
    const changes = computeChanges(
      [{ key: 'a', label: 'a', logicalType: 'text' }],
      [published('a')],
    )
    expect(changes.total).toBe(0)
  })
})

describe('field ordering', () => {
  it('swaps adjacent rows independently of category labels and preserves their complete metadata', () => {
    const category = {
      kind: 'embedded',
      label: 'Not a section',
      options: [
        { id: 'option-id', key: 'pass', label: 'Pass', lifecycle: 'active' },
      ],
    }
    const rows = [
      row('a', { logicalType: 'category', category }),
      row('b'),
      row('c', { logicalType: 'category', category }),
      row('d'),
    ]
    const moved = moveField(rows, 'row-c', 1)
    expect(moved.map((field) => field.key)).toEqual(['a', 'b', 'd', 'c'])
    expect(
      orderedForSave(moved).map((field) => [
        field.key,
        field.category,
        field.displayOrder,
      ]),
    ).toEqual([
      ['a', category, 1],
      ['b', null, 2],
      ['d', null, 3],
      ['c', category, 4],
    ])
    expect(moveField(moved, 'row-c', -1)).toEqual(rows)
    expect(moveField(rows, 'row-a', -1)).toEqual(rows)
    expect(moveField(rows, 'row-d', 1)).toEqual(rows)
    expect(moveField(rows, 'missing', 1)).toEqual(rows)
    expect(rows.map((field) => field.key)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('validateDraft', () => {
  it('refuses duplicate keys, malformed keys, impossible ranges and missing names', () => {
    const issues = validateDraft([
      row('vials', { label: 'Vials' }),
      row('vials_at_freeze', { label: 'Vials at freeze', key: 'vials' }),
      row('bad key', { label: 'Bad' }),
      row('range', {
        label: 'Range',
        logicalType: 'decimal',
        validation: { min: 10, max: 1 },
      }),
      row('', { label: '' }),
    ])
    expect(issues.size).toBe(4)
  })

  it('accepts a clean draft', () => {
    expect(
      validateDraft([
        row('vials', { label: 'Vials' }),
        row('freeze', {
          label: 'Freeze',
          logicalType: 'decimal',
          validation: { min: 0, max: 10 },
          quantity: {
            kind: 'freeze',
            dimension: 'temperature',
            storageUnit: 'C',
          },
        }),
      ]).size,
    ).toBe(0)
  })

  it('requires a target for a link field', () => {
    const issues = validateDraft([
      row('sample', { label: 'Sample', logicalType: 'reference' }),
    ])
    expect(issues.get('row-sample')).toMatch(/link field needs a target/i)
  })
})

describe('orderedForSave', () => {
  it('round-trips complete persisted contracts, including false, zero and reference defaults', () => {
    const fields = [
      published('mass', {
        logical_type: 'decimal',
        default_value: 0,
        quantity: {
          kind: 'mass',
          dimension: 'mass',
          storageUnit: 'mg',
          allowedInputUnits: ['mg', 'g'],
        },
        validation: { min: 0, max: 15 },
      }),
      published('passed', { logical_type: 'boolean', default_value: false }),
      published('sample', {
        logical_type: 'reference',
        default_value: 'record-id',
        relationship: {
          target: { kind: 'model', modelKey: 'sample' },
          cardinality: 'one',
        },
      }),
      published('results', {
        logical_type: 'category',
        cardinality: 'many',
        category: {
          kind: 'embedded',
          options: [
            {
              id: 'option-id',
              key: 'pass',
              label: 'Pass',
              lifecycle: 'active',
            },
          ],
        },
      }),
    ]
    const saved = orderedForSave(fields.map(toDraftField))
    expect(saved.map((field) => field.defaultValue)).toEqual([
      0,
      false,
      'record-id',
      null,
    ])
    expect(saved[2].relationship).toEqual(fields[2].relationship)
    expect(saved[3].category).toEqual(fields[3].category)
    expect(computeChanges(saved, fields).total).toBe(0)
    expect(
      computeChanges(
        saved.map((field) =>
          field.key === 'mass'
            ? {
                ...field,
                quantity: { kind: 'mass', dimension: 'mass', storageUnit: 'g' },
              }
            : field,
        ),
        fields,
      ).byKey.get('mass'),
    ).toBe('Changed')
    expect(
      computeChanges(
        saved.map((field) =>
          field.key === 'results'
            ? { ...field, category: { kind: 'embedded', options: [] } }
            : field,
        ),
        fields,
      ).byKey.get('results'),
    ).toBe('Changed')
    expect(
      validateDraft([
        row('values', { cardinality: 'many', defaultValue: 0 }),
      ]).get('row-values'),
    ).toMatch(/cannot have a default/)
  })

  it('derives display_order from list position and keeps the field contract', () => {
    const wire = orderedForSave([
      row('b', { category: 'Growth', nullable: false }),
      row('a', {
        category: 'Identity',
        logicalType: 'decimal',
        validation: { min: 0 },
        quantity: { kind: 'v', dimension: 'ratio', storageUnit: '%' },
      }),
    ])
    expect(wire.map((field) => field.displayOrder)).toEqual([1, 2])
    expect(wire.map((field) => field.key)).toEqual(['b', 'a'])
    expect(wire[1]?.validation).toEqual({ min: 0 })
    expect(wire[1]?.quantity).toEqual({
      kind: 'v',
      dimension: 'ratio',
      storageUnit: '%',
    })
    expect(wire[0]?.nullable).toBe(false)
  })
})

describe('conflict detection and merging', () => {
  const baseRows = [
    row('a', { category: 'Identity' }),
    row('b', { category: 'Growth' }),
    row('c', { category: 'Growth' }),
  ]
  const base = fieldSnapshot(baseRows)

  it('ignores a pure reorder but reports a changed contract', () => {
    const reordered = [baseRows[2], baseRows[0], baseRows[1]]
    expect(changedKeys(base, fieldSnapshot(reordered)).size).toBe(0)
    const relabelled = baseRows.map((field) =>
      field.key === 'b' ? { ...field, label: 'Biomass' } : field,
    )
    expect([...changedKeys(base, fieldSnapshot(relabelled))]).toEqual(['row-b'])
  })

  it('classifies a disjoint conflict and keeps both sides when merging', () => {
    const mine = baseRows.map((field) =>
      field.key === 'c' ? { ...field, nullable: false } : field,
    )
    const serverRows = baseRows.map((field) =>
      field.key === 'a' ? { ...field, label: 'Sample identity' } : field,
    )
    const conflict = detectDraftConflict({
      base,
      mine,
      serverRows,
      serverRevision: 9,
    })
    expect(conflict.overlap).toBe(false)
    expect([...conflict.theirs]).toEqual(['row-a'])
    expect([...conflict.mine]).toEqual(['row-c'])
    expect(conflict.serverRevision).toBe(9)
    const merged = mergeDraftRows({
      base,
      mine,
      theirs: conflict.theirs,
      serverRows,
    })
    expect(
      merged.map((field) => [field.key, field.label, field.nullable]),
    ).toEqual([
      ['a', 'Sample identity', true],
      ['b', 'b', true],
      ['c', 'c', false],
    ])
  })

  it('merges their addition, keeps their order and honours my removal', () => {
    const mine = baseRows.filter((field) => field.key !== 'b')
    const serverRows = [
      ...baseRows.map((field) =>
        field.key === 'c' ? { ...field, label: 'Culture' } : field,
      ),
      row('d', { category: 'Identity', label: 'Added elsewhere' }),
    ]
    const theirs = changedKeys(base, fieldSnapshot(serverRows))
    const merged = mergeDraftRows({ base, mine, theirs, serverRows })
    expect(merged.map((field) => field.key)).toEqual(['a', 'c', 'd'])
    expect(merged.find((field) => field.key === 'c')?.label).toBe('Culture')
  })

  it('classifies an overlapping conflict', () => {
    const mine = baseRows.map((field) =>
      field.key === 'a' ? { ...field, label: 'Mine' } : field,
    )
    const serverRows = baseRows.map((field) =>
      field.key === 'a' ? { ...field, label: 'Theirs' } : field,
    )
    const conflict = detectDraftConflict({
      base,
      mine,
      serverRows,
      serverRevision: 4,
    })
    expect(conflict.overlap).toBe(true)
    expect([...conflict.mine]).toEqual(['row-a'])
  })
})

describe('refusal classification', () => {
  it('recognises the stale-revision and approval-lock refusals', () => {
    expect(isStaleRevision(new DataClientError('SB001', 'stale', 409))).toBe(
      true,
    )
    expect(isApprovalLock(new DataClientError('SB085', 'locked', 409))).toBe(
      true,
    )
    expect(isStaleRevision(new DataClientError('SB085', 'locked', 409))).toBe(
      false,
    )
    expect(
      isStaleRevision(
        new Error('stale Dataset Schema Version revision (SB001)'),
      ),
    ).toBe(true)
    expect(
      isApprovalLock(new Error('draft is locked while approval is pending')),
    ).toBe(true)
    expect(isStaleRevision(new Error('network down'))).toBe(false)
  })
})
