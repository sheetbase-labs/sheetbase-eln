import { describe, expect, it, vi } from 'vitest'
import { createDataClient } from './data-client'
import type { ReviewSubmissionWire } from './reviews'
import {
  availableSignatureMeanings,
  fetchSignatureWitnessCandidates,
} from './signatures'
import type { SignatureWire } from './signatures'

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
    expect(
      meanings({ submission: { ...submission, state: 'withdrawn' } }),
    ).toEqual([])
  })
})

describe('effective project witness candidates', () => {
  it('uses effective View, not Review, workspace admin status or a missing legacy flag', async () => {
    const member = {
      name: 'Candidate',
      workspace_role: 'member',
      can_view: true,
    }
    const fetchImpl = vi.fn(async () =>
      Response.json([
        { ...member, user_id: 'view-only', can_review: false },
        { ...member, user_id: 'group-view', access_level: 'viewer' },
        {
          ...member,
          user_id: 'admin-without-view',
          workspace_role: 'admin',
          can_view: false,
        },
        {
          ...member,
          user_id: 'review-without-view',
          can_review: true,
          can_view: false,
        },
        {
          user_id: 'legacy-missing-flag',
          name: 'Legacy admin',
          workspace_role: 'admin',
        },
        { ...member, user_id: 'client', workspace_role: 'client_viewer' },
        { ...member, user_id: 'unknown-role', workspace_role: null },
        { ...member, user_id: 'requester' },
        { ...member, user_id: 'author' },
      ]),
    )
    const candidates = await fetchSignatureWitnessCandidates(
      createDataClient(fetchImpl),
      'exact-project',
      'requester',
      'author',
    )
    expect(candidates.map((candidate) => candidate.user_id)).toEqual([
      'view-only',
      'group-view',
    ])
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/db/rpc/project_members',
      expect.objectContaining({
        body: JSON.stringify({ p_project_id: 'exact-project' }),
      }),
    )
  })

  it('rejects malformed permission flags instead of interpreting truthy wire values as grants', async () => {
    const client = createDataClient(async () =>
      Response.json([
        {
          user_id: 'candidate',
          name: 'Candidate',
          workspace_role: 'member',
          can_view: 'true',
        },
      ]),
    )
    await expect(
      fetchSignatureWitnessCandidates(client, 'project', 'requester', 'author'),
    ).rejects.toThrow()
  })
})
