import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createDataClient } from './data-client'
import {
  fetchProjectAccessRequests,
  fetchWorkspaceAccessRules,
  requestProjectEditAccess,
  setProjectAccessRule,
  setWorkspaceGroupMember,
} from './workspace-access'

/** What the client sent: the transport's path string and its JSON body. */
function captured(requests: { path: string; body: unknown }[]) {
  return async (path: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      path: z.string().parse(path),
      body: JSON.parse(z.string().parse(init?.body)),
    })

    return Response.json(null)
  }
}

const projectId = '00000000-0000-4000-8000-000000009203'
const groupId = '00000000-0000-4000-8000-000000009204'
const requestId = '00000000-0000-4000-8000-000000009207'

describe('workspace access boundary', () => {
  it('sends independent rule flags and exactly one principal to the canonical RPC', async () => {
    const requests: { path: string; body: unknown }[] = []

    const client = createDataClient(captured(requests))

    await setProjectAccessRule(client, {
      projectId,
      principal: { kind: 'group', groupId },
      can_view: false,
      can_edit: true,
      can_review: false,
      client_portal: false,
      can_manage: false,
    })
    await setWorkspaceGroupMember(client, {
      groupId,
      userId: 'scientist',
      isMember: false,
    })
    expect(requests).toEqual([
      {
        path: '/api/db/rpc/set_project_access_rule',
        body: {
          p_project_id: projectId,
          p_user_id: null,
          p_group_id: groupId,
          p_can_view: false,
          p_can_edit: true,
          p_can_review: false,
          p_client_portal: false,
          p_can_manage: false,
        },
      },
      {
        path: '/api/db/rpc/set_workspace_group_member',
        body: {
          p_group_id: groupId,
          p_user_id: 'scientist',
          p_is_member: false,
        },
      },
    ])
  })

  it('rejects an ambiguous principal at ingress instead of displaying an overgrant', async () => {
    const client = createDataClient(async () =>
      Response.json([
        {
          id: '00000000-0000-4000-8000-000000009205',
          project_id: projectId,
          user_id: 'scientist',
          group_id: groupId,
          principal_name: 'Ambiguous',
          can_view: true,
          can_edit: false,
          can_review: true,
          client_portal: false,
          can_manage: false,
        },
      ]),
    )

    await expect(fetchWorkspaceAccessRules(client)).rejects.toThrow(
      'A project rule must name exactly one user or group.',
    )
  })

  it('asks the canonical RPC for edit access and grants nothing', async () => {
    const requests: { path: string; body: unknown }[] = []

    // The RPC returns the created request; it starts pending, never granted.
    const client = createDataClient(async (path, init) => {
      requests.push({
        path: z.string().parse(path),
        body: JSON.parse(z.string().parse(init?.body)),
      })

      return Response.json({
        id: requestId,
        project_id: projectId,
        status: 'pending',
      })
    })

    await requestProjectEditAccess(client, {
      projectId,
      reason: '  QA verification of the turbidity repeat  ',
    })
    expect(requests).toEqual([
      {
        path: '/api/db/rpc/request_project_edit_access',
        body: {
          p_project_id: projectId,
          p_reason: 'QA verification of the turbidity repeat',
        },
      },
    ])
  })

  it('surfaces the request RPC’s refusal instead of claiming success', async () => {
    const client = createDataClient(async () =>
      Response.json(
        {
          error: {
            category: 'permission_denied',
            message: 'Readable project and workspace writer required',
          },
        },
        { status: 403 },
      ),
    )

    await expect(
      requestProjectEditAccess(client, { projectId, reason: 'Need access' }),
    ).rejects.toThrow('Readable project and workspace writer required')
  })

  it('reads a decided request’s attribution from the requests table', async () => {
    let seen = ''

    const client = createDataClient(async (path) => {
      seen = z.string().parse(path)

      return Response.json([
        {
          id: requestId,
          project_id: projectId,
          user_id: 'scientist',
          reason: 'Need to attach the calibration certificate',
          status: 'approved',
          created_at: '2026-09-20T09:00:00Z',
          updated_at: '2026-09-21T10:30:00Z',
          decided_by_user_id: 'lead',
        },
      ])
    })

    const rows = await fetchProjectAccessRequests(client)
    expect(seen).toContain('/api/db/project_access_requests?select=')
    expect(seen).toContain('decided_by_user_id')
    expect(rows).toEqual([
      expect.objectContaining({
        id: requestId,
        status: 'approved',
        decided_by_user_id: 'lead',
        updated_at: '2026-09-21T10:30:00Z',
      }),
    ])
  })
})
