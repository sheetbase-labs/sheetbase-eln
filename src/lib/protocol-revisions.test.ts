import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  PROTOCOL_APPROVER_ROLES,
  approveProtocolRevision,
  chainStage,
  stageRoles,
  submitProtocolRevision,
} from './protocol-revisions'

const WS = '00000000-0000-4000-8000-00000000b700'
const RECORD = '00000000-0000-4000-8000-00000000b701'
const VERSION = '00000000-0000-4000-8000-00000000b702'
const REQUEST = '00000000-0000-4000-8000-00000000b703'

const versionRow = (status: string) => ({
  id: VERSION,
  workspace_id: WS,
  protocol_record_id: RECORD,
  version: 2,
  status,
  effective_at: null,
  review_due_at: null,
  change_summary: 'Tighter hold',
  created_by_user_id: 'author',
  created_at: '2026-08-28T12:00:00Z',
})
const requestRow = (state: string) => ({
  id: REQUEST,
  workspace_id: WS,
  object_kind: 'protocol_revision',
  object_id: VERSION,
  state,
})

/** A fetcher that answers each RPC by name and records the call order. */
function rpcClient(answers: Record<string, unknown>) {
  const calls: { name: string; body: Record<string, unknown> }[] = []
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const name = String(input).split('/rpc/')[1] ?? ''
      calls.push({ name, body: JSON.parse(String(init?.body ?? '{}')) })
      const answer = answers[name]
      if (answer instanceof Error) {
        return new Response(JSON.stringify({ message: answer.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  )
  return { client: createDataClient(fetcher), calls }
}

describe('submitProtocolRevision', () => {
  it('freezes, moves into review and asks for the canonical chain', async () => {
    const { client, calls } = rpcClient({
      create_protocol_version: versionRow('draft'),
      set_protocol_version_status: versionRow('in_review'),
      submit_approval_request: requestRow('pending'),
    })
    const out = await submitProtocolRevision(client, {
      workspaceId: WS,
      protocolRecordId: RECORD,
      changeSummary: '  Tighter hold  ',
    })
    expect(out.versionId).toBe(VERSION)
    expect(calls.map((c) => c.name)).toEqual([
      'create_protocol_version',
      'set_protocol_version_status',
      'submit_approval_request',
    ])
    expect(calls[0]?.body).toMatchObject({
      p_protocol_record_id: RECORD,
      p_change_summary: 'Tighter hold',
      p_reason: null,
    })
    expect(calls[2]?.body).toMatchObject({
      p_object_kind: 'protocol_revision',
      p_object_id: VERSION,
      p_required_approver_roles: [...PROTOCOL_APPROVER_ROLES],
      p_required_approvals: 2,
      p_require_independence: true,
    })
  })

  it('picks up a frozen version instead of freezing a second one', async () => {
    const { client, calls } = rpcClient({
      set_protocol_version_status: versionRow('in_review'),
      submit_approval_request: requestRow('pending'),
    })
    await submitProtocolRevision(client, {
      workspaceId: WS,
      protocolRecordId: RECORD,
      changeSummary: 'Tighter hold',
      existingVersion: { id: VERSION, status: 'draft' },
    })
    expect(calls.map((c) => c.name)).toEqual([
      'set_protocol_version_status',
      'submit_approval_request',
    ])
  })

  it('refuses an empty change summary before calling the server', async () => {
    const { client, calls } = rpcClient({})
    await expect(
      submitProtocolRevision(client, {
        workspaceId: WS,
        protocolRecordId: RECORD,
        changeSummary: '   ',
      }),
    ).rejects.toThrow('Say what changed')
    expect(calls).toHaveLength(0)
  })
})

describe('approveProtocolRevision', () => {
  it('does not release while the chain is incomplete', async () => {
    const { client, calls } = rpcClient({
      approve_approval_request: requestRow('pending'),
    })
    const out = await approveProtocolRevision(client, {
      requestId: REQUEST,
      versionId: VERSION,
    })
    expect(out.effective).toBe(false)
    expect(calls.map((c) => c.name)).toEqual(['approve_approval_request'])
  })

  it('makes the version effective when the last approval lands', async () => {
    const { client, calls } = rpcClient({
      approve_approval_request: requestRow('approved'),
      set_protocol_version_status: versionRow('effective'),
    })
    const out = await approveProtocolRevision(client, {
      requestId: REQUEST,
      versionId: VERSION,
    })
    expect(out.effective).toBe(true)
    expect(calls[1]?.body).toMatchObject({
      p_protocol_version_id: VERSION,
      p_status: 'effective',
    })
  })

  it('keeps the approval and reports why the release was refused', async () => {
    const { client } = rpcClient({
      approve_approval_request: requestRow('approved'),
      set_protocol_version_status: new Error('not allowed'),
    })
    const out = await approveProtocolRevision(client, {
      requestId: REQUEST,
      versionId: VERSION,
    })
    expect(out.request.state).toBe('approved')
    expect(out.effective).toBe(false)
    expect(out.releaseError).toBeTruthy()
  })
})

describe('chain stage', () => {
  it('waits for technical review first, then QA', () => {
    expect(chainStage([], false)).toBe('technical')
    expect(chainStage([{ decision: 'approved', role: 'steward' }], false)).toBe(
      'qa',
    )
    expect(
      chainStage([{ decision: 'approved', role: 'reviewer' }], false),
    ).toBe('technical')
    expect(chainStage([], true)).toBe('complete')
    expect(stageRoles('technical')).toContain('scientist')
    expect(stageRoles('qa')).toContain('reviewer')
    expect(stageRoles('complete')).toEqual([])
  })
})
