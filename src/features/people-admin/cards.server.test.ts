import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import { context } from '#/lib/assistant-admin-cards.fixture'

import {
  CLIENT_ARCHIVE_TOOL,
  CLIENT_MESSAGE_TOOL,
  CLIENT_RENAME_TOOL,
  INVITATION_REISSUE_TOOL,
  MEMBER_USERNAME_TOOL,
  PEOPLE_ADMIN_PROPOSE_TOOL_NAMES,
  SESSION_REVOKE_TOOL,
} from './cards'
import {
  buildPeopleAdminProposal,
  peopleAdminProposalDefs,
} from './cards.server'

const base = { title: 'T', summary: 'S' }
const ada = { user_id: 'u1', name: 'Ada Lovelace', role: 'scientist' }

const acme = {
  id: 'c1',
  code: 'ACME',
  name: 'Acme Bio',
  archived_at: null,
}

describe('the people and client cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      peopleAdminProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([...PEOPLE_ADMIN_PROPOSE_TOOL_NAMES])

    for (const name of PEOPLE_ADMIN_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('sends a pending invitation again, with how long the new link works', async () => {
    const result = await buildPeopleAdminProposal(
      INVITATION_REISSUE_TOOL,
      { ...base, email: 'sam@example.com' },
      context({
        workspace_invitations: [
          {
            id: 'i1',
            email: 'sam@example.com',
            status: 'expired',
            role: 'member',
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'people_admin.reissue_invitation',
      params: {
        p_workspace_id: 'ws',
        p_invitation_id: 'i1',
        p_expires_after_days: 7,
      },
      openHref: '/settings/workspace/members',
    })
  })

  it('ends the one session a member has', async () => {
    const result = await buildPeopleAdminProposal(
      SESSION_REVOKE_TOOL,
      { ...base, person: 'Ada' },
      context({
        workspace_members_list: [ada],
        list_workspace_sessions: [
          {
            id: 's1',
            user_id: 'u1',
            user_name: 'Ada Lovelace',
            ip_address: '10.0.0.1',
            user_agent: 'Firefox',
            created_at: '2026-11-20T10:00:00Z',
          },
          {
            id: 's9',
            user_id: 'u2',
            user_name: 'Someone else',
            ip_address: null,
            user_agent: null,
            created_at: '2026-11-20T10:00:00Z',
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      params: { p_workspace_id: 'ws', p_session_id: 's1' },
    })
  })

  it('asks which session when a member has several, and takes a hint', async () => {
    const sessions = [
      {
        id: 's1',
        user_id: 'u1',
        user_name: 'Ada Lovelace',
        ip_address: '10.0.0.1',
        user_agent: 'Firefox',
        created_at: '2026-11-20T10:00:00Z',
      },
      {
        id: 's2',
        user_id: 'u1',
        user_name: 'Ada Lovelace',
        ip_address: '10.0.0.2',
        user_agent: 'Safari',
        created_at: '2026-11-21T10:00:00Z',
      },
    ]

    const tables = {
      workspace_members_list: [ada],
      list_workspace_sessions: sessions,
    }

    const several = await buildPeopleAdminProposal(
      SESSION_REVOKE_TOOL,
      { ...base, person: 'Ada' },
      context(tables),
    )

    expect(several.ok).toBe(false)

    const hinted = await buildPeopleAdminProposal(
      SESSION_REVOKE_TOOL,
      { ...base, person: 'Ada', device: 'safari' },
      context(tables),
    )

    if (!hinted.ok) throw new Error(hinted.message)
    expect(hinted.proposal.action).toMatchObject({
      params: { p_session_id: 's2' },
    })
  })

  it('lowercases a username and shows the old one', async () => {
    const result = await buildPeopleAdminProposal(
      MEMBER_USERNAME_TOOL,
      { ...base, person: 'Ada', username: 'Ada.L' },
      context({
        workspace_members_list: [ada],
        workspace_memberships: [{ username: 'ada' }],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.changes).toEqual([
      { label: 'Username', before: 'ada', after: 'ada.l' },
    ])
    expect(result.proposal.action).toMatchObject({
      params: { p_user_id: 'u1', p_username: 'ada.l' },
    })
  })

  it('renames and archives a client found by code', async () => {
    const renamed = await buildPeopleAdminProposal(
      CLIENT_RENAME_TOOL,
      { ...base, client: 'ACME', name: 'Acme Biologics' },
      context({ clients: [acme] }),
    )

    if (!renamed.ok) throw new Error(renamed.message)
    expect(renamed.proposal.action).toMatchObject({
      params: { p_client_id: 'c1', p_name: 'Acme Biologics' },
    })

    const archived = await buildPeopleAdminProposal(
      CLIENT_ARCHIVE_TOOL,
      { ...base, client: 'Acme', archived: true },
      context({ clients: [acme] }),
    )

    if (!archived.ok) throw new Error(archived.message)
    expect(archived.proposal.action).toMatchObject({
      params: { p_client_id: 'c1', p_archived: true },
    })
  })

  it('posts to a client portal, about one of their projects', async () => {
    const result = await buildPeopleAdminProposal(
      CLIENT_MESSAGE_TOOL,
      {
        ...base,
        client: 'Acme',
        project: 'PRJ-0008',
        body: 'Your report is ready.',
      },
      context({
        clients: [acme],
        projects: [
          { id: 'p1', title: 'Assay', key: 'ASSAY', display_id: 'PRJ-0008' },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'people_admin.client_message',
      params: {
        p_client_id: 'c1',
        p_project_id: 'p1',
        p_body: 'Your report is ready.',
      },
    })
  })
})
