import { describe, expect, it } from 'vitest'

import {
  boundValueInspectorSchema,
  projectBoundColumns,
} from './sheet-bound-columns'
import type { ComposedSheetRow } from './sheet-composition-data'
import type { SheetDefinitionConfiguration } from './sheet-definition'

const ids = {
  version: '10000000-0000-4000-8000-000000000001',
  rootBinding: '10000000-0000-4000-8000-000000000002',
  joinedBinding: '10000000-0000-4000-8000-000000000003',
  recordBinding: '10000000-0000-4000-8000-000000000013',
  datasetColumn: '10000000-0000-4000-8000-000000000004',
  modelColumn: '10000000-0000-4000-8000-000000000005',
  relationshipColumn: '10000000-0000-4000-8000-000000000006',
  datasetField: '10000000-0000-4000-8000-000000000007',
  modelField: '10000000-0000-4000-8000-000000000008',
  relationshipField: '10000000-0000-4000-8000-000000000009',
  rootDataset: '10000000-0000-4000-8000-000000000010',
  joinedDataset: '10000000-0000-4000-8000-000000000011',
  rootRow: '10000000-0000-4000-8000-000000000012',
  record: '10000000-0000-4000-8000-000000000014',
}

const field = (
  fieldId: string,
  key: string,
  logicalType: 'text' | 'reference',
) => ({
  fieldId,
  key,
  label: `${key} label`,
  description: null,
  logicalType,
  nullable: true,
  defaultValue: null,
  cardinality: 'one' as const,
  quantity: null,
  validation: {},
  category: null,
  relationship:
    logicalType === 'reference'
      ? {
          target: { kind: 'model' as const, modelKey: 'sample' },
          cardinality: 'one' as const,
        }
      : null,
  computation: { mode: 'stored' as const },
  lifecycle: 'active' as const,
})

const configuration = {
  bindings: [
    { id: ids.rootBinding },
    { id: ids.joinedBinding },
    { id: ids.recordBinding },
  ],
  columns: [
    {
      id: ids.datasetColumn,
      field: field(ids.datasetColumn, 'dataset_value', 'text'),
      source: {
        kind: 'bound' as const,
        bindingId: ids.rootBinding,
        sourceFieldId: ids.datasetField,
      },
    },
    {
      id: ids.modelColumn,
      field: field(ids.modelColumn, 'model_value', 'text'),
      source: {
        kind: 'bound' as const,
        bindingId: ids.recordBinding,
        sourceFieldId: ids.modelField,
      },
    },
    {
      id: ids.relationshipColumn,
      field: field(ids.relationshipColumn, 'sample', 'reference'),
      source: {
        kind: 'bound' as const,
        bindingId: ids.joinedBinding,
        sourceFieldId: ids.relationshipField,
      },
    },
  ],
  writeBackRules: [],
} as unknown as SheetDefinitionConfiguration

const row: ComposedSheetRow = {
  rowKey: 'sb-row-v1:test',
  identityValues: [],
  sources: [
    {
      sourceKind: 'dataset',
      bindingId: ids.rootBinding,
      datasetId: ids.rootDataset,
      datasetRevision: 8,
      rowId: ids.rootRow,
      revision: 7,
      matched: true,
      values: { [ids.datasetField]: null, [ids.modelField]: 'model-value' },
    },
    {
      sourceKind: 'dataset',
      bindingId: ids.joinedBinding,
      datasetId: ids.joinedDataset,
      datasetRevision: 8,
      rowId: null,
      revision: null,
      matched: false,
      values: {},
    },
    {
      sourceKind: 'record',
      bindingId: ids.recordBinding,
      recordId: ids.record,
      metadataVersion: 3,
      fieldNames: { [ids.modelField]: 'model_value' },
      matched: true,
      values: { [ids.modelField]: 'model-value' },
    },
  ],
}

describe('projectBoundColumns', () => {
  it('keeps Dataset, Model, and relationship provenance while distinguishing null from unmatched', () => {
    const projection = projectBoundColumns({
      definitionVersionId: ids.version,
      configuration,
      rows: [row],
    })

    expect(
      projection.columns.map(({ id, presentation, permission }) => [
        id,
        presentation.kind,
        permission.editability,
      ]),
    ).toEqual([
      [ids.datasetColumn, 'text', 'read-only'],
      [ids.modelColumn, 'text', 'read-only'],
      [ids.relationshipColumn, 'record-picker', 'read-only'],
    ])
    expect(projection.rows[0].values[ids.datasetColumn]).toMatchObject({
      kind: 'present',
      value: null,
      provenance: {
        sourceKind: 'dataset',
        definitionVersionId: ids.version,
        sourceDatasetId: ids.rootDataset,
        sourceRowId: ids.rootRow,
        sourceRevision: 7,
        sourceFieldId: ids.datasetField,
      },
    })
    expect(projection.rows[0].values[ids.relationshipColumn]).toMatchObject({
      kind: 'unmatched',
      provenance: {
        sourceKind: 'dataset',
        bindingId: ids.joinedBinding,
        sourceDatasetId: ids.joinedDataset,
        sourceRowId: null,
        sourceFieldId: ids.relationshipField,
      },
    })
    expect(projection.rows[0].values[ids.modelColumn]).toMatchObject({
      kind: 'present',
      value: 'model-value',
      provenance: { sourceKind: 'record', sourceRecordId: ids.record },
    })
    expect(
      'sourceRecordId' in
        projection.rows[0].values[ids.datasetColumn].provenance,
    ).toBe(false)
    expect(
      boundValueInspectorSchema.safeParse({
        kind: 'present',
        value: null,
        provenance: {
          sourceKind: 'dataset',
          definitionVersionId: ids.version,
          definitionColumnId: ids.datasetColumn,
          bindingId: ids.rootBinding,
          sourceDatasetId: 'not-a-uuid',
          sourceRowId: ids.rootRow,
          sourceRevision: 7,
          sourceFieldId: ids.datasetField,
        },
      }).success,
    ).toBe(false)
  })

  it('uses stable IDs rather than labels or order across rename and reorder', () => {
    const renamed = {
      ...configuration,
      columns: [...configuration.columns].reverse().map((column) => ({
        ...column,
        field: { ...column.field, label: `renamed ${column.id}` },
      })),
    } as SheetDefinitionConfiguration
    const projection = projectBoundColumns({
      definitionVersionId: ids.version,
      configuration: renamed,
      rows: [row],
    })

    expect(projection.rows[0].rowKey).toBe(row.rowKey)
    expect(projection.rows[0].values[ids.modelColumn]).toMatchObject({
      kind: 'present',
      value: 'model-value',
      provenance: {
        sourceKind: 'record',
        definitionColumnId: ids.modelColumn,
        sourceFieldId: ids.modelField,
      },
    })
  })

  it('marks only an exactly mapped bound column editable', () => {
    const projection = projectBoundColumns({
      definitionVersionId: ids.version,
      configuration: {
        ...configuration,
        writeBackRules: [
          {
            id: ids.version,
            bindingId: ids.rootBinding,
            mode: 'update',
            mappings: [
              {
                columnId: ids.datasetColumn,
                targetFieldId: ids.datasetField,
              },
            ],
          },
        ],
      },
      rows: [row],
    })

    expect(
      projection.columns.map(({ id, permission }) => [
        id,
        permission.editability,
      ]),
    ).toEqual([
      [ids.datasetColumn, 'editable'],
      [ids.modelColumn, 'read-only'],
      [ids.relationshipColumn, 'read-only'],
    ])
  })

  it('fails structurally for unknown bindings and matched sources missing their field map', () => {
    expect(() =>
      projectBoundColumns({
        definitionVersionId: ids.version,
        configuration: {
          ...configuration,
          columns: [
            {
              ...configuration.columns[0],
              source: {
                ...configuration.columns[0].source,
                bindingId: ids.version,
              },
            },
          ],
        } as SheetDefinitionConfiguration,
        rows: [row],
      }),
    ).toThrow('unknown binding')
    expect(() =>
      projectBoundColumns({
        definitionVersionId: ids.version,
        configuration,
        rows: [
          {
            ...row,
            sources: [{ ...row.sources[0], values: {} }, row.sources[1]],
          },
        ],
      }),
    ).toThrow('lacks source field')
  })
})
