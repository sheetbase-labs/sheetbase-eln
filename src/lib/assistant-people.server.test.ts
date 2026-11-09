import { describe, expect, it, vi } from 'vitest'

import { PEOPLE_PROPOSE_TOOL_NAMES } from './assistant-people'
import { runPeopleAction } from './assistant-people-run'
import {
  buildPeopleProposal,
  isPeopleProposalTool,
  peopleProposalDefs,
} from './assistant-people.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const WS = '33333333-3333-4333-8333-333333333333'
const base = { title: 'T', summary: 'S' }

type Rows = Partial<
  Record<string, Array<Record<string, unknown>> | ((q: string) => unknown[])>
>

const members = [
  { user_id: 'me', name: 'Gareth Price', role: 'owner' },
  { user_id: 'u2', name: 'Ada Lovelace', role: 'scientist' },
  { user_id: 'u3', name: 'Ada Yonath', role: 'viewer' },
]

function context(rows: Rows): { ctx: LabToolContext; calls: string[] } {
  const calls: string[] = []
  const client = {
    list: (resource: string, query = '') => {
      calls.push(`${resource}${query}`)
      const source = rows[resource]
      return Promise.resolve(
        typeof source === 'function' ? source(query) : (source ?? []),
      )
    },
    rpc: (name: string) =>
      Promise.resolve(name === 'workspace_members_list' ? members : []),
  } as unknown as DataClient
  return {
    ctx: { client, workspaceId: WS, userId: 'me', timeZone: 'Europe/London' },
    calls,
  }
}

describe('people cards', () => {
  it('offers a definition for every tool the operations declare', () => {
    const defs = peopleProposalDefs().map((def) =>
      def.name.replaceAll('__', '.'),
    )
    expect([...defs].sort()).toEqual([...PEOPLE_PROPOSE_TOOL_NAMES].sort())
    for (const name of PEOPLE_PROPOSE_TOOL_NAMES) {
      expect(isPeopleProposalTool(name)).toBe(true)
    }
  })

  it('invites someone with project access and refuses a second invitation', async () => {
    const { ctx } = context({
      workspace_invitations: [],
      projects: [{ id: 'p1', title: 'Vaccine B' }],
    })
    expect(
      await buildPeopleProposal(
        'sheetbase.member.invite',
        {
          ...base,
          email: 'New@Lab.org',
          role: 'scientist',
          projects: [{ project: 'Vaccine B', access: 'editor' }],
        },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'member.invite',
          email: 'new@lab.org',
          role: 'scientist',
          projectGrants: [{ project_id: 'p1', access_level: 'editor' }],
        },
      },
    })
    const waiting = context({ workspace_invitations: [{ id: 'i1' }] })
    expect(
      await buildPeopleProposal(
        'sheetbase.member.invite',
        { ...base, email: 'new@lab.org' },
        waiting.ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('needs a client for a client viewer', async () => {
    const { ctx } = context({ workspace_invitations: [] })
    expect(
      await buildPeopleProposal(
        'sheetbase.member.invite',
        { ...base, email: 'a@b.co', clientViewer: true },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('changes a role, and says when nothing changes', async () => {
    const { ctx } = context({})
    expect(
      await buildPeopleProposal(
        'sheetbase.member.set_role',
        { ...base, member: 'Lovelace', role: 'reviewer' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'member.role', userId: 'u2', role: 'reviewer' },
        changes: [{ before: 'Scientist', after: 'Reviewer' }],
      },
    })
    expect(
      await buildPeopleProposal(
        'sheetbase.member.set_role',
        { ...base, member: 'Lovelace', role: 'scientist' },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('asks which person when a name matches two', async () => {
    const { ctx } = context({})
    const result = await buildPeopleProposal(
      'sheetbase.member.suspend',
      { ...base, member: 'Ada' },
      ctx,
    )
    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain('Ada Lovelace')
  })

  it('will not suspend or remove the person asking', async () => {
    const { ctx } = context({})
    expect(
      await buildPeopleProposal(
        'sheetbase.member.remove',
        { ...base, member: 'Gareth Price' },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('grants project access at a level', async () => {
    const { ctx } = context({
      projects: [{ id: 'p1', title: 'Vaccine B' }],
      project_access: [],
    })
    expect(
      await buildPeopleProposal(
        'sheetbase.project_access.grant',
        { ...base, member: 'Yonath', project: 'vaccine b', access: 'viewer' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'access.grant',
          projectId: 'p1',
          userId: 'u3',
          level: 'viewer',
        },
      },
    })
  })

  it('decides the one request waiting', async () => {
    const waiting = context({
      project_access_requests: [
        { id: 'rq1', project_id: 'p1', reason: 'Running assays' },
      ],
      projects: [{ title: 'Vaccine B' }],
    })
    expect(
      await buildPeopleProposal(
        'sheetbase.project_access.decide',
        { ...base, member: 'Yonath', approve: true },
        waiting.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'access.decide', requestId: 'rq1', approve: true },
      },
    })
    const none = context({ project_access_requests: [] })
    expect(
      await buildPeopleProposal(
        'sheetbase.project_access.decide',
        { ...base, member: 'Yonath', approve: true },
        none.ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('refuses to make a group that already exists', async () => {
    const same = context({ workspace_groups: [{ id: 'g1' }] })
    expect(
      await buildPeopleProposal(
        'sheetbase.group.create',
        { ...base, name: 'Assay team' },
        same.ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('proposes deleting a group behind a card', async () => {
    const { ctx } = context({
      workspace_groups: [{ id: 'g1', name: 'Assay team' }],
    })
    expect(
      await buildPeopleProposal(
        'sheetbase.group.delete',
        { ...base, group: 'Assay team' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'group.delete', groupId: 'g1' } },
    })
  })

  it('shows only what changes in general settings', async () => {
    const { ctx } = context({
      workspace_settings: [
        {
          site: 'Cambridge',
          timezone: 'Europe/London',
          date_format: 'd MMM yyyy',
          number_format: 'decimal',
        },
      ],
    })
    const result = await buildPeopleProposal(
      'sheetbase.workspace.general',
      { ...base, timezone: 'Europe/Paris', site: 'Cambridge' },
      ctx,
    )
    expect(result).toMatchObject({
      ok: true,
      proposal: {
        changes: [
          {
            label: 'Time zone',
            before: 'Europe/London',
            after: 'Europe/Paris',
          },
        ],
        action: { kind: 'workspace.general', site: 'Cambridge' },
      },
    })
  })

  it('shares and unshares a record with a client', async () => {
    const rows: Rows = {
      clients: [{ id: 'c1', code: 'CL-001', name: 'Acme Bio' }],
      records: [{ id: 'r1', identifier: 'EXP-12', title: 'ELISA' }],
    }
    const { ctx } = context(rows)
    expect(
      await buildPeopleProposal(
        'sheetbase.client.share_record',
        { ...base, client: 'Acme', record: 'EXP-12' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'client.share',
          clientId: 'c1',
          recordId: 'r1',
          share: true,
        },
      },
    })
    expect(
      await buildPeopleProposal(
        'sheetbase.client.unshare_record',
        { ...base, client: 'Acme', record: 'EXP-12' },
        ctx,
      ),
    ).toMatchObject({ ok: true, proposal: { action: { share: false } } })
  })

  it('rejects arguments it does not know', async () => {
    const { ctx } = context({})
    expect(
      await buildPeopleProposal(
        'sheetbase.group.create',
        { ...base, name: 'A', extra: 1 },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })
})

describe('running a people card', () => {
  it('calls the ordinary RPC and returns the invitation link once', async () => {
    const rpc = vi.fn((name: string) =>
      Promise.resolve(
        name === 'create_invitation'
          ? {
              id: 'i1',
              workspace_id: WS,
              email: 'a@b.co',
              role: 'scientist',
              status: 'pending',
              expires_at: '2026-12-01T00:00:00Z',
              created_at: '2026-11-09T00:00:00Z',
              created_by_user_id: 'me',
              token: 'tok123',
            }
          : null,
      ),
    )
    const client = { rpc } as unknown as DataClient
    vi.stubGlobal('window', { location: { origin: 'https://lab.example' } })
    const invited = await runPeopleAction(client, {
      kind: 'member.invite',
      workspaceId: WS,
      email: 'a@b.co',
      role: 'scientist',
      clientId: null,
      projectGrants: [],
    })
    expect(invited?.note).toContain('tok123')
    await runPeopleAction(client, {
      kind: 'member.suspend',
      workspaceId: WS,
      userId: 'u2',
    })
    expect(rpc).toHaveBeenCalledWith('suspend_member', {
      p_workspace_id: WS,
      p_user_id: 'u2',
    })
    vi.unstubAllGlobals()
  })
})
