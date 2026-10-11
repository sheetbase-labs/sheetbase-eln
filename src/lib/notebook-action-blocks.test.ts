import { describe, expect, it } from 'vitest'

import type { NotebookBlock } from './notebook-data'
import type { SignatureWire } from './signatures'
import {
  correctiveActionOwner,
  correctiveActionsSummary,
  isCorrectiveActionsPayload,
  isSignatureRequestPayload,
  requiredSectionChecklist,
  requestedSignatureRows,
  signatureRequestState,
  validateCorrectiveActions,
  validateSignatureRequest,
} from './notebook-action-blocks'
import type {
  CorrectiveActionsPayload,
  SignatureRequestPayload,
} from './notebook-action-blocks'

let seq = 0
function block(
  type: string,
  payload: Record<string, unknown>,
  order = (seq += 1),
): NotebookBlock {
  return {
    id: `block-${seq}`,
    recordId: 'record-1',
    type,
    payload,
    payloadSchemaVersion: 1,
    order,
    version: 1,
  }
}

function signature(patch: Partial<SignatureWire>): SignatureWire {
  return {
    id: 'sig-1',
    workspace_id: 'ws-1',
    submission_id: 'sub-1',
    revision_id: 'rev-1',
    record_id: 'record-1',
    signature_meaning: 'reviewed',
    assurance_level: 'standard',
    revision_integrity_digest: 'a'.repeat(64),
    signer_user_id: 'u-1',
    signer_session_id: 's-1',
    signer_role: 'authenticated',
    auth_method: 'password',
    confirmation_phrase: 'Ada Lovelace',
    signed_at: '2026-10-11T10:00:00Z',
    created_at: '2026-10-11T10:00:00Z',
    signer_name: 'Ada Lovelace',
    ...patch,
  }
}

const request: SignatureRequestPayload = {
  requestedUserId: 'u-1',
  requestedUserName: 'Ada Lovelace',
  meaning: 'reviewed',
  note: 'Please review the runs.',
}

describe('signature request payload', () => {
  it('accepts a well-formed request and rejects a bad meaning', () => {
    expect(validateSignatureRequest(request)).toEqual([])
    expect(isSignatureRequestPayload(request)).toBe(true)
    expect(
      validateSignatureRequest({ ...request, meaning: 'authored' }),
    ).toHaveLength(1)
    expect(isSignatureRequestPayload({ meaning: 3 })).toBe(false)
  })

  it('reads an empty payload as valid — the block says no signer is chosen', () => {
    expect(
      isSignatureRequestPayload({
        requestedUserId: null,
        requestedUserName: null,
        meaning: 'reviewed',
        note: '',
      }),
    ).toBe(true)
  })
})

describe('signatureRequestState — the referenced revision', () => {
  it('reports the missing reference before a signer is chosen', () => {
    expect(
      signatureRequestState({
        ...request,
        requestedUserName: null,
        requestedUserId: null,
      }),
    ).toBe('unassigned')
  })

  it('is awaiting submission on a live notebook and requested once submitted', () => {
    expect(signatureRequestState(request, { revisionId: null })).toBe(
      'awaiting',
    )
    expect(signatureRequestState(request, { revisionId: 'rev-1' })).toBe(
      'requested',
    )
  })

  it('is signed when the requested person signed the revision being read', () => {
    expect(
      signatureRequestState(request, {
        revisionId: 'rev-1',
        signatures: [signature({ revision_id: 'rev-1' })],
      }),
    ).toBe('signed')
  })

  it('flags a signature recorded against a revision that is no longer current', () => {
    expect(
      signatureRequestState(request, {
        revisionId: 'rev-2',
        signatures: [signature({ revision_id: 'rev-1' })],
      }),
    ).toBe('changed')
  })

  it('marks the request when the referenced revision has been amended', () => {
    expect(
      signatureRequestState(request, {
        revisionId: 'rev-1',
        supersededByRevisionId: 'rev-2',
        signatures: [signature({ revision_id: 'rev-1' })],
      }),
    ).toBe('superseded')
  })

  it('matches by the captured name when no member id was resolved', () => {
    const byName = { ...request, requestedUserId: null }
    expect(
      signatureRequestState(byName, {
        revisionId: 'rev-1',
        signatures: [signature({ signer_name: 'ada lovelace' })],
      }),
    ).toBe('signed')
    expect(
      signatureRequestState(byName, {
        revisionId: 'rev-1',
        signatures: [signature({ signer_name: 'Someone Else' })],
      }),
    ).toBe('requested')
  })
})

describe('corrective actions payload', () => {
  it('accepts a list and rejects a non-array items field', () => {
    const payload: CorrectiveActionsPayload = {
      items: [
        {
          id: 'CAPA-1',
          action: 'Repeat the reading',
          ownerUserId: null,
          ownerName: 'Gareth P.',
          due: '2026-10-03',
          status: 'in-progress',
        },
      ],
    }
    expect(validateCorrectiveActions(payload)).toEqual([])
    expect(isCorrectiveActionsPayload(payload)).toBe(true)
    expect(validateCorrectiveActions({ items: 'nope' })).toHaveLength(1)
    expect(
      validateCorrectiveActions({
        items: [{ action: 'x', status: 'nonsense' }],
      }),
    ).toHaveLength(1)
  })

  it('reports the missing owner reference rather than inventing one', () => {
    expect(
      correctiveActionOwner({
        id: 'CAPA-1',
        action: 'x',
        ownerUserId: null,
        ownerName: null,
        due: null,
        status: 'open',
      }),
    ).toEqual({ label: 'No owner', missing: true })
    expect(
      correctiveActionOwner({
        id: 'CAPA-1',
        action: 'x',
        ownerUserId: 'u-1',
        ownerName: 'Ada',
        due: null,
        status: 'open',
      }),
    ).toEqual({ label: 'Ada', missing: false })
  })

  it('summarises by status and counts what is unowned', () => {
    expect(
      correctiveActionsSummary({
        items: [
          {
            id: 'a',
            action: '',
            ownerUserId: null,
            ownerName: 'A',
            due: null,
            status: 'open',
          },
          {
            id: 'b',
            action: '',
            ownerUserId: null,
            ownerName: null,
            due: null,
            status: 'in-progress',
          },
          {
            id: 'c',
            action: '',
            ownerUserId: null,
            ownerName: 'C',
            due: null,
            status: 'done',
          },
        ],
      }),
    ).toEqual({ open: 1, inProgress: 1, done: 1, void: 0, unowned: 1 })
  })
})

describe('outline projections from the same blocks', () => {
  it('lists a required section that a block title satisfies and flags the missing one', () => {
    const blocks = [block('rich_text', { title: 'Materials' })]
    expect(requiredSectionChecklist(blocks, ['Materials', 'Method'])).toEqual([
      { label: 'Materials', state: 'present' },
      { label: 'Method', state: 'missing' },
    ])
  })

  it('counts a heading in a rich_text block as a present section', () => {
    const blocks = [
      block('rich_text', {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Result summary' }],
            },
          ],
        },
      }),
    ]
    expect(requiredSectionChecklist(blocks, ['result summary'])).toEqual([
      { label: 'result summary', state: 'present' },
    ])
  })

  it('returns nothing when the record type requires no sections', () => {
    expect(requiredSectionChecklist([block('rich_text', {})], [])).toEqual([])
  })

  it('builds the requested-signature table from the request blocks', () => {
    const blocks = [
      block('signature_request', {
        requestedUserId: null,
        requestedUserName: 'Ada Lovelace',
        meaning: 'reviewed-and-approved',
        note: '',
      }),
      block('signature_request', {
        requestedUserId: null,
        requestedUserName: null,
        meaning: 'witnessed',
        note: '',
      }),
      block('rich_text', { title: 'Not a request' }),
    ]
    const rows = requestedSignatureRows(blocks, {
      revisionId: 'rev-1',
      signatures: [],
    })
    expect(rows).toEqual([
      {
        blockId: rows[0].blockId,
        signerLabel: 'Ada Lovelace',
        meaning: 'reviewed-and-approved',
        state: 'requested',
        statusLabel: 'Not signed yet',
      },
      {
        blockId: rows[1].blockId,
        signerLabel: 'No signer chosen',
        meaning: 'witnessed',
        state: 'unassigned',
        statusLabel: 'No signer chosen',
      },
    ])
  })
})
