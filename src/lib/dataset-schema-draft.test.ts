/**
 * R5-CONFIG-03 — the Model editor's draft algebra.
 *
 * Sections and ordering, validation, and the three-way reconciliation the
 * editor performs after the server refuses a stale save.
 */
import { describe, expect, it } from 'vitest'

import { DataClientError } from './data-client'
import {
  changedKeys,
  computeChanges,
  detectDraftConflict,
  fieldSnapshot,
  groupBySection,
  isApprovalLock,
  isStaleRevision,
  mergeDraftRows,
  moveFieldWithinSection,
  moveSection,
  orderedForSave,
  sectionNames,
  setFieldSection,
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

describe('sections', () => {
  const rows = [
    row('a', { category: 'Identity' }),
    row('b', { category: 'Growth' }),
    row('c'),
    row('d', { category: 'Growth' }),
  ]

  it('groups by first appearance and treats a missing category as the default section', () => {
    expect(sectionNames(rows)).toEqual(['Identity', 'Growth', 'Fields'])
    expect(groupBySection(rows).map((group) => group.fields.length)).toEqual([
      1, 2, 1,
    ])
  })

  it('moves a whole section and keeps the order inside each group', () => {
    const moved = moveSection(rows, 'Growth', -1)
    expect(moved.map((field) => field.key)).toEqual(['b', 'd', 'a', 'c'])
    expect(moveSection(rows, 'Identity', -1).map((f) => f.key)).toEqual(
      rows.map((f) => f.key),
    )
    expect(moveSection(rows, 'Fields', 1).map((f) => f.key)).toEqual(
      rows.map((f) => f.key),
    )
  })

  it('re-sections a field to the end of its new section, or creates the section', () => {
    const existing = setFieldSection(rows, 'row-a', 'Growth')
    expect(existing.map((field) => field.key)).toEqual(['b', 'c', 'd', 'a'])
    const created = setFieldSection(rows, 'row-a', 'Outcome')
    expect(created.map((field) => field.key)).toEqual(['b', 'c', 'd', 'a'])
    expect(sectionNames(created)).toContain('Outcome')
  })

  it('moves a field within its section only', () => {
    const moved = moveFieldWithinSection(rows, 'row-d', -1)
    expect(moved.map((field) => field.key)).toEqual(['a', 'd', 'b', 'c'])
    expect(moveFieldWithinSection(rows, 'row-a', -1).map((f) => f.key)).toEqual(
      rows.map((f) => f.key),
    )
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
