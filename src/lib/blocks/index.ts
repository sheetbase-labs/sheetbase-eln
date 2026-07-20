/**
 * Block payload validation at the application boundary (ELN-002).
 *
 * Decision 0015: blocks carry a typed JSONB `payload` validated against the
 * schema for `(type, payload_schema_version)`. The DB stores whatever JSONB
 * it is given; this module is the boundary that rejects invalid payloads
 * before they reach the database, and that preserves unsupported future
 * block types as readable placeholders rather than silently rewriting them.
 *
 * Initial block types (ELN-005 implements the first four in the UI):
 * heading, rich_text, checklist, linked_record. The remaining types
 * (list, callout, table, chart, plate_map, file, metric, procedure_step)
 * are defined here so the API boundary is complete even before the UI
 * renders them.
 */

import { isRichTextPayload } from './rich-text'

export {
  EMPTY_RICH_TEXT_PAYLOAD,
  RichTextContent,
  isRichTextPayload,
  richTextToPlainText,
} from './rich-text'
export type {
  RichTextDocument,
  RichTextMark,
  RichTextPayload,
} from './rich-text'

export type BlockType =
  | 'heading'
  | 'rich_text'
  | 'checklist'
  | 'linked_record'
  | 'list'
  | 'callout'
  | 'table'
  | 'sheet'
  | 'chart'
  | 'plate_map'
  | 'file'
  | 'metric'
  | 'procedure_step'

/** The payload schema version this module validates against. */
export const PAYLOAD_SCHEMA_VERSION = 1 as const

/**
 * The set of block types the DB check constraint allows. Kept in sync with
 * `chk_blocks_type` in drizzle/0008_powerful_celestials.sql. A type not in
 * this set is rejected as `unsupported_block_type`.
 */
export const KNOWN_BLOCK_TYPES: readonly BlockType[] = [
  'heading',
  'rich_text',
  'checklist',
  'linked_record',
  'list',
  'callout',
  'table',
  'sheet',
  'chart',
  'plate_map',
  'file',
  'metric',
  'procedure_step',
]

export type BlockValidationError =
  | 'unknown_block_type'
  | 'unsupported_payload_schema_version'
  | 'invalid_payload_shape'
  | 'missing_required_field'
  | 'invalid_field_value'

export interface BlockValidationResult {
  ok: boolean
  /** The type that was validated, echoed back for the caller. */
  type: string
  /** The schema version that was validated. */
  payloadSchemaVersion: number
  errors: Array<{ code: BlockValidationError; field?: string; message: string }>
}

/**
 * A block payload as it arrives at the application boundary. `unknown` so
 * the validators must narrow; the DB never sees a payload that has not
 * passed through here.
 */
export interface BlockInput {
  type: string
  payload: unknown
  payloadSchemaVersion?: number
}

function fail(
  type: string,
  payloadSchemaVersion: number,
  errors: Array<{
    code: BlockValidationError
    field?: string
    message: string
  }>,
): BlockValidationResult {
  return { ok: false, type, payloadSchemaVersion, errors }
}

function ok(type: string, payloadSchemaVersion: number): BlockValidationResult {
  return { ok: true, type, payloadSchemaVersion, errors: [] }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

function isNonEmptyString(v: unknown): v is string {
  return isString(v) && v.trim().length > 0
}

function validateSheet(payload: unknown): FieldErrors {
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  const keys = Object.keys(payload)
  if (keys.some((key) => !['tableId', 'presentation'].includes(key))) {
    return [
      {
        code: 'invalid_field_value',
        message: 'sheet payload may only contain tableId and presentation',
      },
    ]
  }
  if (
    typeof payload.tableId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.tableId,
    )
  ) {
    return [
      {
        code: 'invalid_field_value',
        field: 'tableId',
        message: 'tableId must be a UUID',
      },
    ]
  }
  if (payload.presentation !== undefined && !isObject(payload.presentation)) {
    return [
      {
        code: 'invalid_field_value',
        field: 'presentation',
        message: 'presentation must be an object',
      },
    ]
  }
  return []
}

// ---------------------------------------------------------------------------
// Per-type payload validators. Each returns a list of field-level errors.
// ---------------------------------------------------------------------------

type FieldErrors = Array<{
  code: BlockValidationError
  field?: string
  message: string
}>

function validateHeading(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  const level = payload.level
  if (!isInteger(level) || level < 1 || level > 6) {
    errors.push({
      code: 'invalid_field_value',
      field: 'level',
      message: 'level must be an integer 1–6',
    })
  }
  if (!isNonEmptyString(payload.text)) {
    errors.push({
      code: 'missing_required_field',
      field: 'text',
      message: 'text is required and must be a non-empty string',
    })
  }
  return errors
}

function validateRichText(payload: unknown): FieldErrors {
  return isRichTextPayload(payload)
    ? []
    : [
        {
          code: 'invalid_payload_shape',
          field: 'doc',
          message:
            'doc must be a supported rich-text v1 document (paragraphs, lists, and approved inline marks)',
        },
      ]
}

function validateChecklist(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  const items = payload.items
  if (!Array.isArray(items)) {
    return [
      {
        code: 'missing_required_field',
        field: 'items',
        message: 'items is required and must be an array',
      },
    ]
  }
  items.forEach((item, i) => {
    if (!isObject(item)) {
      errors.push({
        code: 'invalid_field_value',
        field: `items[${i}]`,
        message: 'each item must be an object',
      })
      return
    }
    if (!isString(item.text)) {
      errors.push({
        code: 'missing_required_field',
        field: `items[${i}].text`,
        message: 'item.text is required',
      })
    }
    if (typeof item.checked !== 'boolean') {
      errors.push({
        code: 'invalid_field_value',
        field: `items[${i}].checked`,
        message: 'item.checked must be a boolean',
      })
    }
  })
  return errors
}

function validateLinkedRecord(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  if (!isNonEmptyString(payload.targetKind)) {
    errors.push({
      code: 'missing_required_field',
      field: 'targetKind',
      message: 'targetKind is required',
    })
  }
  if (!isNonEmptyString(payload.targetIdentifier)) {
    errors.push({
      code: 'missing_required_field',
      field: 'targetIdentifier',
      message: 'targetIdentifier is required',
    })
  }
  if (!isNonEmptyString(payload.linkType)) {
    errors.push({
      code: 'missing_required_field',
      field: 'linkType',
      message: 'linkType is required',
    })
  }
  // label is optional. Empty string is treated as "no label"; only a
  // whitespace-only label (present but blank) is rejected.
  if (
    isString(payload.label) &&
    payload.label.length > 0 &&
    payload.label.trim().length === 0
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'label',
      message: 'label must not be blank when present',
    })
  }
  return errors
}

function validateList(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  const items = payload.items
  if (!Array.isArray(items) || !items.every(isString)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'items',
      message: 'items must be an array of strings',
    })
  }
  if (payload.ordered !== undefined && typeof payload.ordered !== 'boolean') {
    errors.push({
      code: 'invalid_field_value',
      field: 'ordered',
      message: 'ordered must be a boolean when present',
    })
  }
  return errors
}

function validateCallout(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  if (!isNonEmptyString(payload.text)) {
    errors.push({
      code: 'missing_required_field',
      field: 'text',
      message: 'text is required',
    })
  }
  const variant = payload.variant
  if (
    !isString(variant) ||
    !['info', 'warning', 'note', 'danger'].includes(variant)
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'variant',
      message: 'variant must be one of info, warning, note, danger',
    })
  }
  return errors
}

function validateTable(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  const columns = payload.columns
  if (!Array.isArray(columns) || !columns.every(isString)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'columns',
      message: 'columns must be an array of strings',
    })
  }
  const rows = payload.rows
  if (!Array.isArray(rows)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'rows',
      message: 'rows must be an array',
    })
  } else {
    rows.forEach((row, i) => {
      if (!Array.isArray(row)) {
        errors.push({
          code: 'invalid_field_value',
          field: `rows[${i}]`,
          message: 'each row must be an array',
        })
      }
    })
  }
  return errors
}

function validateChart(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  if (!isNonEmptyString(payload.title)) {
    errors.push({
      code: 'missing_required_field',
      field: 'title',
      message: 'title is required',
    })
  }
  if (!isNonEmptyString(payload.spec)) {
    errors.push({
      code: 'missing_required_field',
      field: 'spec',
      message: 'spec is required',
    })
  }
  if (payload.provenance !== undefined && !isString(payload.provenance)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'provenance',
      message: 'provenance must be a string when present',
    })
  }
  return errors
}

function validatePlateMap(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  const wells = payload.wells
  if (!Array.isArray(wells)) {
    errors.push({
      code: 'missing_required_field',
      field: 'wells',
      message: 'wells is required and must be an array',
    })
  }
  return errors
}

function validateFile(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  if (!isNonEmptyString(payload.name)) {
    errors.push({
      code: 'missing_required_field',
      field: 'name',
      message: 'name is required',
    })
  }
  if (payload.size !== undefined && !isInteger(payload.size)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'size',
      message: 'size must be an integer when present',
    })
  }
  if (payload.mime !== undefined && !isString(payload.mime)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'mime',
      message: 'mime must be a string when present',
    })
  }
  if (payload.storageKey !== undefined && !isString(payload.storageKey)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'storageKey',
      message: 'storageKey must be a string when present',
    })
  }
  return errors
}

function validateMetric(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  if (!isNonEmptyString(payload.label)) {
    errors.push({
      code: 'missing_required_field',
      field: 'label',
      message: 'label is required',
    })
  }
  if (payload.value === undefined || payload.value === null) {
    errors.push({
      code: 'missing_required_field',
      field: 'value',
      message: 'value is required',
    })
  }
  if (payload.unit !== undefined && !isString(payload.unit)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'unit',
      message: 'unit must be a string when present',
    })
  }
  if (payload.provenance !== undefined && !isString(payload.provenance)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'provenance',
      message: 'provenance must be a string when present',
    })
  }
  return errors
}

function validateProcedureStep(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  if (!isNonEmptyString(payload.text)) {
    errors.push({
      code: 'missing_required_field',
      field: 'text',
      message: 'text is required',
    })
  }
  if (payload.stepNumber !== undefined && !isInteger(payload.stepNumber)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'stepNumber',
      message: 'stepNumber must be an integer when present',
    })
  }
  return errors
}

const validators: Record<BlockType, (payload: unknown) => FieldErrors> = {
  heading: validateHeading,
  rich_text: validateRichText,
  checklist: validateChecklist,
  linked_record: validateLinkedRecord,
  list: validateList,
  callout: validateCallout,
  table: validateTable,
  sheet: validateSheet,
  chart: validateChart,
  plate_map: validatePlateMap,
  file: validateFile,
  metric: validateMetric,
  procedure_step: validateProcedureStep,
}

/**
 * Validate a block payload at the application boundary. Returns a result
 * with `ok: true` when the payload matches the schema for
 * `(type, payloadSchemaVersion)`, or a list of field-level errors otherwise.
 *
 * Unsupported future block types (not in KNOWN_BLOCK_TYPES) are reported as
 * `unknown_block_type`; the caller is expected to preserve them as readable
 * placeholders (decision 0015) rather than silently dropping the payload.
 */
export function validateBlock(input: BlockInput): BlockValidationResult {
  const payloadSchemaVersion =
    input.payloadSchemaVersion ?? PAYLOAD_SCHEMA_VERSION

  if (!KNOWN_BLOCK_TYPES.includes(input.type as BlockType)) {
    return fail(input.type, payloadSchemaVersion, [
      {
        code: 'unknown_block_type',
        field: 'type',
        message: `unsupported block type: ${input.type}`,
      },
    ])
  }

  if (payloadSchemaVersion !== PAYLOAD_SCHEMA_VERSION) {
    return fail(input.type, payloadSchemaVersion, [
      {
        code: 'unsupported_payload_schema_version',
        field: 'payloadSchemaVersion',
        message: `unsupported payload schema version: ${payloadSchemaVersion} (expected ${PAYLOAD_SCHEMA_VERSION})`,
      },
    ])
  }

  const validator = validators[input.type as BlockType]
  const errors = validator(input.payload)
  if (errors.length > 0) {
    return fail(input.type, payloadSchemaVersion, errors)
  }
  return ok(input.type, payloadSchemaVersion)
}

/**
 * Type guard convenience for callers that want a boolean.
 */
export function isBlockPayloadValid(input: BlockInput): boolean {
  return validateBlock(input).ok
}
