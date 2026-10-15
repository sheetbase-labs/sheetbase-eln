/**
 * R5-NOTE-02 — the sign-and-attach blocks: a signature request and a
 * corrective-actions (CAPA) list.
 *
 * Both are ordinary `api.blocks` rows — `type` + versioned jsonb `payload` +
 * fractional `order` — so identity, ordering and concurrency are the block
 * row's, exactly like every other block. This module owns the payload shapes,
 * the application-boundary validators and the pure derivations the reading
 * surface and the outline use; it adds no second structure.
 *
 * Decision recorded (R5-NOTE-02): these blocks DECLARE intent, they do not
 * raise a live signature request. Signature evidence is still written only
 * through the REV-03 flow (`request_signature_witness` / `sign_revision` at
 * submission and review), which stays the single writer of `api.signatures`.
 * The declaration therefore stores the requested signer as a captured label
 * (`requestedUserId` when the chooser resolved one, `requestedUserName`
 * always) rather than a foreign key, so a later membership change can never
 * silently drop the request — it shows as "no longer a member" instead. An
 * owner may overrule this and wire the block to a live request; nothing here
 * would prevent that.
 *
 * Who may add them: the same rule as every other block — an authenticated
 * workspace writer, enforced by `api.blocks` RLS and the record's lifecycle
 * (a locked or archived record refuses writes); the client shows the picker
 * only on an editable notebook. There is no block-type-specific grant, and the
 * real request/signature remains subject to `api.has_capability`.
 *
 * What happens when the referenced revision changes: neither block stores a
 * revision. The "referenced revision" is the revision the reading surface is
 * showing, passed in as `ActionBlockContext`. Reading an amended (superseded)
 * revision marks the declaration rather than re-pointing it at the newer
 * revision: a request that collected a signature against a revision that is no
 * longer current says so and must be re-requested, and a CAPA list raised
 * against a superseded revision says which revision superseded it.
 */
import type { SignatureMeaning, SignatureWire } from './signatures'
import { notebookOutline } from './notebook-outline'
import type { NotebookBlock } from './notebook-data'

// ---------------------------------------------------------------------------
// Signature request
// ---------------------------------------------------------------------------

/** The meanings a request may ask for. Mirrors the writable REV-03 set. */
export const SIGNATURE_REQUEST_MEANINGS: readonly SignatureMeaning[] = [
  'reviewed',
  'reviewed-and-approved',
  'witnessed',
]

export interface SignatureRequestPayload {
  /** Resolved when the chooser picked a member; null when only a label exists. */
  requestedUserId: string | null
  /** Captured label. Never inferred from today's user profile. */
  requestedUserName: string | null
  meaning: SignatureMeaning
  note: string
}

export const EMPTY_SIGNATURE_REQUEST_PAYLOAD: SignatureRequestPayload = {
  requestedUserId: null,
  requestedUserName: null,
  meaning: 'reviewed',
  note: '',
}

// ---------------------------------------------------------------------------
// Corrective actions
// ---------------------------------------------------------------------------

export const CORRECTIVE_ACTION_STATUSES = [
  'open',
  'in-progress',
  'done',
  'void',
] as const
export type CorrectiveActionStatus = (typeof CORRECTIVE_ACTION_STATUSES)[number]

export const CORRECTIVE_ACTION_STATUS_LABEL: Record<
  CorrectiveActionStatus,
  string
> = {
  open: 'Open',
  'in-progress': 'In progress',
  done: 'Done',
  void: 'Void',
}

export interface CorrectiveActionItem {
  id: string
  action: string
  /** Resolved member when chosen; null means the owner is not assigned. */
  ownerUserId: string | null
  ownerName: string | null
  /** ISO date (YYYY-MM-DD). Null when no due date is set. */
  due: string | null
  status: CorrectiveActionStatus
}

export interface CorrectiveActionsPayload {
  items: CorrectiveActionItem[]
}

export const EMPTY_CORRECTIVE_ACTIONS_PAYLOAD: CorrectiveActionsPayload = {
  items: [],
}

// ---------------------------------------------------------------------------
// Boundary validators. Returned in the shape `src/lib/blocks/index.ts` uses so
// the block registry stays the single validation entry point.
// ---------------------------------------------------------------------------

export interface ActionBlockFieldError {
  code:
    'invalid_payload_shape' | 'missing_required_field' | 'invalid_field_value'
  field?: string
  message: string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function validateSignatureRequest(
  payload: unknown,
): ActionBlockFieldError[] {
  if (!isObject(payload))
    return [
      { code: 'invalid_payload_shape', message: 'payload must be an object' },
    ]
  const errors: ActionBlockFieldError[] = []
  for (const key of ['requestedUserId', 'requestedUserName'] as const) {
    const value = payload[key]
    if (value !== null && value !== undefined && typeof value !== 'string') {
      errors.push({
        code: 'invalid_field_value',
        field: key,
        message: `${key} must be a string or null`,
      })
    }
  }
  if (
    payload.meaning !== undefined &&
    !SIGNATURE_REQUEST_MEANINGS.includes(payload.meaning as SignatureMeaning)
  ) {
    errors.push({
      code: 'invalid_field_value',
      field: 'meaning',
      message: `meaning must be one of ${SIGNATURE_REQUEST_MEANINGS.join(', ')}`,
    })
  }
  if (payload.note !== undefined && typeof payload.note !== 'string') {
    errors.push({
      code: 'invalid_field_value',
      field: 'note',
      message: 'note must be a string',
    })
  }
  return errors
}

export function validateCorrectiveActions(
  payload: unknown,
): ActionBlockFieldError[] {
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
  const errors: ActionBlockFieldError[] = []
  items.forEach((item, i) => {
    if (!isObject(item)) {
      errors.push({
        code: 'invalid_field_value',
        field: `items[${i}]`,
        message: 'each action must be an object',
      })
      return
    }
    if (typeof item.action !== 'string') {
      errors.push({
        code: 'missing_required_field',
        field: `items[${i}].action`,
        message: 'action is required',
      })
    }
    for (const key of ['ownerUserId', 'ownerName', 'due'] as const) {
      const value = item[key]
      if (value !== null && value !== undefined && typeof value !== 'string') {
        errors.push({
          code: 'invalid_field_value',
          field: `items[${i}].${key}`,
          message: `${key} must be a string or null`,
        })
      }
    }
    if (
      item.status !== undefined &&
      !CORRECTIVE_ACTION_STATUSES.includes(
        item.status as CorrectiveActionStatus,
      )
    ) {
      errors.push({
        code: 'invalid_field_value',
        field: `items[${i}].status`,
        message: `status must be one of ${CORRECTIVE_ACTION_STATUSES.join(', ')}`,
      })
    }
  })
  return errors
}

// ---------------------------------------------------------------------------
// Guards for the reading surface; a malformed payload renders honestly rather
// than throwing.
// ---------------------------------------------------------------------------

export function isSignatureRequestPayload(
  payload: unknown,
): payload is SignatureRequestPayload {
  return validateSignatureRequest(payload).length === 0
}

export function isCorrectiveActionsPayload(
  payload: unknown,
): payload is CorrectiveActionsPayload {
  return validateCorrectiveActions(payload).length === 0
}

// ---------------------------------------------------------------------------
// Reference state, derived from the revision the surface is reading.
// ---------------------------------------------------------------------------

export interface ActionBlockContext {
  /** Revision being read; null for a live (unsubmitted) notebook. */
  revisionId: string | null
  /** Set when `revisionId` has been superseded by an amendment. */
  supersededByRevisionId?: string | null
  /** Signatures already recorded for the record (any revision). */
  signatures?: readonly SignatureWire[]
}

export type SignatureRequestState =
  'unassigned' | 'awaiting' | 'requested' | 'signed' | 'changed' | 'superseded'

function signatureMatchesRequest(
  signature: SignatureWire,
  payload: SignatureRequestPayload,
): boolean {
  if (signature.signature_meaning !== payload.meaning) return false
  if (payload.requestedUserId)
    return signature.signer_user_id === payload.requestedUserId
  if (!payload.requestedUserName) return false
  return (
    (signature.signer_name ?? '').trim().toLowerCase() ===
    payload.requestedUserName.trim().toLowerCase()
  )
}

/**
 * The request's state against the revision being read. `unassigned` is the
 * missing-reference state: no signer label was captured, so the block shows
 * that nothing has been requested rather than inventing a person.
 */
export function signatureRequestState(
  payload: SignatureRequestPayload,
  context: ActionBlockContext = { revisionId: null },
): SignatureRequestState {
  if (!payload.requestedUserId && !payload.requestedUserName)
    return 'unassigned'
  if (context.supersededByRevisionId) return 'superseded'
  const match = (context.signatures ?? []).find((signature) =>
    signatureMatchesRequest(signature, payload),
  )
  if (match) {
    if (context.revisionId && match.revision_id !== context.revisionId)
      return 'changed'
    return 'signed'
  }
  return context.revisionId ? 'requested' : 'awaiting'
}

export const SIGNATURE_REQUEST_STATE_LABEL: Record<
  SignatureRequestState,
  string
> = {
  unassigned: 'No signer chosen',
  awaiting: 'Requested for the next submission',
  requested: 'Not signed yet',
  signed: 'Signed',
  changed: 'Signed revision has changed',
  superseded: 'Revision amended — request again',
}

/** One-line explanation for the honest states; empty for the plain ones. */
export function signatureRequestExplanation(
  state: SignatureRequestState,
  context: ActionBlockContext = { revisionId: null },
): string | null {
  switch (state) {
    case 'unassigned':
      return 'Choose who should sign and the meaning before submitting.'
    case 'awaiting':
      return 'The request is raised when this notebook is submitted.'
    case 'changed':
      return 'A signature exists, but against a revision that is no longer current. Request it again.'
    case 'superseded':
      return context.supersededByRevisionId
        ? `This revision has been superseded by ${context.supersededByRevisionId.slice(0, 8)}. The request must be made again on the amended revision.`
        : 'This revision has been superseded. Request again on the amended revision.'
    default:
      return null
  }
}

/**
 * A corrective-actions row's owner reference. `missing` is the
 * missing-reference state — the design flags an unowned action in warning
 * tone, which is exactly the honest reading of "no owner".
 */
export function correctiveActionOwner(item: CorrectiveActionItem): {
  label: string
  missing: boolean
} {
  const name = item.ownerName?.trim()
  if (!name) return { label: 'No owner', missing: true }
  return { label: name, missing: false }
}

export interface CorrectiveActionsSummary {
  open: number
  inProgress: number
  done: number
  void: number
  unowned: number
}

export function correctiveActionsSummary(
  payload: CorrectiveActionsPayload,
): CorrectiveActionsSummary {
  const summary: CorrectiveActionsSummary = {
    open: 0,
    inProgress: 0,
    done: 0,
    void: 0,
    unowned: 0,
  }
  for (const item of payload.items) {
    if (item.status === 'open') summary.open += 1
    else if (item.status === 'in-progress') summary.inProgress += 1
    else if (item.status === 'done') summary.done += 1
    else summary.void += 1
    if (correctiveActionOwner(item).missing) summary.unowned += 1
  }
  return summary
}

// ---------------------------------------------------------------------------
// Outline projections. Both read the same block rows the document renders, so
// the checklist and the requested-signature table can never drift from the
// blocks they describe.
// ---------------------------------------------------------------------------

export interface RequiredSectionEntry {
  label: string
  state: 'present' | 'missing'
}

/**
 * Which of the record type's named sections the document actually carries. A
 * section counts as present when a heading (or a block title) matches its
 * label, case-insensitively. The catalogue of required labels comes from the
 * record's notebook template; see the deferral note where the outline wires it.
 */
export function requiredSectionChecklist(
  blocks: ReadonlyArray<NotebookBlock>,
  requiredLabels: readonly string[],
): RequiredSectionEntry[] {
  if (requiredLabels.length === 0) return []
  const present = new Set<string>()
  for (const entry of notebookOutline(blocks)) {
    present.add(entry.text.trim().toLowerCase())
  }
  for (const block of blocks) {
    const title = block.payload.title
    if (typeof title === 'string') present.add(title.trim().toLowerCase())
  }
  return requiredLabels.map((label) => ({
    label,
    state: present.has(label.trim().toLowerCase()) ? 'present' : 'missing',
  }))
}

export interface RequestedSignatureRow {
  blockId: string
  signerLabel: string
  meaning: SignatureMeaning
  state: SignatureRequestState
  statusLabel: string
}

/**
 * The requested-signature table, built from the signature-request blocks and
 * their state against the revision being read. Empty when the document has no
 * request blocks — the surface then says so rather than showing a header with
 * nothing under it.
 */
export function requestedSignatureRows(
  blocks: ReadonlyArray<NotebookBlock>,
  context: ActionBlockContext = { revisionId: null },
): RequestedSignatureRow[] {
  const rows: RequestedSignatureRow[] = []
  for (const block of blocks) {
    if (block.type !== 'signature_request') continue
    if (!isSignatureRequestPayload(block.payload)) continue
    const payload = block.payload
    const state = signatureRequestState(payload, context)
    rows.push({
      blockId: block.id,
      signerLabel: payload.requestedUserName?.trim() || 'No signer chosen',
      meaning: payload.meaning,
      state,
      statusLabel: SIGNATURE_REQUEST_STATE_LABEL[state],
    })
  }
  return rows
}
