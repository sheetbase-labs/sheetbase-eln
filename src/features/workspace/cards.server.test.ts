import { describe, expect, it, vi } from 'vitest'

import { WORKSPACE_PROPOSE_TOOL_NAMES } from './cards'
import { runWorkspaceAction } from './cards-run'
import {
  buildWorkspaceProposal,
  isWorkspaceProposalTool,
  workspaceProposalDefs,
} from './cards.server'
import { runWorkspaceReadTool } from './reads.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { DataClient } from '#/lib/data-client'

const WS = '44444444-4444-4444-8444-444444444444'
const CONFLICT = '55555555-5555-4555-8555-555555555555'
const base = { title: 'T', summary: 'S' }

function context(
  rows: Record<string, Array<Record<string, unknown>>>,
  rpcs: Record<string, unknown> = {},
): LabToolContext {
  const client = {
    list: (resource: string) => Promise.resolve(rows[resource] ?? []),
    rpc: (name: string) => Promise.resolve(rpcs[name] ?? []),
  } as unknown as DataClient
  return { client, workspaceId: WS, userId: 'me', timeZone: 'Europe/London' }
}

describe('workspace cards', () => {
  it('offers a definition for every tool the operations declare', () => {
    const defs = workspaceProposalDefs().map((def) =>
      def.name.replaceAll('__', '.'),
    )
    expect([...defs].sort()).toEqual([...WORKSPACE_PROPOSE_TOOL_NAMES].sort())
    expect(WORKSPACE_PROPOSE_TOOL_NAMES).toHaveLength(5)
    for (const name of WORKSPACE_PROPOSE_TOOL_NAMES)
      expect(isWorkspaceProposalTool(name)).toBe(true)
  })

  it('shows the domains before and after', async () => {
    const outcome = await buildWorkspaceProposal(
      'sheetbase.workspace.join_domains',
      { ...base, domains: ['Example.com '], role: 'viewer' },
      context({
        workspace_join_domains: [{ domain: 'old.org', role: 'scientist' }],
      }),
    )
    expect(outcome).toMatchObject({
      ok: true,
      proposal: {
        changes: [
          { label: 'Domains', before: 'old.org', after: 'example.com' },
          { label: 'Join as', before: 'scientist', after: 'viewer' },
        ],
        action: {
          kind: 'workspace.join_domains',
          domains: ['example.com'],
          role: 'viewer',
        },
      },
    })
  })

  it('refuses to switch the regulated-lab rules to what they already are', async () => {
    const outcome = await buildWorkspaceProposal(
      'sheetbase.workspace.regulated_lab',
      { ...base, regulated: true },
      context({ workspace_settings: [{ regulated_lab: true }] }),
    )
    expect(outcome.ok).toBe(false)
  })

  it('keeps the offline edit of an open conflict', async () => {
    const outcome = await buildWorkspaceProposal(
      'sheetbase.sheet.resolve_conflict',
      { ...base, conflict: CONFLICT, keep: 'mine', reason: 'Checked' },
      context({
        sheet_cell_conflicts: [
          {
            id: CONFLICT,
            sheet_instance_id: 's1',
            row_key: '3',
            state: 'open',
            local_value: 4.2,
            remote_value: 4.1,
          },
        ],
        sheet_instances: [{ name: 'Plate 1' }],
      }),
    )
    expect(outcome).toMatchObject({
      ok: true,
      proposal: {
        target: 'Plate 1, row 3',
        action: { kind: 'sheet.resolve_conflict', value: 4.2 },
      },
    })
  })

  it('wants one workstream or one task under a study', async () => {
    const outcome = await buildWorkspaceProposal(
      'sheetbase.study.assign_item',
      { ...base, study: 'STU-1' },
      context({}),
    )
    expect(outcome.ok).toBe(false)
  })

  it('runs a card as the person, through the ordinary call', async () => {
    const rpc = vi.fn().mockResolvedValue({})
    const client = { rpc } as unknown as DataClient
    expect(
      await runWorkspaceAction(client, {
        kind: 'workspace.regulated_lab',
        workspaceId: WS,
        regulated: false,
      }),
    ).toEqual({ openHref: '/settings/workspace' })
    expect(rpc).toHaveBeenCalledWith('set_regulated_lab', {
      p_workspace_id: WS,
      p_regulated: false,
    })
  })

  it('reads what the person may do', async () => {
    const result = await runWorkspaceReadTool(
      'sheetbase.workspace.read',
      { area: 'capabilities' },
      context({}, { list_capabilities: ['schema.edit'] }),
    )
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.text).items).toEqual(['schema.edit'])
  })
})
