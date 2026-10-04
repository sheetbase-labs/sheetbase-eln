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
import { z } from 'zod'

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
  /** Null for historical evidence; never inferred from today's user profile. */
  signer_name: string | null
}

// ---------------------------------------------------------------------------
// Domain shapes (camelCase, consumed by the workspace UI).
// ---------------------------------------------------------------------------

export type PostSubmissionSignatureMeaning =
  'reviewed' | 'reviewed-and-approved' | 'witnessed'

/** Historical aliases remain readable but are never offered for new writes. */
export type SignatureMeaning =
  PostSubmissionSignatureMeaning | 'authored' | 'approve-for-record' | 'witness'

export type SignatureAssuranceLevel = 'standard'

export type SignatureAuthMethod = 'session+name-confirmation' | 'password'

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
  signatureMeaning: PostSubmissionSignatureMeaning
  confirmationPhrase: string
  /** The digest of the revision the signer viewed, to reject stale actions. */
  expectedRevisionDigest: string
  signingToken: string
}

// ---------------------------------------------------------------------------
// Vocabulary for the UI. The assurance statement is honest about what the
// evidence proves and explicitly avoids compliance labelling.
// ---------------------------------------------------------------------------

export const SIGNATURE_MEANING_OPTIONS: {
  value: PostSubmissionSignatureMeaning
  label: string
  description: string
}[] = [
  {
    value: 'reviewed-and-approved',
    label: 'Reviewed and approved',
    description:
      'I have reviewed this revision and approve it as the authoritative record for locking.',
  },
  {
    value: 'reviewed',
    label: 'Reviewed',
    description:
      'I have reviewed this revision. This attestation does not approve or lock the record.',
  },
  {
    value: 'witnessed',
    label: 'Witnessed',
    description:
      'As a requested witness, I attest to this exact frozen revision. This does not approve or lock the record.',
  },
]

export const SIGNATURE_MEANING_LABEL: Record<SignatureMeaning, string> = {
  authored: 'Authored',
  reviewed: 'Reviewed',
  'reviewed-and-approved': 'Reviewed and approved',
  witnessed: 'Witnessed',
  'approve-for-record': 'Approve for record',
  witness: 'Witness',
}

export const ASSURANCE_LEVEL_LABEL: Record<SignatureAssuranceLevel, string> = {
  standard: 'Standard',
}

export const ASSURANCE_LEVEL_STATEMENT: Record<
  SignatureAssuranceLevel,
  string
> = {
  standard:
    'Your independently verified identity, current signature certification and password re-entry bind this signature to the exact reviewed version. This is an internal attestation, not a regulatory compliance certification.',
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
    p_signing_token: input.signingToken,
  })
}

export type SignatureStepUpInput = { workspaceId: string; password: string } & (
  | {
      purpose: 'sign'
      submissionId: string
      revisionDigest: string
      signatureMeaning: PostSubmissionSignatureMeaning
    }
  | { purpose: 'certify' | 'practice' }
)

export async function requestSignatureStepUp(input: SignatureStepUpInput) {
  return z
    .object({
      token: z.string(),
      expiresAt: z.string(),
      authMethod: z.literal('password'),
    })
    .parse(await postSignatureAuthentication(input))
}

export async function requestSignatureCredential(
  input: { workspaceId: string } & (
    | { purpose: 'enroll-request' | 'recover-request' }
    | { purpose: 'enroll' | 'recover'; password: string; secret: string }
  ),
): Promise<void> {
  await postSignatureAuthentication(input)
}

async function postSignatureAuthentication(input: object): Promise<unknown> {
  const response = await fetch('/api/signatures/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const error = z.object({ message: z.string() }).safeParse(body)
    throw new Error(
      error.success ? error.data.message : 'Signing authentication failed.',
    )
  }
  return body
}
