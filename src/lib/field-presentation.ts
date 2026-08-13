import type { FieldDefinition, FieldLogicalType } from './field-definition'

/**
 * UI selection semantics shared by Model fields and future Dataset fields.
 * This intentionally selects controls rather than owning a universal form
 * component; each surface remains responsible for its layout and save flow.
 */
export type FieldEditorKind =
  'checkbox' | 'category-select' | 'number' | 'date' | 'datetime-local' | 'text'

export interface FieldEditorPresentation {
  kind: FieldEditorKind
  inputType: 'number' | 'date' | 'datetime-local' | 'text' | null
  step?: '1' | 'any'
}

export function fieldEditorPresentation(
  logicalType: FieldLogicalType,
): FieldEditorPresentation {
  switch (logicalType) {
    case 'boolean':
      return { kind: 'checkbox', inputType: null }
    case 'category':
      return { kind: 'category-select', inputType: null }
    case 'integer':
      return { kind: 'number', inputType: 'number', step: '1' }
    case 'decimal':
      return { kind: 'number', inputType: 'number', step: 'any' }
    case 'date':
      return { kind: 'date', inputType: 'date' }
    case 'timestamp':
      return { kind: 'datetime-local', inputType: 'datetime-local' }
    case 'reference':
    case 'text':
      return { kind: 'text', inputType: 'text' }
  }
}

/** Embedded category options available for selection without hiding a saved
 * retired value. Vocabulary-backed values need a vocabulary resolver, which
 * is intentionally deferred with the vocabulary product. */
export function selectableFieldOptions(
  field: FieldDefinition,
  currentValue: unknown,
) {
  if (field.category?.kind !== 'embedded') return []
  return field.category.options.filter(
    (option) => option.lifecycle === 'active' || option.key === currentValue,
  )
}
