/**
 * MODEL-02 field-semantics parity contract.
 *
 * One semantics behaves identically across Record input
 * (`parseModelFieldInput`/`validateModelFieldValue`), Sheet cells
 * (`parseSheetCellInput`/`validateCanonicalCell`) and server validation
 * (`internal.validate_model_fields`). Client feedback mirrors the server;
 * there is no second rules engine — both client paths funnel through the
 * shared `field-value-validation` kernel. Server parity is asserted
 * against the migration sources of truth (no DB round-trip needed):
 * the same rule families must exist in `drizzle/0057` (values) and
 * `drizzle/0060` (stored semantics).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  fieldDefinitionFromModelField,
  validateFieldDefinition,
} from './field-definition'
import type {
  FieldDefinition,
  FieldQuantityDefinition,
} from './field-definition'
import {
  displayModelFieldValue,
  modelFieldValidationForServer,
  parseModelFieldInput,
  validateModelFieldValue,
} from './model-fields'
import type { ModelFieldDefinition } from './model-fields'
import {
  parsePersistedRecordReference,
  RecordReferenceCellError,
  resolveRecordReferenceState,
} from './record-reference-cell'
import {
  parseSheetCellInput,
  validateCanonicalCell,
} from './canonical-sheet-grid'

const ACTIVE_OPTION_ID = '40000000-0000-4000-8000-000000000001'
const RETIRED_OPTION_ID = '40000000-0000-4000-8000-000000000003'
const RECORD_UUID = '11111111-1111-4111-8111-111111111111'

function sheetField(
  logicalType: FieldDefinition['logicalType'],
  overrides: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    fieldId: 'field-1',
    key: 'probe',
    label: 'Probe',
    description: null,
    logicalType,
    nullable: true,
    defaultValue: null,
    cardinality: 'one',
    quantity: null,
    validation: {},
    category: null,
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
    ...overrides,
  }
}

function recordField(
  logicalType: ModelFieldDefinition['logicalType'],
  overrides: Partial<ModelFieldDefinition> = {},
): ModelFieldDefinition {
  return {
    id: 'field-1',
    modelKey: 'sample',
    fieldName: 'probe',
    label: 'Probe',
    description: null,
    displayOrder: 1,
    logicalType,
    nullable: true,
    defaultValue: null,
    unit: null,
    quantity: null,
    validation: {},
    cardinality: 'one',
    categorySource: null,
    relationship: null,
    lifecycle: 'active',
    options: [],
    ...overrides,
  }
}

function readMigration(name: string): string {
  return readFileSync(join(process.cwd(), 'drizzle', name), 'utf8')
}

describe('field semantics parity', () => {
  it('parses quantity-unit input and displays the governed unit on both paths', () => {
    const quantity: FieldQuantityDefinition = {
      kind: 'concentration',
      dimension: 'mass/volume',
      storageUnit: 'mg/mL',
      allowedInputUnits: ['mg/mL', 'µg/mL'],
      preferredDisplayUnit: 'mg/mL',
    }
    const sheet = sheetField('decimal', {
      quantity,
      validation: { min: 0, max: 10 },
    })
    const record = recordField('decimal', { quantity, validation: {} })

    // Same coercion: unit suffixes strip to the canonical number.
    expect(parseSheetCellInput(sheet, '2.5 mg/mL')).toBe(2.5)
    expect(parseModelFieldInput(record, '2.5 mg/mL')).toBe(2.5)
    expect(parseSheetCellInput(sheet, '1,200.5')).toBe(1200.5)
    expect(parseModelFieldInput(record, '1,200.5')).toBe(1200.5)

    // Same validation once coerced; range failures share one code.
    expect(validateCanonicalCell(sheet, 2.5)).toBeNull()
    expect(validateModelFieldValue(record, 2.5)).toBeNull()
    expect(validateCanonicalCell(sheet, 12)).toBe('numeric_validation')
    expect(
      validateModelFieldValue(
        recordField('decimal', { quantity, validation: { min: 0, max: 10 } }),
        12,
      ),
    ).toBe('numeric_validation')

    // Record read path honors the governed display unit.
    expect(displayModelFieldValue(record, 2.5)).toBe('2.5 mg/mL')

    // Kernel accepts the quantity contract; the server stores it (0060)
    // and enforces the numeric range (0057).
    expect(validateFieldDefinition(sheet)).toEqual([])
    expect(
      readMigration('0060_core_013_model_field_definition_kernel.sql'),
    ).toContain('storageUnit')
    expect(readMigration('0057_model_fields_foundation.sql')).toContain(
      'numeric validation failed',
    )
  })

  it('enforces category membership identically with honest retired states', () => {
    const category = {
      kind: 'embedded' as const,
      options: [
        {
          id: ACTIVE_OPTION_ID,
          key: 'oncology',
          label: 'Oncology',
          displayOrder: 0,
          lifecycle: 'active' as const,
        },
        {
          id: RETIRED_OPTION_ID,
          key: 'cardio',
          label: 'Cardio',
          displayOrder: 1,
          lifecycle: 'retired' as const,
        },
      ],
    }
    const sheet = sheetField('category', { category })
    const record = recordField('category', {
      options: category.options,
    })

    // Human labels normalise to the canonical option id on the Sheet path.
    expect(parseSheetCellInput(sheet, 'Oncology')).toBe(ACTIVE_OPTION_ID)
    expect(validateCanonicalCell(sheet, ACTIVE_OPTION_ID)).toBeNull()
    expect(validateModelFieldValue(record, ACTIVE_OPTION_ID)).toBeNull()

    // Retired selections and unknown values fail closed on both paths.
    expect(parseSheetCellInput(sheet, 'Cardio')).toBe('Cardio')
    expect(validateCanonicalCell(sheet, 'Cardio')).toBe('invalid_value')
    expect(validateCanonicalCell(sheet, RETIRED_OPTION_ID)).toBe(
      'invalid_category_option',
    )
    expect(validateModelFieldValue(record, RETIRED_OPTION_ID)).toBe(
      'invalid_category_option',
    )
    expect(validateCanonicalCell(sheet, 'Nope')).toBe('invalid_value')
    expect(validateModelFieldValue(record, 'Nope')).toBe('invalid_value')

    // Kernel requires a category source; the server rejects dead options.
    expect(
      validateFieldDefinition(sheetField('category', { category: null })),
    ).not.toEqual([])
    expect(validateFieldDefinition(sheet)).toEqual([])
    expect(readMigration('0057_model_fields_foundation.sql')).toContain(
      'inactive category option',
    )
  })

  it('resolves references to stable UUIDs with honest missing states', () => {
    const sheet = sheetField('reference', {
      nullable: false,
      relationship: {
        target: { kind: 'model', modelKey: 'sample' },
        cardinality: 'one',
      },
    })
    const record = recordField('reference', {
      nullable: false,
      validation: { targetModelKey: 'sample' },
      relationship: {
        target: { kind: 'model', modelKey: 'sample' },
        cardinality: 'one',
      },
    })

    // Shape parity: UUIDs pass, generated Record IDs never resolve.
    expect(validateCanonicalCell(sheet, RECORD_UUID)).toBeNull()
    expect(validateModelFieldValue(record, RECORD_UUID)).toBeNull()
    expect(
      parsePersistedRecordReference(RECORD_UUID, { nullable: false }),
    ).toBe(RECORD_UUID)
    expect(validateCanonicalCell(sheet, 'SMP-2026-0001')).toBe('invalid_value')
    expect(validateModelFieldValue(record, 'SMP-2026-0001')).toBe(
      'invalid_value',
    )
    let code: string | null = null
    try {
      parsePersistedRecordReference('SMP-2026-0001', { nullable: false })
    } catch (caught) {
      code =
        caught instanceof RecordReferenceCellError ? caught.code : 'unknown'
    }
    expect(code).toBe('label-identity')

    // Resolution states stay honest: present, archived, wrong-model, gone.
    const snapshot = {
      recordId: RECORD_UUID,
      modelKey: 'sample',
      kind: 'sample',
      identifier: 'SMP-2026-0042',
      title: 'Liver section',
      archived: false,
      deleted: false,
    }
    expect(
      resolveRecordReferenceState({
        persistedId: RECORD_UUID,
        snapshot,
        targetModelKey: 'sample',
      }),
    ).toMatchObject({ kind: 'present' })
    expect(
      resolveRecordReferenceState({
        persistedId: RECORD_UUID,
        snapshot: { ...snapshot, archived: true },
        targetModelKey: 'sample',
      }),
    ).toMatchObject({ kind: 'archived' })
    expect(
      resolveRecordReferenceState({
        persistedId: RECORD_UUID,
        snapshot: { ...snapshot, modelKey: 'reagent' },
        targetModelKey: 'sample',
      }),
    ).toMatchObject({ kind: 'invalid-model' })
    expect(
      resolveRecordReferenceState({
        persistedId: RECORD_UUID,
        snapshot: null,
        targetModelKey: 'sample',
      }),
    ).toMatchObject({ kind: 'missing' })

    // Kernel requires an explicit relationship; the server resolves it.
    expect(
      validateFieldDefinition(sheetField('reference', { relationship: null })),
    ).not.toEqual([])
    expect(readMigration('0057_model_fields_foundation.sql')).toContain(
      'invalid reference',
    )
  })

  it('enforces identifier patterns and text bounds on both paths', () => {
    const validation = {
      minLength: 8,
      maxLength: 13,
      pattern: '^SMP-[0-9]{4}-[0-9]{4}$',
    }
    const sheet = sheetField('text', { validation })
    const record = recordField('text', { validation })

    expect(validateCanonicalCell(sheet, 'SMP-2026-0042')).toBeNull()
    expect(validateModelFieldValue(record, 'SMP-2026-0042')).toBeNull()
    for (const bad of ['SMP-1', 'nope', 'SMP-2026-00422']) {
      expect(validateCanonicalCell(sheet, bad)).toBe('text_validation')
      expect(validateModelFieldValue(record, bad)).toBe('text_validation')
    }

    // The kernel name `pattern` persists as the server `regex` key.
    expect(validateFieldDefinition(sheet)).toEqual([])
    expect(modelFieldValidationForServer({ pattern: '^SMP-', min: 1 })).toEqual(
      { min: 1, regex: '^SMP-' },
    )
    expect(
      fieldDefinitionFromModelField({
        id: 'field-1',
        fieldName: 'identifier',
        label: 'Identifier',
        description: null,
        logicalType: 'text',
        nullable: false,
        defaultValue: null,
        unit: null,
        validation: { regex: '^SMP-', minLength: 8 },
        lifecycle: 'active',
        options: [],
      }).validation.pattern,
    ).toBe('^SMP-')
    const server = readMigration('0057_model_fields_foundation.sql')
    expect(server).toContain('text validation failed')
    expect(server).toContain(`'regex'`)
  })

  it('requires non-nullable values until the server fills a default', () => {
    const sheet = sheetField('text', { nullable: false })
    const record = recordField('text', { nullable: false })
    expect(validateCanonicalCell(sheet, null)).toBe('required_value')
    expect(validateModelFieldValue(record, null)).toBe('required_value')
    expect(
      validateCanonicalCell(
        sheetField('text', { nullable: false, defaultValue: 'x' }),
        null,
      ),
    ).toBeNull()
    expect(readMigration('0057_model_fields_foundation.sql')).toContain(
      'required field',
    )
  })
})
