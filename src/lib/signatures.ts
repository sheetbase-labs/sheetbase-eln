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
import type { ReviewCheckResultWire } from './review-checks'
import type { ReviewSubmissionWire } from './reviews'

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
  forRecord: (recordId: string) => ['signatures', 'record', recordId] as const,
  eligibility: (submissionId: string, userId: string) =>
    ['signatures', 'eligibility', submissionId, userId] as const,
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

export function fetchSignaturesForRecord(
  client: DataClient,
  recordId: string,
): Promise<SignatureWire[]> {
  return client.list<SignatureWire>(
    'signatures',
    `?record_id=eq.${recordId}&order=signed_at.asc,id.asc`,
  )
}

export interface SignatureWitnessRequestWire {
  id: string
  submission_id: string
  witness_user_id: string
  revision_digest: string
  due_at: string | null
}

export interface SignatureWitnessCandidate {
  user_id: string
  name: string
  workspace_role: string | null
  /**
   * REV-03: whether this person can read the record they would witness.
   * Project View is not enough for a draft experiment, which stays private to
   * its author and to workspace owners, so an administrator holding an explicit
   * View rule is listed but cannot be asked.
   */
  can_read_record: boolean
}

/**
 * Effective project members who may witness this record, minus the requester and
 * the author. Computed server-side: read authority is a record-level RLS
 * question (draft-experiment privacy), so `can_read_record` is the same
 * predicate `request_signature_witness` enforces rather than a client mirror
 * that could drift from it.
 */
export async function fetchSignatureWitnessCandidates(
  client: DataClient,
  submissionId: string,
): Promise<SignatureWitnessCandidate[]> {
  return z
    .array(
      z.object({
        user_id: z.string(),
        name: z.string(),
        workspace_role: z.string().nullable(),
        can_read_record: z.boolean(),
      }),
    )
    .parse(
      await client.rpc('signature_witness_candidates', {
        p_submission_id: submissionId,
      }),
    )
}

/** The server-mirrored gates that decide whether this person may sign. */
export interface SignatureEligibility {
  writer: boolean
  requests: SignatureWitnessRequestWire[]
}

/**
 * Mirrors `internal.assert_signature_target`'s SB008 check gate: the latest
 * check result must exist for the signed digest and have no blocking failures.
 * The panel states the requirement instead of letting the password attempt be
 * refused opaquely.
 */
export function signatureChecksPassed(
  results: ReviewCheckResultWire[],
  integrityDigest: string | null,
): boolean {
  if (!integrityDigest) return false
  if (results.length === 0) return false
  const latest = [...results].sort(
    (a, b) => Date.parse(b.run_at) - Date.parse(a.run_at),
  )[0]
  return (
    latest.revision_integrity_digest === integrityDigest &&
    latest.blocking_failure_count === 0 &&
    latest.overall_status !== 'fail'
  )
}

export async function fetchSignatureEligibility(
  client: DataClient,
  submission: ReviewSubmissionWire,
  userId: string,
): Promise<SignatureEligibility> {
  const [writer, requests] = await Promise.all([
    client.rpc('is_workspace_writer', {
      p_workspace_id: submission.workspace_id,
    }),
    client.list<SignatureWitnessRequestWire>(
      'signature_witness_requests',
      `?submission_id=eq.${submission.id}&witness_user_id=eq.${encodeURIComponent(userId)}`,
    ),
  ])
  return { writer: z.boolean().parse(writer), requests }
}

/**
 * Mirrors target rules for presentation. Password issuance/RPCs enforce them.
 * `certificationCurrent` is the signer's own attestation state: DEC-04 requires
 * a current certification for every signature, so an uncertified person has no
 * available meaning and is told why before a password attempt is refused.
 */
export function availableSignatureMeanings(input: {
  submission: ReviewSubmissionWire | null
  currentUserId: string
  integrityDigest: string | null
  supersededByRevisionId: string | null
  certificationCurrent: boolean
  /** The revision's latest check result passed for the signed digest (SB008). */
  checksPassed: boolean
  eligibility: SignatureEligibility | undefined
  signatures: SignatureWire[]
}): PostSubmissionSignatureMeaning[] {
  const { submission, currentUserId, integrityDigest, eligibility } = input
  if (
    !submission ||
    !input.certificationCurrent ||
    !input.checksPassed ||
    !eligibility?.writer ||
    !integrityDigest ||
    input.supersededByRevisionId !== null ||
    currentUserId === submission.submitted_by_user_id ||
    !['submitted', 'approved'].includes(submission.state)
  )
    return []
  return SIGNATURE_MEANING_OPTIONS.filter((option) => {
    if (
      input.signatures.some(
        (signature) =>
          signature.signer_user_id === currentUserId &&
          signature.signature_meaning === option.value,
      )
    )
      return false
    if (option.value === 'witnessed')
      return eligibility.requests.some(
        (request) =>
          request.witness_user_id === currentUserId &&
          request.revision_digest === integrityDigest,
      )
    return (
      submission.assigned_reviewer_user_ids.includes(currentUserId) &&
      (option.value === 'reviewed' || submission.state === 'approved')
    )
  }).map((option) => option.value)
}

export function requestSignatureWitness(
  client: DataClient,
  input: {
    submissionId: string
    witnessUserId: string
    expectedRevisionDigest: string
    dueAt: string | null
  },
): Promise<{
  id: string
  submissionId: string
  revisionId: string
  witnessUserId: string
}> {
  return client.rpc('request_signature_witness', {
    p_submission_id: input.submissionId,
    p_witness_user_id: input.witnessUserId,
    p_expected_revision_digest: input.expectedRevisionDigest,
    p_due_at: input.dueAt,
  })
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
  | {
      purpose: 'author-submit'
      recordId: string
      revisionDigest: string
      workflowDefinitionKey: string
      workflowDefinitionVersion: number
      reviewerUserIds: string[]
      confirmed: boolean
      idempotencyKey: string
      dueAt: string | null
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

/**
 * A refused signature step-up. `status` and `code` keep the surface able to
 * tell an expired session (401 `session_expired`) from a refused password
 * (401 without a code) or a lockout (423) without parsing prose.
 */
export class SignatureStepUpError extends Error {
  readonly status: number
  readonly code: string | undefined
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'SignatureStepUpError'
    this.status = status
    this.code = code
  }
}

/**
 * R5-SHELL-05 — true when a signing attempt lost its session. The step-up
 * returns this only when the request carried no live session, so the surface
 * can send the person back to sign-in rather than offer a retry that cannot
 * succeed. `next` is the same-origin review path to return to afterwards.
 */
export function isExpiredSigningSession(
  error: unknown,
): error is SignatureStepUpError {
  return (
    error instanceof SignatureStepUpError && error.code === 'session_expired'
  )
}

/** The search the sign-in route uses to say why it is showing and where to return. */
export function expiredSigningSignInSearch(pathname: string): {
  state: 'expired-signing'
  next: string
} {
  return {
    state: 'expired-signing',
    next: pathname.startsWith('/') ? pathname : '/',
  }
}

async function postSignatureAuthentication(input: object): Promise<unknown> {
  const response = await fetch('/api/signatures/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const error = z
      .object({ message: z.string(), code: z.string().optional() })
      .safeParse(body)
    throw new SignatureStepUpError(
      response.status,
      error.success ? error.data.message : 'Signing authentication failed.',
      error.success ? error.data.code : undefined,
    )
  }
  return body
}
