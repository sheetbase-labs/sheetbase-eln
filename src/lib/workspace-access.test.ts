import { describe, expect, it } from 'vitest'

import { createDataClient } from './data-client'
import {
  fetchWorkspaceAccessRules,
  setProjectAccessRule,
  setWorkspaceGroupMember,
} from './workspace-access'

const projectId = '00000000-0000-4000-8000-000000009203'
const groupId = '00000000-0000-4000-8000-000000009204'

describe('workspace access boundary', () => {
  it('sends independent rule flags and exactly one principal to the canonical RPC', async () => {
    const requests: { path: string; body: unknown }[] = []
    const client = createDataClient(async (path, init) => {
      requests.push({
        path: String(path),
        body: JSON.parse(String(init?.body)),
      })
      return Response.json(null)
    })
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
})
