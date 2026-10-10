/**
 * SCI-001 unit tests for the scientific-record domain library. These cover the
 * pure application-boundary validation, vocabulary and projection helpers that
 * sit on top of the database contract. PostgreSQL remains authoritative; these
 * helpers improve errors and drive the UI.
 */
import { describe, expect, it } from 'vitest'

import { DataClientError } from './data-client'
import {
  DUPLICATE_SCIENTIFIC_LINK_MESSAGE,
  KIND_PREFIX,
  KIND_STATUS_VOCABULARY,
  allowedTargets,
  formatPropertyValue,
  identifierPattern,
  isAllowedTransition,
  isDuplicateLinkError,
  isPropertyLogicalType,
  isScientificRecordKind,
  linkTypeForKind,
  scientificRecordQueryKeys,
  summariseProperties,
  toFieldDefinition,
  validateProperties,
} from './scientific-records'
import type {
  PropertyLogicalType,
  RecordFieldDefinition,
  ScientificRecordKind,
} from './scientific-records'

function def(
  overrides: Partial<RecordFieldDefinition> & {
    fieldName: string
    logicalType: PropertyLogicalType
  },
): RecordFieldDefinition {
  return {
    id: `def-${overrides.fieldName}`,
    workspaceId: 'ws-1',
    kind: overrides.kind ?? 'sample',
    fieldName: overrides.fieldName,
    label: overrides.label ?? overrides.fieldName,
    description: null,
    displayOrder: overrides.displayOrder ?? 1,
    logicalType: overrides.logicalType,
    nullable: overrides.nullable ?? true,
    defaultValue: overrides.defaultValue ?? null,
    unit: overrides.unit ?? null,
    validation: overrides.validation ?? {},
    lifecycle: overrides.lifecycle ?? 'active',
  }
}

describe('scientific record kinds and identifiers', () => {
  it('recognises the three scientific kinds and rejects others', () => {
    expect(isScientificRecordKind('sample')).toBe(true)
    expect(isScientificRecordKind('material')).toBe(true)
    expect(isScientificRecordKind('protocol_template')).toBe(true)
    expect(isScientificRecordKind('experiment')).toBe(false)
    expect(isScientificRecordKind('report')).toBe(false)
  })

  it('maps each kind to its stable identifier prefix', () => {
    expect(KIND_PREFIX.sample).toBe('SMP')
    expect(KIND_PREFIX.material).toBe('RGT')
    expect(KIND_PREFIX.protocol_template).toBe('PRT')
  })

  it('matches the stable <PREFIX>-YYYY-NNNN identifier shape', () => {
    expect(identifierPattern('sample').test('SMP-2026-0001')).toBe(true)
    expect(identifierPattern('material').test('RGT-2026-0042')).toBe(true)
    expect(identifierPattern('protocol_template').test('PRT-2026-0007')).toBe(
      true,
    )
    // Wrong prefix, short sequence, lowercase, extra segments.
    expect(identifierPattern('sample').test('RGT-2026-0001')).toBe(false)
    expect(identifierPattern('sample').test('SMP-2026-001')).toBe(false)
    expect(identifierPattern('sample').test('smp-2026-0001')).toBe(false)
    expect(identifierPattern('sample').test('SMP-2026-0001-extra')).toBe(false)
  })
})

describe('logical type guard', () => {
  it('accepts the seven supported logical types', () => {
    for (const t of [
      'text',
      'integer',
      'decimal',
      'boolean',
      'date',
      'timestamp',
      'category',
    ] as const) {
      expect(isPropertyLogicalType(t)).toBe(true)
    }
  })

  it('rejects unsupported types so they cannot slip into field definitions', () => {
    expect(isPropertyLogicalType('float')).toBe(false)
    expect(isPropertyLogicalType('string')).toBe(false)
    expect(isPropertyLogicalType('')).toBe(false)
  })
})

describe('toFieldDefinition', () => {
  const wire = {
    id: 'w1',
    workspace_id: 'ws-1',
    kind: 'sample',
    field_name: 'mass',
    label: 'Mass',
    description: null,
    display_order: 2,
    logical_type: 'decimal',
    nullable: true,
    default_value: null,
    unit: { symbol: 'µg' },
    validation: {},
    lifecycle: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  it('maps the wire shape to the camelCase domain shape', () => {
    const mapped = toFieldDefinition(wire)
    expect(mapped).toMatchObject({
      id: 'w1',
      workspaceId: 'ws-1',
      kind: 'sample',
      fieldName: 'mass',
      label: 'Mass',
      displayOrder: 2,
      logicalType: 'decimal',
      unit: { symbol: 'µg' },
      lifecycle: 'active',
    })
  })

  it('coerces unknown lifecycle values to active (only retired is sticky)', () => {
    expect(toFieldDefinition({ ...wire, lifecycle: 'retired' }).lifecycle).toBe(
      'retired',
    )
    expect(
      toFieldDefinition({ ...wire, lifecycle: 'something-else' }).lifecycle,
    ).toBe('active')
  })

  it('throws on an unexpected kind or logical_type', () => {
    expect(() => toFieldDefinition({ ...wire, kind: 'assay' })).toThrowError(
      /kind/,
    )
    expect(() =>
      toFieldDefinition({ ...wire, logical_type: 'float' }),
    ).toThrowError(/logical_type/)
  })
})

describe('validateProperties', () => {
  const definitions: RecordFieldDefinition[] = [
    def({ fieldName: 'required_text', logicalType: 'text', nullable: false }),
    def({ fieldName: 'count', logicalType: 'integer' }),
    def({ fieldName: 'mass', logicalType: 'decimal' }),
    def({ fieldName: 'approved', logicalType: 'boolean' }),
    def({
      fieldName: 'state',
      logicalType: 'category',
      validation: { enum: ['fresh', 'old'] },
    }),
    def({ fieldName: 'made_on', logicalType: 'date' }),
    def({ fieldName: 'run_at', logicalType: 'timestamp' }),
  ]

  it('returns no errors for a complete, correctly typed payload', () => {
    expect(
      validateProperties(
        'sample',
        {
          required_text: 'tube',
          count: 2,
          mass: 1.5,
          approved: true,
          state: 'fresh',
          made_on: '2026-07-21',
          run_at: '2026-07-21T10:00:00Z',
        },
        definitions,
      ),
    ).toEqual([])
  })

  it('flags a missing non-nullable field', () => {
    const errors = validateProperties('sample', {}, definitions)
    expect(errors).toContainEqual({
      field: 'required_text',
      message: 'required_text is required.',
    })
  })

  it('allows a nullable field to be absent or null', () => {
    expect(
      validateProperties(
        'sample',
        { required_text: 'x', count: null },
        definitions,
      ),
    ).toEqual([])
  })

  it('rejects wrong-typed values for each logical type', () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ['count', '1', /whole number/],
      ['count', 1.5, /whole number/],
      ['mass', 'heavy', /number/],
      ['approved', 1, /true or false/],
      ['approved', 'yes', /true or false/],
      ['state', 5, /text/],
      ['made_on', '21 July', /date/],
      ['run_at', 'not-a-time', /timestamp/],
    ]
    for (const [field, value, pattern] of cases) {
      const errors = validateProperties(
        'sample',
        { required_text: 'x', [field]: value },
        definitions,
      )
      const hit = errors.find((e) => e.field === field)
      expect(
        hit,
        `expected ${field} to error for ${JSON.stringify(value)}`,
      ).toBeDefined()
      expect(hit?.message).toMatch(pattern)
    }
  })

  it('rejects a category value outside the enum when one is defined', () => {
    const errors = validateProperties(
      'sample',
      { required_text: 'x', state: 'unknown' },
      definitions,
    )
    expect(errors).toContainEqual({
      field: 'state',
      message: 'state must be one of: fresh, old.',
    })
  })

  it('only checks active definitions for the requested kind', () => {
    const mixed = [
      ...definitions,
      def({
        fieldName: 'legacy',
        logicalType: 'integer',
        lifecycle: 'retired',
      }),
      def({ fieldName: 'material_lot', logicalType: 'text', kind: 'material' }),
    ]
    // retired field is not validated; material field is not validated for sample.
    const errors = validateProperties(
      'sample',
      { required_text: 'x', legacy: 'preserved', material_lot: 9 },
      mixed,
    )
    expect(errors).toEqual([])
  })
})

describe('status vocabularies and transition rules', () => {
  it('exposes a distinct vocabulary per kind', () => {
    expect(KIND_STATUS_VOCABULARY.sample).toContain('frozen')
    expect(KIND_STATUS_VOCABULARY.material).toContain('low_stock')
    expect(KIND_STATUS_VOCABULARY.material).not.toContain('frozen')
    expect(KIND_STATUS_VOCABULARY.protocol_template).toEqual([
      'draft',
      'active',
      'under_review',
    ])
  })

  it('mirrors the RPC transition matrix', () => {
    const allowed: Array<[ScientificRecordKind, string, string]> = [
      ['sample', 'available', 'reserved'],
      ['sample', 'available', 'consumed'],
      ['sample', 'available', 'quarantined'],
      ['sample', 'reserved', 'available'],
      ['sample', 'reserved', 'consumed'],
      ['sample', 'quarantined', 'available'],
      ['material', 'available', 'expired'],
      ['protocol_template', 'draft', 'active'],
      ['protocol_template', 'under_review', 'draft'],
      ['protocol_template', 'active', 'draft'],
    ]
    for (const [kind, from, to] of allowed) {
      expect(isAllowedTransition(kind, from, to)).toBe(true)
    }
  })

  it('rejects disallowed transitions', () => {
    expect(isAllowedTransition('sample', 'consumed', 'available')).toBe(false)
    expect(isAllowedTransition('sample', 'available', 'frozen')).toBe(false)
    expect(isAllowedTransition('material', 'low_stock', 'available')).toBe(
      false,
    )
    expect(
      isAllowedTransition('protocol_template', 'active', 'under_review'),
    ).toBe(false)
  })

  it('lists only reachable targets from a given status', () => {
    expect(allowedTargets('sample', 'available')).toEqual([
      'reserved',
      'consumed',
      'quarantined',
    ])
    expect(allowedTargets('sample', 'consumed')).toEqual([])
    expect(allowedTargets('protocol_template', 'draft')).toEqual([
      'active',
      'under_review',
    ])
  })
})

describe('linkTypeForKind', () => {
  it('maps protocol_template to the protocol link type and keeps the others', () => {
    expect(linkTypeForKind('sample')).toBe('sample')
    expect(linkTypeForKind('material')).toBe('material')
    expect(linkTypeForKind('protocol_template')).toBe('protocol')
  })
})

describe('summariseProperties', () => {
  const definitions: RecordFieldDefinition[] = [
    def({
      fieldName: 'mass',
      logicalType: 'decimal',
      label: 'Mass',
      displayOrder: 2,
      unit: { symbol: 'µg' },
    }),
    def({
      fieldName: 'note',
      logicalType: 'text',
      label: 'Note',
      displayOrder: 1,
    }),
    def({
      fieldName: 'legacy',
      logicalType: 'integer',
      label: 'Legacy',
      displayOrder: 3,
      lifecycle: 'retired',
    }),
  ]

  it('orders known fields by display_order and carries label, type and unit', () => {
    const entries = summariseProperties(
      'sample',
      { mass: 1.5, note: 'cold' },
      definitions,
    )
    expect(entries.map((e) => e.fieldName)).toEqual(['note', 'mass'])
    const mass = entries.find((e) => e.fieldName === 'mass')!
    expect(mass.label).toBe('Mass')
    expect(mass.logicalType).toBe('decimal')
    expect(mass.unit).toEqual({ symbol: 'µg' })
    expect(mass.orphaned).toBe(false)
  })

  it('flags retired fields as orphaned but preserves their value', () => {
    const entries = summariseProperties(
      'sample',
      { note: 'cold', legacy: 7 },
      definitions,
    )
    const legacy = entries.find((e) => e.fieldName === 'legacy')!
    expect(legacy.orphaned).toBe(true)
    expect(legacy.value).toBe(7)
  })

  it('appends unknown keys (never-defined fields) as orphaned', () => {
    const entries = summariseProperties(
      'sample',
      { note: 'cold', mystery: 'x' },
      definitions,
    )
    const mystery = entries.find((e) => e.fieldName === 'mystery')!
    expect(mystery.orphaned).toBe(true)
    expect(mystery.label).toBe('mystery')
  })

  it('ignores definitions for other kinds', () => {
    const entries = summariseProperties(
      'material',
      { note: 'cold' },
      definitions,
    )
    expect(entries).toEqual([
      {
        fieldName: 'note',
        label: 'note',
        value: 'cold',
        logicalType: 'text',
        unit: null,
        orphaned: true,
      },
    ])
  })
})

describe('formatPropertyValue', () => {
  it('renders a dash for empty values', () => {
    expect(
      formatPropertyValue({
        fieldName: 'x',
        label: 'x',
        value: null,
        logicalType: 'text',
        unit: null,
        orphaned: false,
      }),
    ).toBe('—')
    expect(
      formatPropertyValue({
        fieldName: 'x',
        label: 'x',
        value: '',
        logicalType: 'text',
        unit: null,
        orphaned: false,
      }),
    ).toBe('—')
  })

  it('appends a unit symbol when present', () => {
    expect(
      formatPropertyValue({
        fieldName: 'mass',
        label: 'Mass',
        value: 1.5,
        logicalType: 'decimal',
        unit: { symbol: 'µg' },
        orphaned: false,
      }),
    ).toBe('1.5 µg')
  })

  it('renders booleans and integers as their string form', () => {
    expect(
      formatPropertyValue({
        fieldName: 'approved',
        label: 'Approved',
        value: true,
        logicalType: 'boolean',
        unit: null,
        orphaned: false,
      }),
    ).toBe('true')
    expect(
      formatPropertyValue({
        fieldName: 'count',
        label: 'Count',
        value: 3,
        logicalType: 'integer',
        unit: null,
        orphaned: false,
      }),
    ).toBe('3')
  })
})

describe('scientificRecordQueryKeys', () => {
  it('scopes keys by kind, query and id', () => {
    expect(scientificRecordQueryKeys.fieldDefinitions('sample')).toEqual([
      'sci-001',
      'field-definitions',
      'sample',
    ])
    expect(scientificRecordQueryKeys.search('material', 'lot')).toEqual([
      'sci-001',
      'search',
      'material',
      'lot',
    ])
    expect(scientificRecordQueryKeys.record('id-1')).toEqual([
      'sci-001',
      'record',
      'id-1',
    ])
  })
})

describe('duplicate scientific link errors', () => {
  it('recognises PostgREST unique violations and conflict envelopes', () => {
    expect(DUPLICATE_SCIENTIFIC_LINK_MESSAGE).toBe(
      'This record is already linked.',
    )
    expect(
      isDuplicateLinkError(new DataClientError('23505', 'duplicate key', 409)),
    ).toBe(true)
    expect(
      isDuplicateLinkError(new DataClientError('conflict', 'dup', 409)),
    ).toBe(true)
    expect(
      isDuplicateLinkError(
        new DataClientError('P0001', 'record link already exists', 400),
      ),
    ).toBe(true)
    expect(
      isDuplicateLinkError(
        new DataClientError('SB002', 'record link crosses workspaces', 422),
      ),
    ).toBe(false)
    expect(isDuplicateLinkError(new Error('boom'))).toBe(false)
    expect(isDuplicateLinkError(null)).toBe(false)
  })
})
