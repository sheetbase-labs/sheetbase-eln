/**
 * SIGN-001 — Electronic signature data layer.
 *
 * Wire shapes, data functions and query keys for the signature surface. The
 * browser invokes `sign_revision` through the same-origin `/api/db/rpc`
 * boundary and reads immutable signatures from the `signatures` REST
 * resource. Signatures are bound to a frozen, approved revision — they never
 * reference live record state and can never be altered once recorded.
 *
 * The assurance level is a stated property of the evidence, not a compliance
 * certification. No 21 CFR Part 11 / EU Annex 11 claim is made or implied.
 */
import type { DataClient } from './data-client'

// ---------------------------------------------------------------------------
// Wire shapes (snake_case, as returned by PostgREST).
// ---------------------------------------------------------------------------

/** A row from `api.signatures` (SIGN-001). */
export interface SignatureWire {
  id: string
  workspace_id: string
  submission_id: string
  revision_id: string
  record_id: string
  signature_meaning: SignatureMeaning
  assurance_level: SignatureAssuranceLevel
  revision_integrity_digest: string
  signer_user_id: string
  signer_session_id: string
  signer_role: string
  auth_method: SignatureAuthMethod
  confirmation_phrase: string
  signed_at: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Domain shapes (camelCase, consumed by the workspace UI).
// ---------------------------------------------------------------------------

export type SignatureMeaning = 'approve-for-record' | 'witness'

export type SignatureAssuranceLevel = 'standard'

export type SignatureAuthMethod = 'session+name-confirmation'

/** Result returned by the `sign_revision` RPC. */
export interface SignRevisionResult {
  signatureId: string
  submissionId: string
  revisionId: string
  signatureMeaning: SignatureMeaning
  assuranceLevel: SignatureAssuranceLevel
  signedAt: string
}

export interface SignRevisionInput {
  submissionId: string
  signatureMeaning: SignatureMeaning
  confirmationPhrase: string
  /** The digest of the revision the signer viewed, to reject stale actions. */
  expectedRevisionDigest: string
}

// ---------------------------------------------------------------------------
// Vocabulary for the UI. The assurance statement is honest about what the
// evidence proves and explicitly avoids compliance labelling.
// ---------------------------------------------------------------------------

export const SIGNATURE_MEANING_OPTIONS: {
  value: SignatureMeaning
  label: string
  description: string
}[] = [
  {
    value: 'approve-for-record',
    label: 'Approve for record',
    description:
      'I have reviewed this revision and approve it as the authoritative record for locking.',
  },
  {
    value: 'witness',
    label: 'Witness',
    description:
      'I witness that the review and approval of this revision took place.',
  },
]

export const ASSURANCE_LEVEL_LABEL: Record<SignatureAssuranceLevel, string> = {
  standard: 'Standard',
}

export const ASSURANCE_LEVEL_STATEMENT: Record<
  SignatureAssuranceLevel,
  string
> = {
  standard:
    'Standard assurance: your current signed-in session plus a typed confirmation that matches your recorded name. This is an internal attestation, not a regulatory compliance certification.',
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const signatureQueryKeys = {
  forSubmission: (submissionId: string) =>
    ['sign-001', 'signatures', 'submission', submissionId] as const,
  forRevision: (revisionId: string) =>
    ['sign-001', 'signatures', 'revision', revisionId] as const,
}

// ---------------------------------------------------------------------------
// Fetch helpers.
// ---------------------------------------------------------------------------

/** Fetch every signature recorded against a submission, oldest-first. */
export function fetchSignaturesForSubmission(
  client: DataClient,
  submissionId: string,
): Promise<SignatureWire[]> {
  return client.list<SignatureWire>(
    'signatures',
    `?submission_id=eq.${submissionId}&order=signed_at.asc`,
  )
}

// ---------------------------------------------------------------------------
// sign_revision RPC wrapper.
// ---------------------------------------------------------------------------

export function signRevision(
  client: DataClient,
  input: SignRevisionInput,
): Promise<SignRevisionResult> {
  return client.rpc('sign_revision', {
    p_submission_id: input.submissionId,
    p_signature_meaning: input.signatureMeaning,
    p_confirmation_phrase: input.confirmationPhrase,
    p_expected_revision_digest: input.expectedRevisionDigest,
  })
}
