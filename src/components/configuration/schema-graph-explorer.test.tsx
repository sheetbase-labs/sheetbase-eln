import { describe, expect, it } from 'vitest'

import { buildSchemaGraphData } from './schema-graph-explorer'
import type { ModelFieldDefinition, ModelKind } from '#/lib/model-fields'
import type {
  DatasetSchemaFieldWire,
  DatasetSchemaRelationshipWire,
  DatasetSchemaWire,
} from '#/lib/dataset-schema-data'

function modelField(
  overrides: Partial<ModelFieldDefinition>,
): ModelFieldDefinition {
  return {
    id: 'f1',
    modelKey: 'sample',
    fieldName: 'field',
    label: 'Field',
    description: null,
    displayOrder: 1,
    logicalType: 'text',
    nullable: true,
    defaultValue: null,
    unit: null,
    validation: {},
    lifecycle: 'active',
    options: [],
    ...overrides,
  }
}

const kinds: ModelKind[] = [
  { key: 'sample', label: 'Sample', identityTable: 'samples' },
  { key: 'reagent_lot', label: 'Reagent lot', identityTable: 'reagent_lots' },
]

const schemas: DatasetSchemaWire[] = [
  {
    id: 'sch-1',
    workspace_id: 'w1',
    slug: 'stability_reading',
    name: 'Stability reading',
    description: null,
    revision: 1,
    status: 'published',
    created_by_user_id: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
]

describe('buildSchemaGraphData', () => {
  it('builds nodes with an implicit pk row and typed field labels', () => {
    const data = buildSchemaGraphData({
      kinds,
      modelFields: [
        [
          modelField({ fieldName: 'title' }),
          modelField({ fieldName: 'status', logicalType: 'category' }),
          modelField({ fieldName: 'quantity', logicalType: 'decimal' }),
        ],
        [modelField({ fieldName: 'expiry', logicalType: 'date' })],
      ],
      modelCounts: [128, 47],
      schemas: [],
      schemaFields: [],
      schemaRelationships: [],
      datasetCounts: [],
    })

    expect(data.nodes).toHaveLength(2)
    const sample = data.nodes[0]
    expect(sample.fields.map((f) => [f.name, f.typeLabel])).toEqual([
      ['id', 'pk'],
      ['title', 'text'],
      ['status', 'enum'],
      ['quantity', 'number'],
    ])
    expect(sample.rowCount).toBe(128)
    expect(data.nodes[1].fields.map((f) => f.typeLabel)).toEqual(['pk', 'date'])
    expect(data.edges).toHaveLength(0)
  })

  it('turns reference fields into labelled fk edges', () => {
    const data = buildSchemaGraphData({
      kinds,
      modelFields: [
        [
          modelField({
            fieldName: 'reagent_lot_id',
            logicalType: 'reference',
            relationship: {
              target: { kind: 'model', modelKey: 'reagent_lot' },
              cardinality: 'one',
            },
          }),
        ],
        [],
      ],
      modelCounts: [null, null],
      schemas: [],
      schemaFields: [],
      schemaRelationships: [],
      datasetCounts: [],
    })

    expect(data.edges).toEqual([
      {
        id: 'm:sample.reagent_lot_id->model:reagent_lot',
        source: 'model:sample',
        target: 'model:reagent_lot',
        label: 'reagent_lot_id',
      },
    ])
    const fk = data.nodes[0].fields.find((f) => f.name === 'reagent_lot_id')
    expect(fk).toMatchObject({ typeLabel: 'fk', isFk: true })
  })

  it('joins dataset schemas via relationships and schema-targeted references', () => {
    const schemaFields: DatasetSchemaFieldWire[][] = [
      [
        {
          id: 'sf-1',
          schema_id: 'sch-1',
          workspace_id: 'w1',
          slug: 'experiment_id',
          label: 'Experiment',
          description: null,
          display_order: 1,
          logical_type: 'reference',
          nullable: false,
          default_value: null,
          unit: null,
          validation: {},
          lifecycle: 'active',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
    ]
    const rels: DatasetSchemaRelationshipWire[] = [
      {
        id: 'rel-1',
        workspace_id: 'w1',
        source_schema_id: 'sch-1',
        target_schema_id: 'sch-1',
        relationship_type: 'references',
        label: '',
        cardinality: 'one_to_many',
        source_field_id: 'sf-1',
        target_field_id: null,
        lifecycle: 'active',
        created_by_user_id: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ]
    const data = buildSchemaGraphData({
      kinds: [kinds[0]],
      modelFields: [
        [
          modelField({
            fieldName: 'reading_schema',
            logicalType: 'reference',
            relationship: {
              target: { kind: 'dataset-schema', schemaId: 'sch-1' },
              cardinality: 'one',
            },
          }),
        ],
      ],
      modelCounts: [10],
      schemas,
      schemaFields,
      schemaRelationships: rels,
      datasetCounts: [8],
    })

    expect(data.nodes).toHaveLength(2)
    expect(data.edges).toContainEqual({
      id: 'm:sample.reading_schema->schema:sch-1',
      source: 'model:sample',
      target: 'schema:sch-1',
      label: 'reading_schema',
    })
    expect(data.edges).toContainEqual({
      id: 's:rel-1',
      source: 'schema:sch-1',
      target: 'schema:sch-1',
      label: 'experiment_id',
    })
    const schemaNode = data.nodes[1]
    expect(schemaNode.rowCount).toBe(8)
    expect(
      schemaNode.fields.find((f) => f.name === 'experiment_id'),
    ).toMatchObject({ typeLabel: 'fk', isFk: true })
  })
})
