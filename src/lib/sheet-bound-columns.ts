import { z } from 'zod'

import { fieldEditorPresentation } from './field-presentation'
import type { FieldEditorPresentation } from './field-presentation'
import type { ComposedSheetRow } from './sheet-composition-data'
import type { SheetDefinitionConfiguration } from './sheet-definition'

type BoundDefinitionColumn = SheetDefinitionConfiguration['columns'][number] & {
  source: { kind: 'bound'; bindingId: string; sourceFieldId: string }
}

interface BoundColumnDefinitionProvenance {
  definitionVersionId: string
  definitionColumnId: string
  bindingId: string
  sourceFieldId: string
}

export type BoundColumnProvenance =
  | (BoundColumnDefinitionProvenance & {
      sourceKind: 'dataset'
      sourceDatasetId: string
      sourceRowId: string | null
      sourceRevision: number | null
      sourceDatasetRevision: number
    })
  | (BoundColumnDefinitionProvenance & {
      sourceKind: 'record'
      sourceRecordId: string
      sourceMetadataVersion: number
      sourceFieldName: string
    })

export type BoundValueState =
  | { kind: 'present'; value: unknown; provenance: BoundColumnProvenance }
  | { kind: 'unmatched'; provenance: BoundColumnProvenance }

export interface ProjectedBoundColumn {
  id: string
  key: string
  label: string
  field: BoundDefinitionColumn['field']
  presentation: FieldEditorPresentation
  source: BoundDefinitionColumn['source']
  permission: {
    read: true
    editability: 'editable' | 'read-only'
    evidence: 'authenticated-composition-membership'
    reason:
      | 'Exact validated write-back mapping.'
      | 'No exact validated write-back mapping.'
  }
}

export interface ProjectedBoundRow {
  rowKey: string
  values: Record<string, BoundValueState>
}

function structuralError(message: string): never {
  throw new Error(`Invalid composed bound-column mapping: ${message}`)
}

/**
 * Projects only Definition `bound` columns. Write permission is configuration
 * evidence only; row-level resolution still rejects unmatched provenance.
 */
export function projectBoundColumns(input: {
  definitionVersionId: string
  configuration: SheetDefinitionConfiguration
  rows: ComposedSheetRow[]
}): { columns: ProjectedBoundColumn[]; rows: ProjectedBoundRow[] } {
  const columns = input.configuration.columns.filter(
    (column): column is BoundDefinitionColumn => column.source.kind === 'bound',
  )
  const knownBindings = new Set(
    input.configuration.bindings.map(({ id }) => id),
  )
  for (const column of columns) {
    if (!knownBindings.has(column.source.bindingId)) {
      structuralError(
        `column ${column.id} names unknown binding ${column.source.bindingId}`,
      )
    }
  }
  const writableColumns = new Set(
    input.configuration.writeBackRules.flatMap((rule) =>
      rule.mappings
        .filter((mapping) => {
          const column = columns.find(({ id }) => id === mapping.columnId)
          return (
            column?.source.bindingId === rule.bindingId &&
            column.source.sourceFieldId === mapping.targetFieldId
          )
        })
        .map(({ columnId }) => columnId),
    ),
  )

  return {
    columns: columns.map((column) => ({
      id: column.id,
      key: column.field.key,
      label: column.field.label,
      field: column.field,
      presentation: fieldEditorPresentation(column.field.logicalType, {
        relationshipTarget: column.field.relationship?.target.kind,
      }),
      source: column.source,
      permission: {
        read: true,
        editability: writableColumns.has(column.id) ? 'editable' : 'read-only',
        evidence: 'authenticated-composition-membership',
        reason: writableColumns.has(column.id)
          ? 'Exact validated write-back mapping.'
          : 'No exact validated write-back mapping.',
      },
    })),
    rows: input.rows.map((row) => ({
      rowKey: row.rowKey,
      values: Object.fromEntries(
        columns.map((column) => {
          const source = row.sources.find(
            ({ bindingId }) => bindingId === column.source.bindingId,
          )
          if (!source) {
            structuralError(
              `row ${row.rowKey} is missing binding ${column.source.bindingId}`,
            )
          }
          if (
            source.sourceKind === 'record' &&
            !Object.hasOwn(source.fieldNames, column.source.sourceFieldId)
          ) {
            structuralError(
              `row ${row.rowKey} binding ${source.bindingId} lacks stable field-name mapping ${column.source.sourceFieldId}`,
            )
          }
          const provenance: BoundColumnProvenance =
            source.sourceKind === 'dataset'
              ? {
                  definitionVersionId: input.definitionVersionId,
                  definitionColumnId: column.id,
                  bindingId: column.source.bindingId,
                  sourceKind: 'dataset',
                  sourceDatasetId: source.datasetId,
                  sourceRowId: source.rowId,
                  sourceRevision: source.revision,
                  sourceDatasetRevision: source.datasetRevision,
                  sourceFieldId: column.source.sourceFieldId,
                }
              : {
                  definitionVersionId: input.definitionVersionId,
                  definitionColumnId: column.id,
                  bindingId: column.source.bindingId,
                  sourceKind: 'record',
                  sourceRecordId: source.recordId,
                  sourceMetadataVersion: source.metadataVersion,
                  sourceFieldName:
                    source.fieldNames[column.source.sourceFieldId],
                  sourceFieldId: column.source.sourceFieldId,
                }
          if (!source.matched) {
            return [column.id, { kind: 'unmatched', provenance }]
          }
          if (!Object.hasOwn(source.values, column.source.sourceFieldId)) {
            structuralError(
              `row ${row.rowKey} binding ${source.bindingId} lacks source field ${column.source.sourceFieldId}`,
            )
          }
          return [
            column.id,
            {
              kind: 'present',
              value: source.values[column.source.sourceFieldId],
              provenance,
            },
          ]
        }),
      ),
    })),
  }
}

const definitionProvenanceSchema = z
  .object({
    definitionVersionId: z.string().uuid(),
    definitionColumnId: z.string().uuid(),
    bindingId: z.string().uuid(),
    sourceFieldId: z.string().uuid(),
  })
  .strict()

const provenanceSchema = z.discriminatedUnion('sourceKind', [
  definitionProvenanceSchema
    .extend({
      sourceKind: z.literal('dataset'),
      sourceDatasetId: z.string().uuid(),
      sourceRowId: z.string().uuid().nullable(),
      sourceRevision: z.number().int().nullable(),
      sourceDatasetRevision: z.number().int().positive(),
    })
    .strict(),
  definitionProvenanceSchema
    .extend({
      sourceKind: z.literal('record'),
      sourceRecordId: z.string().uuid(),
      sourceMetadataVersion: z.number().int().positive(),
      sourceFieldName: z.string().min(1),
    })
    .strict(),
])

export const boundValueInspectorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('present'),
      value: z.unknown(),
      provenance: provenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('unmatched'),
      provenance: provenanceSchema,
    })
    .strict(),
])
