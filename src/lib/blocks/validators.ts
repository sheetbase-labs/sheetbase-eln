/**
 * Block payload validators: one function per stored block type, each returning
 * a list of field-level errors. A block's declaration (`./declarations`) names
 * its validator, so the payload contract lives next to the label, group and
 * editable flag it belongs with.
 */
import { z } from 'zod'

import { annotationsAreValid } from '#/lib/image-annotations'
import { isRichTextPayload } from './rich-text-data'
import { validateAnalysisBlockPayload } from '../analysis-block'
import { validateChartPayload } from '../chart-spec'
import { reactionIssues, structureIssues } from '../chemistry'
import {
  CODE_CELL_ALIAS,
  MAX_CODE_CELL_INPUTS,
  MAX_CODE_CELL_SOURCE,
  MAX_STORED_OUTPUT_ROWS,
  isCodeCellLanguage,
} from '../code-cells/code-cell'
import { CONCLUSION_VERDICTS } from '../conclusion-block'
import { validatePlateMapPayload } from '../plate-map'
import {
  validateCorrectiveActions,
  validateSignatureRequest,
} from '../notebook-action-blocks'

export type BlockValidationError =
  | 'unknown_block_type'
  | 'unsupported_payload_schema_version'
  | 'invalid_payload_shape'
  | 'missing_required_field'
  | 'invalid_field_value'

const blockFields = z.record(z.string(), z.unknown())

export type BlockPayloadFields = z.infer<typeof blockFields>

// Only the native container is established here. Each validator below reads
// fields in its original order; parsing a record would eagerly read and copy them.
const nativeBlockObject = z.custom<BlockPayloadFields>(
  (value) =>
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Approved native container boundary: exclude null/arrays, retain inherited/accessor fields and identity without eager decoding or full payload validation.
    typeof value === 'object' && value !== null && !Array.isArray(value),
)

const stringValue = z.string()

const numberValue = z.union([
  z.number(),
  z.nan(),
  z.literal(Infinity),
  z.literal(-Infinity),
])

const integerValue = z.custom<number>(Number.isInteger)

const uuidValue = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )

const timestampValue = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)))

/** Decode raw payloads into the existing ordered diagnostics without copying fields. */
function payloadValidator(
  check: (payload: z.input<z.ZodUnknown>) => FieldErrors,
) {
  const schema = z.unknown().transform(check)

  return (payload: z.input<typeof schema>): FieldErrors => schema.parse(payload)
}

function isObject(v: unknown): v is BlockPayloadFields {
  return nativeBlockObject.safeParse(v).success
}

function isString(v: unknown): v is string {
  return stringValue.safeParse(v).success
}

function isInteger(v: unknown): v is number {
  return integerValue.safeParse(v).success
}

function isNumber(v: unknown): v is number {
  return numberValue.safeParse(v).success
}

function isUuid(v: unknown): v is string {
  return uuidValue.safeParse(v).success
}

function isTimestamp(v: unknown): v is string {
  return timestampValue.safeParse(v).success
}

function isNonEmptyString(v: unknown): v is string {
  return isString(v) && v.trim().length > 0
}

export const validateSheet = payloadValidator((payload): FieldErrors => {
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  const keys = Object.keys(payload)

  if (keys.some((key) => !['instanceId', 'presentation'].includes(key))) {
    return [
      {
        code: 'invalid_field_value',
        message: 'sheet payload may only contain instanceId and presentation',
      },
    ]
  }

  if (payload.instanceId === undefined) {
    return [
      {
        code: 'missing_required_field',
        field: 'instanceId',
        message: 'sheet block must reference instanceId',
      },
    ]
  }

  if (!isUuid(payload.instanceId)) {
    return [
      {
        code: 'invalid_field_value',
        field: 'instanceId',
        message: 'instanceId must be a UUID',
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
})

// ---------------------------------------------------------------------------
// Per-type payload validators. Each returns a list of field-level errors.
// ---------------------------------------------------------------------------

export type FieldErrors = Array<{
  code: BlockValidationError
  field?: string
  message: string
}>

export const validateRichText = payloadValidator((payload): FieldErrors => {
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
})

export const validateChecklist = payloadValidator((payload): FieldErrors => {
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

    if (!z.boolean().safeParse(item.checked).success) {
      errors.push({
        code: 'invalid_field_value',
        field: `items[${i}].checked`,
        message: 'item.checked must be a boolean',
      })
    }
  })

  return errors
})

export const validateLinkedRecord = payloadValidator((payload): FieldErrors => {
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

  // NOTE-03: targetId is optional — the stable UUID of the linked canonical
  // object (Dataset UUID for targetKind 'dataset', Record UUID otherwise).
  // It is captured when the link is picked from search; older payloads
  // predate it and carry only the human identifier, which never builds a
  // canonical link.
  if (
    payload.targetId !== undefined &&
    !(isNonEmptyString(payload.targetId) && isUuid(payload.targetId))
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'targetId',
      message: 'targetId must be a UUID when present',
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
})

export const validateCallout = payloadValidator((payload): FieldErrors => {
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
})

export const validateConclusion = payloadValidator((payload): FieldErrors => {
  const errors: FieldErrors = []

  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]

  // A new conclusion starts empty, like a new callout draft: the text is
  // written after the block is inserted, so it is typed but not required.
  if (payload.text !== undefined && !isString(payload.text)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'text',
      message: 'text must be a string',
    })
  }

  if (
    payload.verdict !== undefined &&
    !CONCLUSION_VERDICTS.some((verdict) => verdict === payload.verdict)
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'verdict',
      message: `verdict must be one of ${CONCLUSION_VERDICTS.join(', ')}`,
    })
  }

  if (payload.basis !== undefined && !isString(payload.basis)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'basis',
      message: 'basis must be a string',
    })
  }

  return errors
})

export const validateTable = payloadValidator((payload): FieldErrors => {
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
})

export const validateChart = payloadValidator((payload): FieldErrors => {
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
})

// SCI-03: delegate to the analysis block validator. An empty draft `{}` is
// valid; definition-reference integrity and frozen-write authority are the
// database trigger's job.
export const validateAnalysis = payloadValidator((payload): FieldErrors => {
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]

  return validateAnalysisBlockPayload(payload).map((e) => ({
    code:
      e.field === 'title'
        ? 'missing_required_field'
        : e.field?.startsWith('frozen') ||
            e.field === 'definitionId' ||
            e.field === 'provenance'
          ? 'invalid_field_value'
          : 'invalid_payload_shape',
    field: e.field,
    message: e.message,
  }))
})

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

export const validatePlateMap = payloadValidator((payload): FieldErrors => {
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
})

export const validateFile = payloadValidator((payload): FieldErrors => {
  const errors: FieldErrors = []

  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]

  // SCI-003 (decision 0028): a file block is either an empty draft `{}` (no
  // file attached yet) or a reference to a file record. The DB trigger
  // (former migration 0025) verifies the referenced file record, workspace match, and
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

  if (
    payload.fileVersion !== undefined &&
    (!isInteger(payload.fileVersion) || payload.fileVersion < 1)
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'fileVersion',
      message: 'fileVersion must be a positive whole number when present',
    })
  }

  if (!annotationsAreValid(payload)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'annotations',
      message: 'annotations must be a list of arrows, labels and lane names',
    })
  }

  return errors
})

export const validateMetric = payloadValidator((payload): FieldErrors => {
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
})

export const validateProcedureStep = payloadValidator(
  (payload): FieldErrors => {
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

    if (
      payload.durationSeconds !== undefined &&
      !(
        isInteger(payload.durationSeconds) &&
        payload.durationSeconds >= 1 &&
        payload.durationSeconds <= 604_800
      )
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: 'durationSeconds',
        message:
          'durationSeconds must be a whole number of seconds, up to a week',
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

      if (!z.boolean().safeParse(payload.completed).success) {
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
  },
)

export const validateProtocolReference = payloadValidator(
  (payload): FieldErrors => {
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
  },
)

export const validateMaterials = payloadValidator((payload): FieldErrors => {
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

    if (value.kind !== 'sample' && value.kind !== 'material') {
      errors.push({
        code: 'invalid_field_value',
        field: `${field}.kind`,
        message: 'kind must be sample or material',
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
      !isNumber(value.quantity) ||
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
})

function chemistryErrors(
  issues: Array<{ field: string; message: string }>,
): FieldErrors {
  return issues.map((issue) => {
    const error: Omit<FieldErrors[number], 'message'> = {
      code:
        issue.field === '' ? 'invalid_payload_shape' : 'invalid_field_value',
    }

    if (issue.field) error.field = issue.field

    return { ...error, message: issue.message }
  })
}

const GATE_KINDS = [
  'table_filled',
  'step_done',
  'part_done',
  'samples_linked',
  'field_set',
  'date_reached',
  'qc_in_control',
  'plugin_check',
  'plugin_flag',
]

/** A gate holds back what is below it: 1 to 12 conditions and a mode. */
export const validateGate = payloadValidator((payload): FieldErrors => {
  if (!isObject(payload)) {
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  }

  const errors: FieldErrors = []

  if (payload.mode !== 'warn' && payload.mode !== 'block') {
    errors.push({
      code: 'invalid_field_value',
      field: 'mode',
      message: 'mode must be warn or block',
    })
  }

  if (
    payload.label !== undefined &&
    (!isString(payload.label) || payload.label.length > 200)
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'label',
      message: 'label must be text of at most 200 characters',
    })
  }

  const conditions = payload.conditions

  if (
    !Array.isArray(conditions) ||
    conditions.length < 1 ||
    conditions.length > 12
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'conditions',
      message: 'a gate needs between 1 and 12 conditions',
    })
  } else {
    conditions.forEach((condition, i) => {
      if (
        !isObject(condition) ||
        !GATE_KINDS.includes(String(condition.kind))
      ) {
        errors.push({
          code: 'invalid_field_value',
          field: `conditions[${i}]`,
          message: `kind must be one of ${GATE_KINDS.join(', ')}`,
        })

        return
      }

      const needsBlock =
        condition.kind === 'table_filled' ||
        condition.kind === 'step_done' ||
        condition.kind === 'plugin_check'

      if (needsBlock && !isUuid(condition.blockId)) {
        errors.push({
          code: 'invalid_field_value',
          field: `conditions[${i}].blockId`,
          message: 'blockId must be a UUID',
        })
      }

      if (
        condition.kind === 'plugin_flag' &&
        !(
          isString(condition.extensionKey) &&
          /^[a-z][a-z0-9-]{0,48}$/.test(condition.extensionKey)
        )
      ) {
        errors.push({
          code: 'invalid_field_value',
          field: `conditions[${i}].extensionKey`,
          message: 'extensionKey must be the plugin key',
        })
      }

      if (condition.kind === 'part_done' && !isUuid(condition.partId)) {
        errors.push({
          code: 'invalid_field_value',
          field: `conditions[${i}].partId`,
          message: 'partId must be a UUID',
        })
      }

      if (
        condition.kind === 'qc_in_control' &&
        condition.seriesId !== undefined &&
        !isUuid(condition.seriesId)
      ) {
        errors.push({
          code: 'invalid_field_value',
          field: `conditions[${i}].seriesId`,
          message: 'seriesId must be a UUID',
        })
      }

      if (
        condition.kind === 'date_reached' &&
        !(
          isString(condition.date) && /^\d{4}-\d{2}-\d{2}$/.test(condition.date)
        )
      ) {
        errors.push({
          code: 'invalid_field_value',
          field: `conditions[${i}].date`,
          message: 'date must be YYYY-MM-DD',
        })
      }
    })
  }

  return errors
})

// Upload pins are saved together; receipt pins are added together after commit.
// Reference ownership and receipt integrity are authoritative in PostgreSQL.
export const validateDatasetImport = payloadValidator(
  (payload): FieldErrors => {
    if (!isObject(payload)) {
      return [
        { code: 'invalid_payload_shape', message: 'payload must be an object' },
      ]
    }

    const errors: FieldErrors = []

    const uploaded =
      payload.fileId !== undefined || payload.datasetId !== undefined

    const committed =
      payload.importId !== undefined || payload.datasetVersionId !== undefined

    for (const field of [
      'fileId',
      'datasetId',
      'importId',
      'datasetVersionId',
    ] as const) {
      const required =
        field === 'fileId' || field === 'datasetId'
          ? uploaded || committed
          : committed

      if (required && !isUuid(payload[field])) {
        errors.push({
          code: 'invalid_field_value',
          field,
          message: `${field} must be a UUID`,
        })
      }
    }

    if (
      payload.sheetName !== undefined &&
      (!uploaded || !isString(payload.sheetName))
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: 'sheetName',
        message: 'sheetName requires upload pins and must be a string',
      })
    }

    if (payload.search !== undefined) {
      if (
        committed ||
        !isObject(payload.search) ||
        Object.entries(payload.search).some(
          ([key, value]) =>
            !['step', 'parser', 'map', 'sheet', 'units', 'instrument'].includes(
              key,
            ) ||
            !isString(value) ||
            (key === 'step' && value !== 'map' && value !== 'check'),
        )
      ) {
        errors.push({
          code: 'invalid_field_value',
          field: 'search',
          message:
            'search must contain only draft import step and string mapping options',
        })
      }
    }

    return errors
  },
)

// AUTO-03: a pipeline_output block references a Pipeline run by stable UUID
// and carries its produced Dataset Version identity for display. An empty
// draft `{}` is valid; run-reference integrity and workspace matching are
// the database trigger's job (migration 0140).
export const validatePipelineOutput = payloadValidator(
  (payload): FieldErrors => {
    if (!isObject(payload))
      return [
        { code: 'invalid_payload_shape', message: 'payload must be an object' },
      ]
    const errors: FieldErrors = []

    if (
      payload.runId !== undefined &&
      payload.runId !== null &&
      !isUuid(payload.runId)
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: 'runId',
        message: 'runId must be a Pipeline run UUID',
      })
    }

    for (const key of ['datasetId', 'datasetVersionId'] as const) {
      if (
        payload[key] !== undefined &&
        payload[key] !== null &&
        !isUuid(payload[key])
      ) {
        errors.push({
          code: 'invalid_field_value',
          field: key,
          message: `${key} must be a UUID`,
        })
      }
    }

    // PIPE-03: the proposal this block renders, when a run's propose-mode action
    // pins one here.
    if (
      payload.proposalId !== undefined &&
      payload.proposalId !== null &&
      !isUuid(payload.proposalId)
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: 'proposalId',
        message: 'proposalId must be an agent-operation proposal UUID',
      })
    }

    if (
      payload.label !== undefined &&
      payload.label !== null &&
      (!isString(payload.label) || payload.label.length > 200)
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: 'label',
        message: 'label must be a short string',
      })
    }

    return errors
  },
)

// A code cell holds Python or SQL, up to five dataset versions it reads, and the
// output of its last run. An empty draft is valid. Whether a dataset version can
// be read is checked when the cell runs, as the person running it.
export const validateCodeCell = payloadValidator((payload): FieldErrors => {
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  const errors: FieldErrors = []

  if (payload.language !== undefined && !isCodeCellLanguage(payload.language)) {
    errors.push({
      code: 'invalid_field_value',
      field: 'language',
      message: 'language must be python or sql',
    })
  }

  if (
    payload.source !== undefined &&
    (!isString(payload.source) || payload.source.length > MAX_CODE_CELL_SOURCE)
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'source',
      message: 'source must be text of up to 50,000 characters',
    })
  }

  if (payload.inputs !== undefined) {
    if (
      !Array.isArray(payload.inputs) ||
      payload.inputs.length > MAX_CODE_CELL_INPUTS
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: 'inputs',
        message: 'inputs must be a list of up to 5 dataset versions',
      })
    } else {
      const aliases = new Set<string>()
      payload.inputs.forEach((input, index: number) => {
        const entry = isObject(input) ? input : {}
        const alias = entry.alias

        if (!isString(alias) || !CODE_CELL_ALIAS.test(alias)) {
          errors.push({
            code: 'invalid_field_value',
            field: `inputs.${index}.alias`,
            message:
              'each input needs a name of letters, digits and underscores',
          })
        } else if (aliases.has(alias)) {
          errors.push({
            code: 'invalid_field_value',
            field: `inputs.${index}.alias`,
            message: 'input names must be different',
          })
        } else aliases.add(alias)

        if (!isUuid(entry.datasetVersionId)) {
          errors.push({
            code: 'invalid_field_value',
            field: `inputs.${index}.datasetVersionId`,
            message: 'each input needs a dataset version',
          })
        }
      })
    }
  }

  if (
    payload.output !== undefined &&
    payload.output !== null &&
    (!isObject(payload.output) ||
      !isString(payload.output.runId) ||
      !Array.isArray(payload.output.rows) ||
      payload.output.rows.length > MAX_STORED_OUTPUT_ROWS)
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'output',
      message: 'output must be the result of a run, with at most 100 rows',
    })
  }

  return errors
})

export const validateStructure = payloadValidator((payload): FieldErrors =>
  chemistryErrors(structureIssues(payload)),
)

export const validateReaction = payloadValidator((payload): FieldErrors =>
  chemistryErrors(reactionIssues(payload)),
)

export { validateCorrectiveActions, validateSignatureRequest }

/**
 * A plugin block keeps which plugin block it is and the state its screen returned.
 * The state may be as large as a plugin file (a sequence block holds up to 400,000
 * letters and its Sanger reads); the ceiling only keeps one block from filling a page load.
 */
const PLUGIN_BLOCK_STATE_MAX_BYTES = 16 * 1024 * 1024

export const validatePluginBlock = payloadValidator((payload): FieldErrors => {
  if (!isObject(payload)) {
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  }

  const errors: FieldErrors = []
  const key = /^[a-z][a-z0-9-]{0,48}$/

  if (!isString(payload.plugin) || !key.test(payload.plugin))
    errors.push({
      code: 'invalid_field_value',
      field: 'plugin',
      message: 'plugin must be the key of an installed plugin',
    })

  if (!isString(payload.block) || !key.test(payload.block))
    errors.push({
      code: 'invalid_field_value',
      field: 'block',
      message: 'block must be the id of one of the plugin’s blocks',
    })

  if (payload.state !== undefined) {
    let size = Infinity

    try {
      size = new TextEncoder().encode(JSON.stringify(payload.state)).length
    } catch {
      /* not JSON */
    }

    if (size > PLUGIN_BLOCK_STATE_MAX_BYTES)
      errors.push({
        code: 'invalid_field_value',
        field: 'state',
        message: 'state must be data of at most 16 MiB',
      })
  }

  for (const extra of Object.keys(payload))
    if (!['plugin', 'block', 'state'].includes(extra))
      errors.push({
        code: 'invalid_field_value',
        field: extra,
        message: 'unknown field',
      })

  return errors
})
