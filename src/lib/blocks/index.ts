/**
 * Block payload validation at the application boundary (ELN-002).
 *
 * Decision 0015: blocks carry a typed JSONB `payload` validated against the
 * schema for `(type, payload_schema_version)`. The DB stores whatever JSONB
 * it is given; this module is the boundary that rejects invalid payloads
 * before they reach the database, and that preserves unsupported future
 * block types as readable placeholders rather than silently rewriting them.
 *
 * Prose structure belongs to rich_text. Checklist and linked_record remain
 * semantic blocks; the remaining embedded/scientific types are defined here
 * so the API boundary is complete even before every type has an editor.
 */

import { isRichTextPayload } from './rich-text'

import { validateChartPayload } from '../chart-spec'
import { validatePlateMapPayload } from '../plate-map'

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
export {
  CHART_PALETTE,
  CHART_SPEC_VERSION,
  CHART_TYPES,
  validateChartPayload,
  validateChartSpec,
} from '../chart-spec'
export type {
  ChartBlockPayload,
  ChartSpec,
  ChartType,
  FrozenChart,
} from '../chart-spec'
export {
  ASSIGNMENT_ROLES,
  PLATE_FORMATS,
  PLATE_MAP_SPEC_VERSION,
  ROLE_STYLES,
  FORMAT_DIMENSIONS,
  defaultPlateMapSpec,
  parseWellCode,
  rowLabel as plateRowLabel,
  validatePlateMapPayload,
  validatePlateMapSpec,
  wellCode,
} from '../plate-map'
export type {
  AssignmentRole,
  PlateFormat,
  PlateMapBlockPayload,
  PlateMapSpec,
  PlateValidationConfig,
  SampleRef as PlateSampleRef,
  Volume as PlateVolume,
  WellAssignment as PlateWellAssignment,
} from '../plate-map'

export type BlockType =
  | 'rich_text'
  | 'checklist'
  | 'linked_record'
  | 'callout'
  | 'table'
  | 'sheet'
  | 'chart'
  | 'analysis_reference'
  | 'plate_map'
  | 'file'
  | 'metric'
  | 'procedure_step'
  | 'protocol_reference'
  | 'materials'

/** The payload schema version this module validates against. */
export const PAYLOAD_SCHEMA_VERSION = 1 as const

/**
 * The set of block types the DB check constraint allows. Kept in sync with
 * `chk_blocks_type` and its latest constraint migration. A type not in
 * this set is rejected as `unsupported_block_type`.
 */
export const KNOWN_BLOCK_TYPES: readonly BlockType[] = [
  'rich_text',
  'checklist',
  'linked_record',
  'callout',
  'table',
  'sheet',
  'chart',
  'analysis_reference',
  'plate_map',
  'file',
  'metric',
  'procedure_step',
  'protocol_reference',
  'materials',
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

function isUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    )
  )
}

function isTimestamp(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v))
}

function isNonEmptyString(v: unknown): v is string {
  return isString(v) && v.trim().length > 0
}

function validateAnalysisReference(payload: unknown): FieldErrors {
  if (!isObject(payload)) {
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  }
  if (Object.keys(payload).length === 0) return []
  const errors: FieldErrors = []
  if (!isUuid(payload.analysisId)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'analysisId',
      message: 'analysisId must be a UUID',
    })
  }
  if (!isUuid(payload.runId)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'runId',
      message: 'runId must be a UUID',
    })
  }
  if (!isNonEmptyString(payload.title)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'title',
      message: 'title must be a non-empty recorded label',
    })
  }
  const allowed = new Set(['analysisId', 'runId', 'title'])
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    errors.push({
      code: 'invalid_payload_shape',
      message:
        'analysis references may only contain analysisId, runId and title',
    })
  }
  return errors
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

function validateRichText(payload: unknown): FieldErrors {
  return isRichTextPayload(payload)
    ? []
    : [
        {
          code: 'invalid_payload_shape',
          field: 'doc',
          message:
            'doc must be a supported rich-text v1 document (H2/H3 headings, paragraphs, lists, and approved inline marks)',
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
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  // SCI-004 (decision 0029): delegate to the real ChartSpec validator. An
  // empty draft `{}` is valid. Dataset reference integrity is enforced by
  // the database trigger; this gate checks structural validity, palette and
  // chart-type-specific required fields.
  return validateChartPayload(payload).map((e) => ({
    code: mapChartErrorCode(e.code),
    field: e.field,
    message: e.message,
  }))
}

function mapChartErrorCode(code: string): BlockValidationError {
  switch (code) {
    case 'missing_field':
      return 'missing_required_field'
    case 'invalid_palette':
    case 'invalid_dataset_reference':
    case 'unsupported_type':
    case 'unsupported_spec_version':
    case 'invalid_value':
      return 'invalid_field_value'
    case 'invalid_shape':
    default:
      return 'invalid_payload_shape'
  }
}

function mapPlateMapErrorCode(code: string): BlockValidationError {
  switch (code) {
    case 'missing_field':
    case 'missing_required_role':
      return 'missing_required_field'
    case 'unsupported_format':
    case 'unsupported_role':
    case 'unsupported_spec_version':
    case 'invalid_well_code':
    case 'duplicate_well':
    case 'out_of_bounds':
    case 'invalid_sample_ref':
    case 'invalid_volume':
    case 'invalid_replicate':
    case 'duplicate_assignment':
    case 'invalid_value':
      return 'invalid_field_value'
    case 'invalid_shape':
    default:
      return 'invalid_payload_shape'
  }
}

function validatePlateMap(payload: unknown): FieldErrors {
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  // SCI-005 (decision 0030): delegate to the real PlateMapSpec validator. An
  // empty draft `{}` is valid. Sample reference integrity is enforced by the
  // database trigger; this gate checks structural validity, well codes,
  // roles, duplicate detection, required controls and volume constraints.
  return validatePlateMapPayload(payload).map((e) => ({
    code: mapPlateMapErrorCode(e.code),
    field: e.field,
    message: e.message,
  }))
}

function validateFile(payload: unknown): FieldErrors {
  const errors: FieldErrors = []
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  // SCI-003 (decision 0028): a file block is either an empty draft `{}` (no
  // file attached yet) or a reference to a file record. The DB trigger
  // (drizzle/0025) verifies the referenced file record, workspace match, and
  // exact file_objects metadata; status is intentionally NOT cached in the
  // payload so the preview always reflects the live file_objects row.
  if (Object.keys(payload).length === 0) return errors
  if (!isNonEmptyString(payload.fileRecordId)) {
    errors.push({
      code: 'missing_required_field',
      field: 'fileRecordId',
      message: 'fileRecordId is required when a file is attached',
    })
  }
  if (!isNonEmptyString(payload.fileIdentifier)) {
    errors.push({
      code: 'missing_required_field',
      field: 'fileIdentifier',
      message: 'fileIdentifier is required when a file is attached',
    })
  }
  if (!isNonEmptyString(payload.displayName)) {
    errors.push({
      code: 'missing_required_field',
      field: 'displayName',
      message: 'displayName is required when a file is attached',
    })
  }
  if (!isNonEmptyString(payload.mediaType)) {
    errors.push({
      code: 'missing_required_field',
      field: 'mediaType',
      message: 'mediaType is required when a file is attached',
    })
  }
  if (!isInteger(payload.byteSize) || payload.byteSize < 0) {
    errors.push({
      code: 'invalid_field_value',
      field: 'byteSize',
      message:
        'byteSize must be a non-negative integer when a file is attached',
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
  const executionFields = [
    'sourceProtocolRevisionId',
    'sourceStepBlockId',
    'completed',
    'note',
    'completedAt',
    'completedByUserId',
  ]
  const hasExecution = executionFields.some((field) => field in payload)
  if (hasExecution) {
    if (!isUuid(payload.sourceProtocolRevisionId)) {
      errors.push({
        code: 'invalid_field_value',
        field: 'sourceProtocolRevisionId',
        message: 'sourceProtocolRevisionId must be a UUID',
      })
    }
    if (!isUuid(payload.sourceStepBlockId)) {
      errors.push({
        code: 'invalid_field_value',
        field: 'sourceStepBlockId',
        message: 'sourceStepBlockId must be a UUID',
      })
    }
    if (typeof payload.completed !== 'boolean') {
      errors.push({
        code: 'invalid_field_value',
        field: 'completed',
        message: 'completed must be a boolean',
      })
    }
    if (!isString(payload.note)) {
      errors.push({
        code: 'invalid_field_value',
        field: 'note',
        message: 'note must be a string',
      })
    }
    if (payload.completedAt !== null && !isTimestamp(payload.completedAt)) {
      errors.push({
        code: 'invalid_field_value',
        field: 'completedAt',
        message: 'completedAt must be a timestamp or null',
      })
    }
    if (
      payload.completedByUserId !== null &&
      !isNonEmptyString(payload.completedByUserId)
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: 'completedByUserId',
        message: 'completedByUserId must be a user id or null',
      })
    }
  }
  return errors
}

function validateProtocolReference(payload: unknown): FieldErrors {
  if (!isObject(payload)) {
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  }
  if (Object.keys(payload).length === 0) return []
  const errors: FieldErrors = []
  for (const field of ['protocolRecordId', 'protocolRevisionId'] as const) {
    if (!isUuid(payload[field])) {
      errors.push({
        code: 'invalid_field_value',
        field,
        message: `${field} must be a UUID`,
      })
    }
  }
  for (const field of [
    'protocolIdentifier',
    'protocolTitle',
    'version',
    'approvalStatus',
    'pinnedByUserId',
  ] as const) {
    if (!isNonEmptyString(payload[field])) {
      errors.push({
        code: 'missing_required_field',
        field,
        message: `${field} is required`,
      })
    }
  }
  if (!isTimestamp(payload.pinnedAt)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'pinnedAt',
      message: 'pinnedAt must be a timestamp',
    })
  }
  return errors
}

function validateMaterials(payload: unknown): FieldErrors {
  if (!isObject(payload)) {
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  }
  if (!Array.isArray(payload.items)) {
    return [
      {
        code: 'missing_required_field',
        field: 'items',
        message: 'items is required and must be an array',
      },
    ]
  }
  const errors: FieldErrors = []
  const ids = new Set<string>()
  payload.items.forEach((value, index) => {
    const field = `items[${index}]`
    if (!isObject(value)) {
      errors.push({
        code: 'invalid_field_value',
        field,
        message: 'each material must be an object',
      })
      return
    }
    if (!isNonEmptyString(value.id) || ids.has(value.id)) {
      errors.push({
        code: 'invalid_field_value',
        field: `${field}.id`,
        message: 'material id must be nonblank and unique',
      })
    } else ids.add(value.id)
    if (!isUuid(value.materialRecordId)) {
      errors.push({
        code: 'invalid_field_value',
        field: `${field}.materialRecordId`,
        message: 'materialRecordId must be a UUID',
      })
    }
    if (value.kind !== 'sample' && value.kind !== 'reagent') {
      errors.push({
        code: 'invalid_field_value',
        field: `${field}.kind`,
        message: 'kind must be sample or reagent',
      })
    }
    for (const name of ['identifier', 'title'] as const) {
      if (!isNonEmptyString(value[name])) {
        errors.push({
          code: 'missing_required_field',
          field: `${field}.${name}`,
          message: `${name} is required`,
        })
      }
    }
    if (
      typeof value.quantity !== 'number' ||
      !Number.isFinite(value.quantity) ||
      value.quantity <= 0
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: `${field}.quantity`,
        message: 'quantity must be a positive finite number',
      })
    }
    if (
      !isObject(value.unit) ||
      !isNonEmptyString(value.unit.code) ||
      !isNonEmptyString(value.unit.symbol)
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: `${field}.unit`,
        message: 'unit must have nonblank code and symbol',
      })
    }
    if (value.note !== undefined && !isString(value.note)) {
      errors.push({
        code: 'invalid_field_value',
        field: `${field}.note`,
        message: 'note must be a string when present',
      })
    }
    if (!isTimestamp(value.observedAt)) {
      errors.push({
        code: 'invalid_field_value',
        field: `${field}.observedAt`,
        message: 'observedAt must be a timestamp',
      })
    }
  })
  return errors
}

const validators: Record<BlockType, (payload: unknown) => FieldErrors> = {
  rich_text: validateRichText,
  checklist: validateChecklist,
  linked_record: validateLinkedRecord,
  callout: validateCallout,
  table: validateTable,
  sheet: validateSheet,
  chart: validateChart,
  analysis_reference: validateAnalysisReference,
  plate_map: validatePlateMap,
  file: validateFile,
  metric: validateMetric,
  procedure_step: validateProcedureStep,
  protocol_reference: validateProtocolReference,
  materials: validateMaterials,
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
