import { describe, expect, it } from 'vitest'

import {
  datasetFieldDefinitionFromWire,
  datasetSchemaDefinitionFromWire,
} from './dataset-schema-data'
import type {
  DatasetSchemaFieldWire,
  DatasetSchemaRelationshipWire,
  DatasetSchemaWire,
} from './dataset-schema-data'

const schema: DatasetSchemaWire = {
  id: 'schema-1',
  workspace_id: 'workspace-1',
  slug: 'assay_result',
  name: 'Assay result',
  description: null,
  revision: 2,
  status: 'published',
  created_by_user_id: 'user-1',
  created_at: '2026-08-13T00:00:00.000Z',
  updated_at: '2026-08-13T00:00:00.000Z',
}

function field(
  overrides: Partial<DatasetSchemaFieldWire> = {},
): DatasetSchemaFieldWire {
  return {
    id: 'field-1',
    schema_id: schema.id,
    workspace_id: schema.workspace_id,
    slug: 'sample_name',
    label: 'Sample name',
    description: null,
    display_order: 1,
    logical_type: 'text',
    nullable: false,
    default_value: null,
    unit: null,
    validation: { minLength: 1 },
    lifecycle: 'active',
    created_at: schema.created_at,
    updated_at: schema.updated_at,
    ...overrides,
  }
}

function referenceEdge(sourceFieldId: string): DatasetSchemaRelationshipWire {
  return {
    id: 'relationship-1',
    workspace_id: schema.workspace_id,
    source_schema_id: schema.id,
    target_schema_id: 'schema-sample',
    relationship_type: 'references',
    label: '',
    cardinality: 'one_to_many',
    source_field_id: sourceFieldId,
    target_field_id: null,
    lifecycle: 'active',
    created_by_user_id: 'user-1',
    created_at: schema.created_at,
    updated_at: schema.updated_at,
  }
}

describe('Dataset Schema canonical field projection', () => {
  it('projects a text field and preserves its stable row-shape key', () => {
    const definition = datasetFieldDefinitionFromWire(field(), [])

    expect(definition).toMatchObject({
      fieldId: 'field-1',
      key: 'sample_name',
      logicalType: 'text',
      validation: { minLength: 1 },
      cardinality: 'one',
      lifecycle: 'active',
    })
  })

  it('keeps a legacy quantity unit semantically unspecified', () => {
    const definition = datasetFieldDefinitionFromWire(
      field({
        id: 'field-titre',
        slug: 'titre',
        label: 'Titre',
        logical_type: 'decimal',
        unit: { symbol: 'TU/mL' },
        validation: { min: 0 },
      }),
      [],
    )

    expect(definition.quantity).toEqual({
      kind: 'legacy-unspecified',
      dimension: 'legacy-unspecified',
      storageUnit: 'TU/mL',
    })
  })

  it('maps categories to the embedded source without blocking vocabulary support', () => {
    const definition = datasetFieldDefinitionFromWire(
      field({
        logical_type: 'category',
        slug: 'outcome',
        label: 'Outcome',
        validation: {},
      }),
      [],
    )

    expect(definition.category).toEqual({ kind: 'embedded', options: [] })
  })

  it('maps a reference field through its first-class relationship edge', () => {
    const reference = field({
      id: 'field-sample',
      logical_type: 'reference',
      slug: 'sample',
      label: 'Sample',
      validation: {},
    })
    const definition = datasetFieldDefinitionFromWire(reference, [
      referenceEdge(reference.id),
    ])

    expect(definition.relationship).toEqual({
      target: { kind: 'dataset-schema', schemaId: 'schema-sample' },
      cardinality: 'one',
    })
  })

  it('rejects an unresolved reference instead of inferring a target', () => {
    expect(() =>
      datasetFieldDefinitionFromWire(
        field({ logical_type: 'reference', validation: {} }),
        [],
      ),
    ).toThrow('Reference fields require an explicit relationship target.')
  })

  it('defines a versioned Dataset row shape from active field identities', () => {
    const retired = field({
      id: 'field-retired',
      slug: 'historic_reading',
      lifecycle: 'retired',
    })
    const definition = datasetSchemaDefinitionFromWire(
      schema,
      [field(), retired],
      [],
    )

    expect(definition).toMatchObject({
      schemaId: schema.id,
      schemaKey: 'assay_result',
      revision: 2,
      lifecycle: 'active',
      rowShape: {
        kind: 'dataset-row',
        fieldsByKey: { sample_name: 'field-1' },
      },
    })
    expect(definition.fields).toHaveLength(2)
  })
})
