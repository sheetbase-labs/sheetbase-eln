import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDataClient } from './data-client'
import type { ReviewSubmissionWire } from './reviews'
import {
  availableSignatureMeanings,
  expiredSigningSignInSearch,
  fetchSignatureWitnessCandidates,
  isExpiredSigningSession,
  requestSignatureStepUp,
  signatureMeaningEnabled,
  signatureChecksPassed,
  SignatureStepUpError,
} from './signatures'
import type { SignatureWire } from './signatures'
import { readSignaturePolicy } from './signature-certification'

const submission: ReviewSubmissionWire = {
  id: 'submission',
  workspace_id: 'workspace',
  record_id: 'record',
  revision_id: 'revision',
  state: 'submitted',
  workflow_definition_key: 'default-scientific-review',
  workflow_definition_version: 1,
  assigned_reviewer_user_ids: ['reviewer'],
  submitted_by_user_id: 'author',
  submitted_session_id: 'session',
  submitted_role: 'member',
  submitted_at: '2026-10-04T12:00:00Z',
  due_at: null,
  idempotency_key: 'submission-key',
  created_at: '2026-10-04T12:00:00Z',
  updated_at: '2026-10-04T12:00:00Z',
}
const digest = 'a'.repeat(64)
const signature: SignatureWire = {
  id: 'signature',
  workspace_id: 'workspace',
  submission_id: 'submission',
  revision_id: 'revision',
  record_id: 'record',
  signature_meaning: 'reviewed',
  assurance_level: 'standard',
  revision_integrity_digest: digest,
  signer_user_id: 'reviewer',
  signer_session_id: 'session',
  signer_role: 'reviewer',
  auth_method: 'password',
  confirmation_phrase: 'Reviewer',
  signed_at: '2026-10-04T12:01:00Z',
  created_at: '2026-10-04T12:01:00Z',
  signer_name: 'Reviewer',
}

function meanings(
  overrides: Partial<Parameters<typeof availableSignatureMeanings>[0]> = {},
) {
  return availableSignatureMeanings({
    submission,
    currentUserId: 'reviewer',
    integrityDigest: digest,
    supersededByRevisionId: null,
    certificationCurrent: true,
    checksPassed: true,
    eligibility: { writer: true, requests: [] },
    signatures: [],
    ...overrides,
  })
}

describe('signature meaning eligibility', () => {
  it('distinguishes reviewing a submitted revision from approved locking authority', () => {
    expect(meanings()).toEqual(['reviewed'])
    expect(
      meanings({ submission: { ...submission, state: 'approved' } }),
    ).toEqual(['reviewed-and-approved', 'reviewed'])
    expect(meanings({ currentUserId: 'unassigned-owner' })).toEqual([])
    expect(
      meanings({
        currentUserId: 'author',
        submission: { ...submission, assigned_reviewer_user_ids: ['author'] },
      }),
    ).toEqual([])
  })

  it('does not offer a meaning the workspace has switched off', () => {
    const policy = readSignaturePolicy({
      meanings: { Reviewed: false, Approved: true },
    })
    expect(
      meanings({ policy, submission: { ...submission, state: 'approved' } }),
    ).toEqual(['reviewed-and-approved'])
    expect(
      meanings({
        policy: readSignaturePolicy({ meanings: { Approved: false } }),
        submission: { ...submission, state: 'approved' },
      }),
    ).toEqual(['reviewed'])
    expect(signatureMeaningEnabled(undefined, 'witnessed')).toBe(true)
    expect(
      signatureMeaningEnabled(
        readSignaturePolicy({ meanings: { Witnessed: false } }),
        'witnessed',
      ),
    ).toBe(false)
  })

  it('requires an exact-digest explicit nonauthor witness request, not reviewer assignment', () => {
    const eligibility = {
      writer: true,
      requests: [
        {
          id: 'request',
          submission_id: 'submission',
          witness_user_id: 'witness',
          revision_digest: digest,
          due_at: null,
        },
      ],
    }
    expect(meanings({ currentUserId: 'witness', eligibility })).toEqual([
      'witnessed',
    ])
    expect(meanings({ eligibility })).toEqual(['reviewed'])
    expect(
      meanings({
        currentUserId: 'witness',
        integrityDigest: 'b'.repeat(64),
        eligibility,
      }),
    ).toEqual([])
    expect(
      meanings({
        currentUserId: 'author',
        eligibility: {
          writer: true,
          requests: [{ ...eligibility.requests[0], witness_user_id: 'author' }],
        },
      }),
    ).toEqual([])
  })

  it('does not suppress a different meaning after Reviewed, but removes stale and denied targets', () => {
    expect(
      meanings({
        submission: { ...submission, state: 'approved' },
        signatures: [signature],
      }),
    ).toEqual(['reviewed-and-approved'])
    expect(meanings({ eligibility: undefined })).toEqual([])
    expect(meanings({ eligibility: { writer: false, requests: [] } })).toEqual(
      [],
    )
    expect(meanings({ supersededByRevisionId: 'new-revision' })).toEqual([])
    expect(meanings({ integrityDigest: null })).toEqual([])
    expect(meanings({ certificationCurrent: false })).toEqual([])
    expect(meanings({ checksPassed: false })).toEqual([])
    expect(
      meanings({ submission: { ...submission, state: 'withdrawn' } }),
    ).toEqual([])
  })

  it('requires the latest check result to pass for the signed digest', () => {
    const result = {
      id: 'result',
      workspace_id: 'workspace',
      record_id: 'record',
      revision_id: 'revision',
      check_definition_key: 'default',
      check_definition_version: 1,
      revision_integrity_digest: digest,
      check_definition_digest: digest,
      input_digest: digest,
      overall_status: 'pass' as const,
      pass_count: 1,
      blocking_failure_count: 0,
      warning_failure_count: 0,
      info_failure_count: 0,
      results: [],
      run_by_user_id: 'reviewer',
      run_session_id: 'session',
      run_role: 'member',
      run_at: '2026-10-04T12:00:00Z',
      idempotency_key: 'result-key',
      created_at: '2026-10-04T12:00:00Z',
    }
    expect(signatureChecksPassed([], digest)).toBe(false)
    expect(signatureChecksPassed([result], digest)).toBe(true)
    expect(signatureChecksPassed([result], null)).toBe(false)
    expect(
      signatureChecksPassed([{ ...result, blocking_failure_count: 1 }], digest),
    ).toBe(false)
    expect(
      signatureChecksPassed([{ ...result, overall_status: 'fail' }], digest),
    ).toBe(false)
    expect(
      signatureChecksPassed(
        [{ ...result, revision_integrity_digest: 'b'.repeat(64) }],
        digest,
      ),
    ).toBe(false)
    expect(
      signatureChecksPassed(
        [
          { ...result, run_at: '2026-10-04T11:00:00Z', overall_status: 'fail' },
          { ...result, run_at: '2026-10-04T13:00:00Z' },
        ],
        digest,
      ),
    ).toBe(true)
  })
})

describe('effective project witness candidates', () => {
  it('takes the server read answer per candidate instead of re-deriving membership', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([
        {
          user_id: 'view-only',
          name: 'View only',
          workspace_role: 'member',
          can_read_record: true,
        },
        {
          user_id: 'admin-without-record-read',
          name: 'Unreadable admin',
          workspace_role: 'admin',
          can_read_record: false,
        },
      ]),
    )
    const candidates = await fetchSignatureWitnessCandidates(
      createDataClient(fetchImpl),
      'submission-1',
    )
    expect(candidates).toEqual([
      {
        user_id: 'view-only',
        name: 'View only',
        workspace_role: 'member',
        can_read_record: true,
      },
      {
        user_id: 'admin-without-record-read',
        name: 'Unreadable admin',
        workspace_role: 'admin',
        can_read_record: false,
      },
    ])
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/db/rpc/signature_witness_candidates',
      expect.objectContaining({
        body: JSON.stringify({ p_submission_id: 'submission-1' }),
      }),
    )
  })

  it('rejects malformed read flags instead of interpreting truthy wire values as read authority', async () => {
    const client = createDataClient(async () =>
      Response.json([
        {
          user_id: 'candidate',
          name: 'Candidate',
          workspace_role: 'member',
          can_read_record: 'true',
        },
      ]),
    )
    await expect(
      fetchSignatureWitnessCandidates(client, 'submission-1'),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// R5-SHELL-05 — the step-up error contract the signing surfaces rely on.
//
// `postSignatureAuthentication` turns the server's `{code, message}` body into
// a typed error so a surface can tell an ended session (401 `session_expired`)
// from a refused password (401, no code) or the signing lock (423) without
// parsing prose. A wrong password must never be mistaken for an expired
// session, or the person would be thrown out of the dialog for a typo.
// ---------------------------------------------------------------------------

function replyWith(status: number, body: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: status < 400, status, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const stepUpInput = {
  workspaceId: 'workspace',
  purpose: 'certify',
  password: 'password',
} as const

describe('signature step-up error contract', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('marks a 401 with the session_expired code as an ended session', async () => {
    replyWith(401, { code: 'session_expired', message: 'Sign in again.' })
    const error = await requestSignatureStepUp(stepUpInput).catch(
      (err: unknown) => err,
    )
    expect(isExpiredSigningSession(error)).toBe(true)
    expect((error as SignatureStepUpError).code).toBe('session_expired')
  })

  it('does not treat a refused password as an ended session', async () => {
    replyWith(401, { message: 'Signing password was not accepted.' })
    const error = await requestSignatureStepUp(stepUpInput).catch(
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(SignatureStepUpError)
    expect(isExpiredSigningSession(error)).toBe(false)
    expect((error as SignatureStepUpError).status).toBe(401)
  })

  it('carries the lockout status and message', async () => {
    replyWith(423, {
      message: 'Signing is locked for 15 minutes after three failed attempts.',
    })
    const error = await requestSignatureStepUp(stepUpInput).catch(
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(SignatureStepUpError)
    expect((error as SignatureStepUpError).status).toBe(423)
    expect((error as Error).message).toContain('Signing is locked')
    expect(isExpiredSigningSession(error)).toBe(false)
  })

  it('returns the one-use token on success', async () => {
    replyWith(200, {
      token: 'token-1',
      expiresAt: '2026-10-11T12:05:00Z',
      authMethod: 'password',
    })
    await expect(requestSignatureStepUp(stepUpInput)).resolves.toEqual({
      token: 'token-1',
      expiresAt: '2026-10-11T12:05:00Z',
      authMethod: 'password',
    })
  })
})

describe('expiredSigningSignInSearch', () => {
  it('keeps a same-origin path as the return target', () => {
    expect(expiredSigningSignInSearch('/review/rev-1')).toEqual({
      state: 'expired-signing',
      next: '/review/rev-1',
    })
  })

  it('never yields an off-origin return target', () => {
    expect(expiredSigningSignInSearch('https://evil.example/x').next).toBe('/')
  })
})
