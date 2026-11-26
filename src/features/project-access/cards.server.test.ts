import { describe, expect, it } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import { context } from '#/lib/assistant-admin-cards.fixture'

import {
  PROJECT_ACCESS_PROPOSE_TOOL_NAMES,
  PROJECT_ACCESS_RPC,
  PROJECT_REMOVE_MEMBER_TOOL,
  PROJECT_REMOVE_RULE_TOOL,
  PROJECT_REQUEST_EDIT_TOOL,
  PROJECT_SET_DEFAULTS_TOOL,
  PROJECT_SET_MEMBER_TOOL,
  PROJECT_SET_REVIEW_RULES_TOOL,
  PROJECT_SET_RULE_TOOL,
} from './cards'
import { runProjectAccessAction } from './cards-run'
import {
  buildProjectAccessProposal,
  projectAccessProposalDefs,
} from './cards.server'

const base = { title: 'T', summary: 'S' }

const project = {
  id: 'p1',
  key: 'ASSAY',
  title: 'Assay development',
  display_id: 'PRJ-0008',
}

const ada = { user_id: 'u1', name: 'Ada Lovelace', role: 'scientist' }

describe('the project access cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      projectAccessProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([...PROJECT_ACCESS_PROPOSE_TOOL_NAMES])

    for (const name of PROJECT_ACCESS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('sets a level for a person, finding the project by its ID', async () => {
    const result = await buildProjectAccessProposal(
      PROJECT_SET_MEMBER_TOOL,
      { ...base, project: 'PRJ-0008', person: 'Ada', level: 'reviewer' },
      context({
        projects: [project],
        workspace_members_list: [ada],
        project_access: [{ access_level: 'viewer' }],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.changes).toEqual([
      { label: 'Ada Lovelace', before: 'viewer', after: 'reviewer' },
    ])
    expect(result.proposal.action).toEqual({
      kind: 'project_access.set_member',
      params: {
        p_project_id: 'p1',
        p_user_id: 'u1',
        p_access_level: 'reviewer',
      },
      openHref: '/projects/p1',
    })
  })

  it('refuses to remove someone who has no direct access', async () => {
    const result = await buildProjectAccessProposal(
      PROJECT_REMOVE_MEMBER_TOOL,
      { ...base, project: 'ASSAY', person: 'Ada' },
      context({ projects: [project], workspace_members_list: [ada] }),
    )

    expect(result.ok).toBe(false)
  })

  it('keeps the permissions a rule already has and changes only those named', async () => {
    const result = await buildProjectAccessProposal(
      PROJECT_SET_RULE_TOOL,
      { ...base, project: 'ASSAY', who: 'Ada', canEdit: true },
      context({
        projects: [project],
        workspace_members_list: [ada],
        workspace_project_access_rules: [
          {
            id: 'r1',
            project_id: 'p1',
            user_id: 'u1',
            group_id: null,
            principal_name: 'Ada Lovelace',
            can_view: true,
            can_edit: false,
            can_review: true,
            client_portal: false,
            can_manage: false,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.changes).toEqual([
      { label: 'Can edit', before: 'Off', after: 'On' },
    ])
    expect(result.proposal.action).toMatchObject({
      params: { p_user_id: 'u1', p_group_id: null, p_can_review: true },
    })
  })

  it('sets a rule for a group', async () => {
    const result = await buildProjectAccessProposal(
      PROJECT_SET_RULE_TOOL,
      { ...base, project: 'ASSAY', who: 'QA', whoIs: 'group', canView: true },
      context({
        projects: [project],
        workspace_groups: [{ id: 'g1', name: 'QA' }],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      params: { p_user_id: null, p_group_id: 'g1', p_can_view: true },
    })
  })

  it('removes a rule found by who it is for', async () => {
    const result = await buildProjectAccessProposal(
      PROJECT_REMOVE_RULE_TOOL,
      { ...base, project: 'ASSAY', who: 'QA' },
      context({
        projects: [project],
        workspace_project_access_rules: [
          {
            id: 'r9',
            project_id: 'p1',
            user_id: null,
            group_id: 'g1',
            principal_name: 'QA',
            can_view: true,
            can_edit: false,
            can_review: false,
            client_portal: false,
            can_manage: false,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'project_access.remove_rule',
      params: { p_rule_id: 'r9' },
    })
  })

  it('chooses the quality group, or none', async () => {
    const some = await buildProjectAccessProposal(
      PROJECT_SET_DEFAULTS_TOOL,
      { ...base, group: 'QA' },
      context({
        workspace_groups: [{ id: 'g1', name: 'QA' }],
        project_access_defaults: [{ qa_view_group_id: null }],
      }),
    )

    if (!some.ok) throw new Error(some.message)
    expect(some.proposal.action).toMatchObject({
      params: { p_qa_view_group_id: 'g1' },
    })

    const none = await buildProjectAccessProposal(
      PROJECT_SET_DEFAULTS_TOOL,
      { ...base, group: null },
      context({ project_access_defaults: [{ qa_view_group_id: null }] }),
    )

    if (!none.ok) throw new Error(none.message)
    expect(none.proposal.action).toMatchObject({
      params: { p_qa_view_group_id: null },
    })
  })

  it('shows only the review rules that change', async () => {
    const result = await buildProjectAccessProposal(
      PROJECT_SET_REVIEW_RULES_TOOL,
      {
        ...base,
        project: 'ASSAY',
        requireIndependentReviewer: true,
        autoShareToClient: false,
      },
      context({
        projects: [
          {
            ...project,
            require_effective_protocol: false,
            require_independent_reviewer: false,
            auto_share_to_client: false,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.changes).toEqual([
      {
        label: 'Independent reviewer required',
        before: 'Off',
        after: 'On',
      },
    ])
  })

  it('asks for edit access with the reason', async () => {
    const result = await buildProjectAccessProposal(
      PROJECT_REQUEST_EDIT_TOOL,
      { ...base, project: 'ASSAY', reason: 'I run the assay' },
      context({ projects: [project] }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'project_access.request_edit',
      params: { p_project_id: 'p1', p_reason: 'I run the assay' },
      openHref: '/projects/p1',
    })
  })

  it('runs each card as the person through its own RPC', async () => {
    const calls: Array<{
      name: string
      args: Record<string, core.util.JSONType>
    }> = []

    const client = {
      rpc: (name: string, args: Record<string, core.util.JSONType>) => {
        calls.push({ name, args })

        return Promise.resolve(undefined)
      },
    }

    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the runner only calls `rpc`.
    const runner = client as unknown as Parameters<
      typeof runProjectAccessAction
    >[0]

    const result = await runProjectAccessAction(runner, {
      kind: 'project_access.set_member',
      params: { p_project_id: 'p1', p_user_id: 'u1', p_access_level: 'viewer' },
      openHref: '/projects/p1',
    })

    expect(calls).toEqual([
      {
        name: PROJECT_ACCESS_RPC['project_access.set_member'],
        args: { p_project_id: 'p1', p_user_id: 'u1', p_access_level: 'viewer' },
      },
    ])
    expect(result).toEqual({ openHref: '/projects/p1' })
  })
})
