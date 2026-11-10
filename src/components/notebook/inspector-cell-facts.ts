import { z } from 'zod'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { formatMagnitude } from '#/lib/format-numbers'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import type { FieldDefinition } from '#/lib/field-definition'
import type { BoundValueState } from '#/lib/sheet-bound-columns'
import type {
  NotebookInspectorCellFacts,
  NotebookInspectorCellValidation,
  NotebookInspectorProvenance,
} from './notebook-inspector'

const FIELD_TYPE_LABEL: Record<FieldDefinition['logicalType'], string> = {
  text: t('notebook.notebookInspector.text'),
  integer: t('notebook.notebookInspector.integer'),
  decimal: t('notebook.notebookInspector.decimal'),
  boolean: t('notebook.notebookInspector.boolean'),
  date: t('notebook.notebookInspector.date'),
  timestamp: t('notebook.notebookInspector.timestamp'),
  category: t('notebook.notebookInspector.category'),
  reference: t('notebook.notebookInspector.reference'),
}

const inspectorValue = z.json().optional()

/** Format a stored field value for the inspector; `null` when empty. */
function formatCellValue(
  value: z.output<typeof inspectorValue>,
  field: FieldDefinition | null,
): string | null {
  if (value === null || value === undefined || value === '') return null
  const boolean = z.boolean().safeParse(value)

  if (boolean.success)
    return boolean.data ? t('notebook.notebookInspector.yes') : 'No'
  const scalar = z.union([z.string(), z.number()]).safeParse(value)

  if (!scalar.success) return JSON.stringify(value)

  if (field?.logicalType === 'decimal' || field?.logicalType === 'integer') {
    const magnitude = formatMagnitude(scalar.data)

    if (magnitude) return magnitude
  }

  if (field?.logicalType === 'timestamp' || field?.logicalType === 'date') {
    const parsed = new Date(String(scalar.data))

    if (!Number.isNaN(parsed.getTime())) {
      return field.logicalType === 'date'
        ? formatDate(String(scalar.data))
        : formatDate(String(scalar.data), { time: true })
    }
  }

  return String(scalar.data)
}

/** Prefer the field's configured display unit to its storage unit. */
function fieldUnit(field: FieldDefinition | null): string | null {
  if (!field?.quantity) return null

  return field.quantity.preferredDisplayUnit ?? field.quantity.storageUnit
}

function fieldValidationRule(field: FieldDefinition | null): string | null {
  if (!field) return null
  const { min, max, minLength, maxLength, pattern } = field.validation

  if (min !== undefined && max !== undefined)
    return t('notebook.notebookInspector.allowedMinMax', { min, max })

  if (min !== undefined)
    return t('notebook.notebookInspector.atLeastMin', { min })

  if (max !== undefined)
    return t('notebook.notebookInspector.atMostMax', { max })

  if (minLength !== undefined && maxLength !== undefined) {
    return t('notebook.notebookInspector.minlengthMaxlengthCharacters', {
      minLength,
      maxLength,
    })
  }

  if (pattern) return t('notebook.notebookInspector.mustMatchAPattern')

  return null
}

function evaluateValidation(
  field: FieldDefinition | null,
  value: z.output<typeof inspectorValue>,
): NotebookInspectorCellValidation | null {
  const rule = fieldValidationRule(field)

  if (!field || !rule) return null
  const { min, max } = field.validation

  const numeric =
    value === null || value === undefined || value === '' ? null : Number(value)

  if (
    numeric === null ||
    Number.isNaN(numeric) ||
    (min === undefined && max === undefined)
  ) {
    return { state: 'unknown', rule }
  }

  if (min !== undefined && numeric < min) {
    return {
      state: 'error',
      headline: t('notebook.notebookInspector.belowTheAllowedRange'),
      detail: `${rule}.`,
      rule,
    }
  }

  if (max !== undefined && numeric > max) {
    return {
      state: 'error',
      headline: t('notebook.notebookInspector.aboveTheAllowedRange'),
      detail: `${rule}.`,
      rule,
    }
  }

  return {
    state: 'valid',
    headline: t('notebook.notebookInspector.withinTheAllowedRange'),
    rule,
  }
}

function provenanceFacts(
  valueState: BoundValueState | null,
): NotebookInspectorProvenance | null {
  if (!valueState) return null
  const provenance = valueState.provenance

  if (provenance.sourceKind === 'dataset') {
    return {
      dataset: {
        label: provenance.sourceDatasetId,
        datasetId: provenance.sourceDatasetId,
        rowLabel: provenance.sourceRowId,
      },
      instrument: null,
      capturedAt: null,
      enteredBy: null,
      editedAt: null,
    }
  }

  return {
    dataset: {
      label: provenance.sourceRecordId,
      rowLabel: provenance.sourceFieldName,
    },
    instrument: null,
    capturedAt: null,
    enteredBy: null,
    editedAt: null,
  }
}

/** Build the inspector's value, validation and provenance facts from canonical
 * sheet data. Unrecorded instrument, capture and actor facts remain absent. */
export function canonicalCellFacts(input: {
  column: CanonicalSheetGridColumn | null
  value: unknown
  valueState?: BoundValueState | null
  rowLabel?: string | null
  blockLabel?: string | null
}): NotebookInspectorCellFacts {
  const { column } = input
  const field = column?.field ?? null

  const context = [input.blockLabel, input.rowLabel, column?.label].filter(
    (part): part is string => Boolean(part),
  )

  const value = inspectorValue.safeParse(input.value).data
  const validation = evaluateValidation(field, value)
  const rule = fieldValidationRule(field)

  return {
    subject: context.length > 0 ? context.join(' · ') : null,
    value: {
      display: formatCellValue(value, field),
      unit: fieldUnit(field),
    },
    validation,
    provenance: provenanceFacts(input.valueState ?? null),
    column: column
      ? {
          field: column.label,
          type: FIELD_TYPE_LABEL[field?.logicalType ?? 'text'],
          unit: fieldUnit(field),
          validation: rule,
          required: field ? !field.nullable : null,
          source:
            column.origin === 'bound'
              ? t('notebook.notebookInspector.linked')
              : column.origin,
        }
      : null,
  }
}
