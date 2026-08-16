import type {
  FieldDefinition,
  FieldLogicalType,
  FieldRelationshipTarget,
} from './field-definition'

/**
 * UI selection semantics shared by Model fields and future Dataset fields.
 * This intentionally selects controls rather than owning a universal form
 * component; each surface remains responsible for its layout and save flow.
 *
 * A Record-reference cell (`record-picker`) is selected only when the field
 * relationship target is a Model. Legacy callers that pass only
 * `logicalType` keep the text editor so scientific sheets are unchanged.
 */
export type FieldEditorKind =
  | 'checkbox'
  | 'category-select'
  | 'number'
  | 'date'
  | 'datetime-local'
  | 'text'
  | 'record-picker'

export interface FieldEditorPresentation {
  kind: FieldEditorKind
  inputType: 'number' | 'date' | 'datetime-local' | 'text' | null
  step?: '1' | 'any'
}

export interface FieldEditorPresentationOptions {
  relationshipTarget?: FieldRelationshipTarget['kind'] | null
}

export function fieldEditorPresentation(
  logicalType: FieldLogicalType,
  options?: FieldEditorPresentationOptions,
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
      if (options?.relationshipTarget === 'model') {
        return { kind: 'record-picker', inputType: 'text' }
      }
      return { kind: 'text', inputType: 'text' }
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
