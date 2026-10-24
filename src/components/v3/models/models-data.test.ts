import { describe, expect, it } from 'vitest'

import {
  buildModelRows,
  buildRecordModelCustomFields,
  filterRecordModelRecords,
  laterAddedModelFields,
  modelFieldInputErrors,
  modelStatus,
  recordFieldValue,
  recordModelCsv,
  recordModelNextIdentifier,
  recordStatusOptions,
} from './models-data'
import type { RecordModelRecord } from './models-data'
import type {
  CanonicalDatasetSchemaDefinition,
  CanonicalDatasetSchemaVersion,
} from '#/lib/dataset-schema-definition-rpc'
import type { ModelFieldDefinition } from '#/lib/model-fields'

function definition(
  overrides: Partial<CanonicalDatasetSchemaDefinition> = {},
): CanonicalDatasetSchemaDefinition {
  return {
    id: 'def-1',
    key: 'osmolality',
    name: 'Osmolality reading',
    description: null,
    lifecycle: 'active',
    display_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    created_by_user_id: null,
    ...overrides,
  }
}

function version(
  overrides: Partial<CanonicalDatasetSchemaVersion> = {},
): CanonicalDatasetSchemaVersion {
  return {
    id: 'v-1',
    schema_id: 'def-1',
    version: 1,
    revision: 1,
    lifecycle: 'draft',
    published_at: null,
    ...overrides,
  }
}

describe('buildModelRows', () => {
  it('reports counts for the published version, not a newer draft', () => {
    const rows = buildModelRows(
      [definition()],
      [
        version({ id: 'v-1', version: 1, lifecycle: 'active' }),
        version({ id: 'v-2', version: 2, lifecycle: 'draft' }),
      ],
      [
        { schema_version_id: 'v-2' },
        { schema_version_id: 'v-2' },
        { schema_version_id: 'v-1' },
      ],
      [{ schema_version_id: 'v-2' }, { schema_version_id: 'v-2' }],
    )

    expect(rows).toHaveLength(1)
    // The latest version is chosen by version number, not input order, but the
    // board counts describe the in-service (published) version.
    expect(rows[0].latestVersion?.id).toBe('v-2')
    expect(rows[0].publishedVersion?.id).toBe('v-1')
    expect(rows[0].versions.map((v) => v.version)).toEqual([2, 1])
    expect(rows[0].fieldCount).toBe(1)
    expect(rows[0].datasetCount).toBe(0)
  })

  it('falls back to the newest version when nothing is published', () => {
    const rows = buildModelRows(
      [definition()],
      [version({ id: 'v-1', version: 1, lifecycle: 'draft' })],
      [{ schema_version_id: 'v-1' }],
      [{ schema_version_id: 'v-1' }],
    )

    expect(rows[0].publishedVersion).toBeNull()
    expect(rows[0].fieldCount).toBe(1)
    expect(rows[0].datasetCount).toBe(1)
  })

  it('reports zero counts for a definition with no version', () => {
    const rows = buildModelRows([definition()], [], [], [])
    expect(rows[0].latestVersion).toBeNull()
    expect(rows[0].publishedVersion).toBeNull()
    expect(rows[0].fieldCount).toBe(0)
    expect(rows[0].datasetCount).toBe(0)
  })
})

describe('modelStatus', () => {
  it('maps lifecycle to tone and label', () => {
    expect(modelStatus('active')).toEqual({ tone: 'ok', label: 'Active' })
    expect(modelStatus('draft')).toEqual({ tone: 'draft', label: 'Draft' })
    expect(modelStatus('retired')).toEqual({
      tone: 'stored',
      label: 'Retired',
    })
  })

  it('falls back to a title-cased label for unknown lifecycles', () => {
    expect(modelStatus('under_review')).toEqual({
      tone: 'none',
      label: 'Under review',
    })
  })

  it('shows a published workspace model as active', () => {
    expect(modelStatus('published')).toEqual({ tone: 'ok', label: 'Published' })
  })
})

// ---------------------------------------------------------------------------
// MDL-04.1 — records list of a workspace-defined model.
// ---------------------------------------------------------------------------

function modelField(
  overrides: Partial<ModelFieldDefinition> = {},
): ModelFieldDefinition {
  return {
    id: 'f-1',
    modelKey: 'cell_bank',
    fieldName: 'passage',
    label: 'Passage',
    description: null,
    displayOrder: 1,
    logicalType: 'integer',
    nullable: true,
    defaultValue: null,
    unit: null,
    validation: {},
    lifecycle: 'active',
    options: [],
    ...overrides,
  }
}

function record(overrides: Partial<RecordModelRecord> = {}): RecordModelRecord {
  return {
    id: 'r-1',
    identifier: 'CB-0001',
    title: 'Bank one',
    kind: 'cell_bank',
    status: 'Released',
    custom_fields: {},
    properties: {},
    tags: [],
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    archived_at: null,
    ...overrides,
  }
}

const cellLine = modelField({
  id: 'f-line',
  fieldName: 'cell_line',
  label: 'Cell line',
  logicalType: 'category',
  options: [
    {
      id: 'o-1',
      key: 'hek293',
      label: 'HEK293',
      displayOrder: 1,
      lifecycle: 'active',
    },
  ],
})

describe('recordFieldValue', () => {
  it('prefers custom_fields and falls back to the legacy properties object', () => {
    const row = record({
      custom_fields: { passage: 12 },
      properties: { passage: 4, cell_line: 'hek293' },
    })
    expect(recordFieldValue(row, 'passage')).toBe(12)
    expect(recordFieldValue(row, 'cell_line')).toBe('hek293')
    expect(recordFieldValue(row, 'missing')).toBeUndefined()
  })
})

describe('filterRecordModelRecords', () => {
  const records = [
    record({
      id: 'r-1',
      identifier: 'CB-0001',
      title: 'HEK293 MCB',
      status: 'Released',
      custom_fields: { cell_line: 'hek293', passage: 8 },
    }),
    record({
      id: 'r-2',
      identifier: 'CB-0002',
      title: 'CHO-K1 working bank',
      status: 'Quarantine',
      custom_fields: { cell_line: 'cho_k1', passage: 6 },
    }),
  ]
  const fields = [modelField(), cellLine]

  it('filters by status', () => {
    const visible = filterRecordModelRecords(records, fields, {
      status: 'Quarantine',
    })
    expect(visible.map((r) => r.id)).toEqual(['r-2'])
  })

  it('filters by a displayed field value (category label, not key)', () => {
    const visible = filterRecordModelRecords(records, fields, {
      fieldName: 'cell_line',
      fieldValue: 'HEK293',
    })
    expect(visible.map((r) => r.id)).toEqual(['r-1'])
  })

  it('searches identifier, title, status and field values together', () => {
    expect(
      filterRecordModelRecords(records, fields, { q: 'cb-0002' }).map(
        (r) => r.id,
      ),
    ).toEqual(['r-2'])
    expect(
      filterRecordModelRecords(records, fields, { q: 'quarantine' }).map(
        (r) => r.id,
      ),
    ).toEqual(['r-2'])
    // "HEK293" appears only in the category option label for r-1.
    expect(
      filterRecordModelRecords(records, fields, { q: 'hek293' }).map(
        (r) => r.id,
      ),
    ).toEqual(['r-1'])
  })

  it('applies search, status and field filters together', () => {
    const visible = filterRecordModelRecords(records, fields, {
      q: 'mcb',
      status: 'Released',
      fieldName: 'passage',
      fieldValue: '8',
    })
    expect(visible.map((r) => r.id)).toEqual(['r-1'])
    expect(
      filterRecordModelRecords(records, fields, {
        q: 'mcb',
        status: 'Released',
        fieldName: 'passage',
        fieldValue: '6',
      }),
    ).toEqual([])
  })
})

describe('recordStatusOptions', () => {
  it('lists the distinct statuses, sorted', () => {
    expect(
      recordStatusOptions([
        record({ status: 'Released' }),
        record({ status: 'Quarantine' }),
        record({ status: 'Released' }),
      ]),
    ).toEqual(['Quarantine', 'Released'])
  })
})

describe('recordModelCsv', () => {
  const fields = [modelField(), cellLine]

  it('exports ID, Name, Status then the model fields in order', () => {
    const csv = recordModelCsv(
      [
        record({
          identifier: 'CB-0001',
          title: 'Bank, one',
          status: 'Released',
          custom_fields: { passage: 12, cell_line: 'hek293' },
        }),
      ],
      fields,
    )
    const [header, row] = csv.split('\n')
    expect(header).toBe('ID,Name,Status,Passage,Cell line')
    // The comma in the title is quoted; the category shows its label.
    expect(row).toBe('CB-0001,"Bank, one",Released,12,HEK293')
  })

  it('writes an empty cell for a value that is not recorded', () => {
    const csv = recordModelCsv([record()], fields)
    const [, row] = csv.split('\n')
    expect(row).toBe('CB-0001,Bank one,Released,,')
  })
})

describe('recordModelNextIdentifier', () => {
  it('continues after the highest visible identifier', () => {
    expect(
      recordModelNextIdentifier('CB', [
        { identifier: 'CB-0012' },
        { identifier: 'CB-0006' },
      ]),
    ).toBe('CB-0013')
  })

  it('starts at 0001 when the model has no records', () => {
    expect(recordModelNextIdentifier('CB', [])).toBe('CB-0001')
  })
})

describe('modelFieldInputErrors', () => {
  const requiredInteger = modelField({
    fieldName: 'passage',
    logicalType: 'integer',
    nullable: false,
  })

  it('reports a required field with no value', () => {
    expect(modelFieldInputErrors([requiredInteger], {})).toHaveProperty(
      'passage',
    )
  })

  it('accepts a valid value', () => {
    expect(modelFieldInputErrors([requiredInteger], { passage: '12' })).toEqual(
      {},
    )
  })

  it('reports a value of the wrong type', () => {
    expect(
      modelFieldInputErrors([requiredInteger], { passage: 'twelve' }),
    ).toHaveProperty('passage')
  })
})

describe('buildRecordModelCustomFields', () => {
  it('coerces values and omits blank optional fields', () => {
    const optionalText = modelField({
      fieldName: 'location',
      logicalType: 'text',
      nullable: true,
    })
    expect(
      buildRecordModelCustomFields([modelField(), optionalText], {
        passage: '12',
        location: '',
      }),
    ).toEqual({ passage: 12 })
  })
})

describe('laterAddedModelFields', () => {
  const base = modelField({
    fieldName: 'passage',
    createdAt: '2026-01-01T00:00:00Z',
  })
  const added = modelField({
    fieldName: 'mycoplasma',
    logicalType: 'category',
    createdAt: '2026-09-19T00:00:00Z',
  })

  it('returns fields created after the record that it does not carry', () => {
    const row = record({
      created_at: '2026-08-01T00:00:00Z',
      custom_fields: { passage: 12 },
    })
    expect(
      laterAddedModelFields([base, added], row).map((f) => f.fieldName),
    ).toEqual(['mycoplasma'])
  })

  it('ignores a later field once the record has a value for it', () => {
    const row = record({
      created_at: '2026-08-01T00:00:00Z',
      custom_fields: { passage: 12, mycoplasma: 'negative' },
    })
    expect(laterAddedModelFields([base, added], row)).toEqual([])
  })
})
