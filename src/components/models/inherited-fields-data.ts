import { createElement } from 'react'
import { bandRow } from '#/components/inventory/registry-grid'
import type { BandRow } from '#/components/inventory/registry-grid'
import type { CanonicalDatasetSchemaField } from '#/lib/dataset-schema-definition-rpc'
import type { ModelVersionField } from './record-model-fields'
import { InheritedChangeOn } from './inherited-change-on'
import { t } from '#/copy'

/** A field a subtype gets from a model above it: shown, never edited here. */
export interface InheritedRow {
  readonly __inherited: true
  id: string
  label: string
  key: string | null
  type: string
  unit: string | null
  required: string
  source: { id: string; name: string }
}

export interface InheritedGroup {
  modelId: string
  modelName: string
  rows: Omit<InheritedRow, '__inherited' | 'source'>[]
}

export function isInherited(
  row: InheritedRow | BandRow | ModelVersionField | CanonicalDatasetSchemaField,
): row is InheritedRow {
  return '__inherited' in row
}

/** Bands and read-only fields, from the top of the inheritance chain down. */
export function inheritedRows(
  groups: readonly InheritedGroup[],
): (InheritedRow | BandRow)[] {
  return groups
    .filter((group) => group.rows.length > 0)
    .flatMap((group) => {
      const source = { id: group.modelId, name: group.modelName }

      return [
        bandRow(
          t('library.models.shared.fromName', { name: group.modelName }),
          group.rows.length,
          createElement(InheritedChangeOn, { source }),
        ),
        ...group.rows.map((row): InheritedRow => ({
          ...row,
          __inherited: true,
          source,
        })),
      ]
    })
}
