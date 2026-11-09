import { describe, expect, it, vi } from 'vitest'
import type { core } from 'zod'

import { PROJECTS_PROPOSE_TOOL_NAMES } from './cards'
import { runProjectsAction } from './cards-run'
import {
  buildProjectsProposal,
  isProjectsProposalTool,
  projectsProposalDefs,
} from './cards.server'
import {
  PROJECTS_LAB_AREAS,
  listProjectsArea,
  runProjectsReadTool,
} from './reads.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { DataClient } from '#/lib/data-client'
import { createDataClient } from '#/lib/data-client'

const WS = '44444444-4444-4444-8444-444444444444'
const base = { title: 'T', summary: 'S' }

type Rows = Partial<
  Record<string, core.util.JSONType[] | ((q: string) => core.util.JSONType[])>
>

const project = {
  id: 'p1',
  title: 'Vaccine B',
  key: 'vaccine-b',
  display_id: 'PRJ-1',
  revision: 4,
  archived_at: null,
}

function context(rows: Rows, rpcs: Record<string, core.util.JSONType> = {}) {
  const calls: string[] = []

  const fetchFixture: typeof fetch = async (input) => {
    const target = input instanceof Request ? input.url : input
    const url = new URL(target, 'http://localhost')
    const name = url.pathname.split('/').at(-1) ?? ''

    if (url.pathname.includes('/rpc/')) {
      return Response.json(
        name in rpcs
          ? rpcs[name]
          : name === 'workspace_members_list'
            ? [{ user_id: 'u2', name: 'Ada Lovelace', role: 'scientist' }]
            : [],
      )
    }

    calls.push(`${name}${url.search}`)
    const source = rows[name]

    return Response.json(
      Array.isArray(source) ? source : (source?.(url.search) ?? []),
    )
  }

  const client = createDataClient(fetchFixture)

  return {
    ctx: {
      client,
      workspaceId: WS,
      userId: 'me',
      timeZone: 'Europe/London',
    } satisfies LabToolContext,
    calls,
  }
}

describe('project and folder cards', () => {
  it('rejects malformed proposal input for every tool', async () => {
    for (const name of PROJECTS_PROPOSE_TOOL_NAMES) {
      if (!isProjectsProposalTool(name)) throw new Error(`Unknown tool ${name}`)
      expect(
        (await buildProjectsProposal(name, null, context({}).ctx)).ok,
      ).toBe(false)
    }
  })

  it('rejects malformed project read input without querying', async () => {
    const { ctx, calls } = context({})

    const result = await runProjectsReadTool(
      'sheetbase.projects.read',
      { area: 42 },
      ctx,
    )

    expect(result.isError).toBe(true)
    expect(calls).toEqual([])
  })

  it('offers a definition for every tool the operations declare', () => {
    const defs = projectsProposalDefs().map((def) =>
      def.name.replaceAll('__', '.'),
    )

    expect([...defs].sort()).toEqual([...PROJECTS_PROPOSE_TOOL_NAMES].sort())
    expect(PROJECTS_PROPOSE_TOOL_NAMES).toHaveLength(15)

    for (const name of PROJECTS_PROPOSE_TOOL_NAMES) {
      expect(isProjectsProposalTool(name)).toBe(true)
    }
  })

  it('edits a project with the revision it read, and names the new lead', async () => {
    const { ctx } = context({ projects: [project] })
    expect(
      await buildProjectsProposal(
        'sheetbase.project.update',
        { ...base, project: 'Vaccine B', name: 'Vaccine C', lead: 'Ada' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        target: 'PRJ-1 Vaccine B',
        changes: [
          { label: 'Name', before: 'Vaccine B', after: 'Vaccine C' },
          { label: 'Lead', after: 'Ada Lovelace' },
        ],
        action: {
          kind: 'project.update',
          projectId: 'p1',
          expectedRevision: 4,
          fields: { p_title: 'Vaccine C', p_lead_user_id: 'u2' },
        },
      },
    })
  })

  it('refuses an edit that changes nothing', async () => {
    const { ctx } = context({ projects: [project] })
    expect(
      await buildProjectsProposal(
        'sheetbase.project.update',
        { ...base, project: 'Vaccine B', name: 'Vaccine B' },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('archives only active projects and restores only archived ones', async () => {
    const { ctx, calls } = context({ projects: [project] })
    expect(
      await buildProjectsProposal(
        'sheetbase.project.archive',
        { ...base, project: 'PRJ-1' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'project.archive', projectId: 'p1' } },
    })
    expect(calls[0]).toContain('archived_at=is.null')
    const archived = context({ projects: [] })
    expect(
      await buildProjectsProposal(
        'sheetbase.project.restore',
        { ...base, project: 'Vaccine B' },
        archived.ctx,
      ),
    ).toMatchObject({ ok: false })
    expect(archived.calls[0]).toContain('archived_at=not.is.null')
  })

  it('moves a record to another project with its metadata version', async () => {
    const { ctx } = context({
      records: [
        {
          id: 'r1',
          identifier: 'EXP-12',
          title: 'Titration',
          project_id: 'p0',
          folder_id: null,
          metadata_version: 7,
        },
      ],
      projects: (q) =>
        q.startsWith('?id=eq.p0')
          ? [{ title: 'Old', display_id: 'PRJ-0' }]
          : [project],
    })

    expect(
      await buildProjectsProposal(
        'sheetbase.record.move_project',
        { ...base, record: 'EXP-12', project: 'Vaccine B' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        changes: [
          { label: 'Project', before: 'PRJ-0 Old', after: 'PRJ-1 Vaccine B' },
        ],
        action: {
          kind: 'record.move_project',
          recordId: 'r1',
          projectId: 'p1',
          expectedMetadataVersion: 7,
        },
      },
    })
  })

  it('will not delete a folder that still holds records', async () => {
    const full = context({
      projects: [project],
      folders: [{ id: 'f1', name: 'Assays', identifier: 'FLD-1' }],
      records: [{ id: 'r1' }],
    })

    expect(
      await buildProjectsProposal(
        'sheetbase.folder.delete',
        { ...base, project: 'Vaccine B', folder: 'Assays' },
        full.ctx,
      ),
    ).toMatchObject({ ok: false })

    const empty = context({
      projects: [project],
      folders: [{ id: 'f1', name: 'Assays', identifier: 'FLD-1' }],
      records: [],
    })

    expect(
      await buildProjectsProposal(
        'sheetbase.folder.delete',
        { ...base, project: 'Vaccine B', folder: 'Assays' },
        empty.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'folder.delete', folderId: 'f1' } },
    })
  })

  it('files records of the project in a folder, or takes them out', async () => {
    const { ctx, calls } = context({
      projects: [project],
      folders: [{ id: 'f1', name: 'Assays', identifier: 'FLD-1' }],
      records: [
        {
          id: 'r1',
          identifier: 'EXP-1',
          title: 'A',
          project_id: 'p1',
          metadata_version: 1,
        },
      ],
    })

    expect(
      await buildProjectsProposal(
        'sheetbase.folder.move_records',
        { ...base, project: 'Vaccine B', records: ['EXP-1'], folder: 'Assays' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'folder.move_records',
          projectId: 'p1',
          recordIds: ['r1'],
          folderId: 'f1',
        },
      },
    })
    expect(calls.some((call) => call.includes('project_id=eq.p1'))).toBe(true)

    const out = context({
      projects: [project],
      records: [
        {
          id: 'r1',
          identifier: 'EXP-1',
          title: 'A',
          project_id: 'p1',
          metadata_version: 1,
        },
      ],
    })

    expect(
      await buildProjectsProposal(
        'sheetbase.folder.move_records',
        { ...base, project: 'Vaccine B', records: ['EXP-1'] },
        out.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { folderId: null } },
    })
  })

  it('files a dataset in a folder by name', async () => {
    const { ctx } = context({
      projects: [project],
      folders: [{ id: 'f1', name: 'Assays', identifier: 'FLD-1' }],
      datasets: [{ id: 'd1', name: 'Plate reads' }],
    })

    expect(
      await buildProjectsProposal(
        'sheetbase.folder.move_items',
        {
          ...base,
          project: 'Vaccine B',
          folder: 'Assays',
          items: [{ kind: 'dataset', name: 'Plate reads' }],
        },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'folder.move_items',
          items: [{ kind: 'dataset', id: 'd1' }],
          folderId: 'f1',
        },
      },
    })
  })

  it('follows a record once', async () => {
    const records = [
      {
        id: 'r1',
        identifier: 'EXP-1',
        title: 'A',
        project_id: 'p1',
        metadata_version: 1,
      },
    ]

    const following = context({ records, work_item_follows: [{ id: 'w1' }] })
    expect(
      await buildProjectsProposal(
        'sheetbase.record.follow',
        { ...base, record: 'EXP-1' },
        following.ctx,
      ),
    ).toMatchObject({ ok: false })
    expect(
      await buildProjectsProposal(
        'sheetbase.record.unfollow',
        { ...base, record: 'EXP-1' },
        following.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'record.unfollow', recordId: 'r1' } },
    })
  })

  it('revokes a SQL login by its name, never one already revoked', async () => {
    const { ctx } = context(
      {},
      {
        list_sql_logins: [
          { id: 'l1', name: 'Laptop', username: 'sb_l1', status: 'revoked' },
          { id: 'l2', name: 'Laptop 2', username: 'sb_l2', status: 'active' },
        ],
      },
    )

    expect(
      await buildProjectsProposal(
        'sheetbase.sql_login.revoke',
        { ...base, login: 'laptop' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'sql_login.revoke', workspaceId: WS, loginId: 'l2' },
      },
    })
  })

  it('offers the audit check with the last result on the card', async () => {
    const { ctx } = context(
      {},
      {
        audit_verification_status: {
          ok: true,
          checkedAt: '2026-11-08T02:00:00Z',
        },
      },
    )

    expect(
      await buildProjectsProposal('sheetbase.audit.verify', base, ctx),
    ).toMatchObject({
      ok: true,
      proposal: {
        changes: [{ before: '2026-11-08, everything held' }],
        action: { kind: 'audit.verify', workspaceId: WS },
      },
    })
  })
})

describe('running project and folder cards', () => {
  it('calls the ordinary RPCs as the person', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'p9' })
    const client: DataClient = { ...createDataClient(), rpc }
    expect(
      await runProjectsAction(client, {
        kind: 'project.copy',
        sourceId: 'p1',
        expectedRevision: 4,
        name: 'Vaccine D',
        fields: { p_stage: 'discovery' },
      }),
    ).toEqual({ openHref: '/projects/p9' })
    expect(rpc).toHaveBeenCalledWith('create_project_from_structure', {
      p_source_project_id: 'p1',
      p_expected_source_revision: 4,
      p_title: 'Vaccine D',
      p_stage: 'discovery',
    })
    await runProjectsAction(client, {
      kind: 'project.restore',
      projectId: 'p1',
    })
    expect(rpc).toHaveBeenLastCalledWith('unarchive_project', {
      p_project_id: 'p1',
    })
    await runProjectsAction(client, {
      kind: 'folder.move_items',
      projectId: 'p1',
      items: [{ kind: 'dataset', id: 'd1' }],
      folderId: null,
    })
    expect(rpc).toHaveBeenLastCalledWith('move_to_folder', {
      p_items: [{ kind: 'dataset', id: 'd1' }],
      p_folder_id: null,
    })
  })
})

describe('project reads for the assistant', () => {
  it('answers only its own areas', async () => {
    const { ctx } = context({})
    expect(await listProjectsArea({ area: 'shipments' }, ctx)).toBeNull()
    expect(Object.keys(PROJECTS_LAB_AREAS)).toContain('audit_log')
  })

  it('lists projects, leaving out archived ones when asked', async () => {
    const { ctx } = context(
      {},
      {
        project_list_summary: [
          {
            ...project,
            client_name: null,
            record_count: 3,
            experiment_count: 1,
          },
          {
            ...project,
            id: 'p2',
            title: 'Old',
            archived_at: '2026-01-01',
            client_name: null,
            record_count: 0,
            experiment_count: 0,
          },
        ],
      },
    )

    const answer = JSON.parse(
      (await listProjectsArea({ area: 'projects', openOnly: true }, ctx))!,
    )

    expect(answer.items).toHaveLength(1)
    expect(answer.items[0]).toMatchObject({ id: 'p1', records: 3 })
  })
})
