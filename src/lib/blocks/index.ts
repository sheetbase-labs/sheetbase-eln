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

import { blockDescriptor, isBlockType } from './registry'
import { PAYLOAD_SCHEMA_VERSION } from './schema-version'
import type { BlockValidationError } from './validators'

export {
  EMPTY_RICH_TEXT_PAYLOAD,
  isEmptyRichText,
  isRichTextPayload,
  richTextToPlainText,
} from './rich-text-data'

export { RichTextContent } from './rich-text'

export type {
  RichTextDocument,
  RichTextMark,
  RichTextPayload,
} from './rich-text-data'

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

// R5-NOTE-02: the sign-and-attach block kinds (signature request, corrective
// actions). Payload shapes, boundary validators and the pure reference-state
// derivations live in the module so the reading surface and the outline share
// one reading of the same block rows.
export {
  CORRECTIVE_ACTION_STATUSES,
  CORRECTIVE_ACTION_STATUS_LABEL,
  EMPTY_CORRECTIVE_ACTIONS_PAYLOAD,
  EMPTY_SIGNATURE_REQUEST_PAYLOAD,
  SIGNATURE_REQUEST_MEANINGS,
  SIGNATURE_REQUEST_STATE_LABEL,
  correctiveActionOwner,
  correctiveActionsSummary,
  isCorrectiveActionsPayload,
  isSignatureRequestPayload,
  requiredSectionChecklist,
  requestedSignatureRows,
  signatureRequestExplanation,
  signatureRequestState,
  validateCorrectiveActions,
  validateSignatureRequest,
} from '../notebook-action-blocks'

export type {
  ActionBlockContext,
  CorrectiveActionItem,
  CorrectiveActionStatus,
  CorrectiveActionsPayload,
  CorrectiveActionsSummary,
  RequestedSignatureRow,
  RequiredSectionEntry,
  SignatureRequestPayload,
  SignatureRequestState,
} from '../notebook-action-blocks'

/**
 * The block type union and the `BLOCK_TYPES` allow-list are owned by
 * `./registry`; re-exported here so `#/lib/blocks` stays the import site.
 */
export type { BlockType } from './registry'

/** The payload schema version this module validates against. */
export { PAYLOAD_SCHEMA_VERSION }

export type { BlockValidationError } from './validators'

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

/**
 * Validate a block payload at the application boundary. Returns a result
 * with `ok: true` when the payload matches the schema for
 * `(type, payloadSchemaVersion)`, or a list of field-level errors otherwise.
 *
 * Unsupported future block types (not in `BLOCK_TYPES`, the allow-list owned
 * by `./registry`) are reported as `unknown_block_type`; the caller is
 * expected to preserve them as readable placeholders (decision 0015) rather
 * than silently dropping the payload.
 */
export function validateBlock(input: BlockInput): BlockValidationResult {
  const payloadSchemaVersion =
    input.payloadSchemaVersion ?? PAYLOAD_SCHEMA_VERSION

  if (!isBlockType(input.type)) {
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

  const errors = blockDescriptor(input.type)!.validate(input.payload)

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
