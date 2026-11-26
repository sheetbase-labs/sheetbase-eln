import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import { context } from '#/lib/assistant-admin-cards.fixture'

import {
  GROUP_ROLE_ADOPT_TOOL,
  ONTOLOGY_LOOKUP_TOOL,
  OPEN_TABLES_REVOKE_TOOL,
  PLUGIN_POINT_TOOL,
  SCHEDULER_HOURS_TOOL,
  SETTINGS_ACCESS_TOOL,
  WORKSPACE_AI_TOOL,
  WORKSPACE_DATA_ACCESS_TOOL,
  WORKSPACE_ID_PREFIXES_TOOL,
  WORKSPACE_RULES_TOOL,
  WORKSPACE_SETTINGS_PROPOSE_TOOL_NAMES,
} from './cards'
import { runWorkspaceSettingsAction } from './cards-run'
import {
  buildWorkspaceSettingsProposal,
  workspaceSettingsProposalDefs,
} from './cards.server'

const base = { title: 'T', summary: 'S' }

const settings = {
  registration_mode: 'open',
  review_workflow_enabled: false,
  audit_retention_days: 2555,
  require_change_reason: false,
  lock_on_sign: true,
  allow_offline_editing: true,
  publication_approval_required: false,
  id_prefixes: { experiment: 'EXP' },
  data_access_roles: ['steward'],
  ai_enabled: true,
  ai_provider_profile: null,
  ai_model: 'sheetbase-assist-1',
  ai_cloud_egress_enabled: false,
  ai_max_tokens_per_call: 4000,
  ai_max_cost_microusd_per_call: 1000,
}

describe('the workspace settings cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      workspaceSettingsProposalDefs().map((def) =>
        def.name.replaceAll('__', '.'),
      ),
    ).toEqual([...WORKSPACE_SETTINGS_PROPOSE_TOOL_NAMES])

    for (const name of WORKSPACE_SETTINGS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('shows only the rules that change, and sends the rest as null', async () => {
    const result = await buildWorkspaceSettingsProposal(
      WORKSPACE_RULES_TOOL,
      {
        ...base,
        registrationMode: 'invitation_only',
        requireChangeReason: true,
        lockOnSign: true,
      },
      context({ workspace_settings: [settings] }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.changes).toEqual([
      { label: 'Who can join', before: 'open', after: 'invitation_only' },
      { label: 'Change reason required', before: 'Off', after: 'On' },
    ])
    expect(result.proposal.action).toMatchObject({
      params: {
        p_workspace_id: 'ws',
        p_registration_mode: 'invitation_only',
        p_require_change_reason: true,
        p_review_workflow_enabled: null,
      },
    })
  })

  it('says so when a setting already is what was asked', async () => {
    const result = await buildWorkspaceSettingsProposal(
      WORKSPACE_RULES_TOOL,
      { ...base, lockOnSign: true },
      context({ workspace_settings: [settings] }),
    )

    expect(result.ok).toBe(false)
  })

  it('keeps the AI settings it was not told to change', async () => {
    const result = await buildWorkspaceSettingsProposal(
      WORKSPACE_AI_TOOL,
      { ...base, maxTokensPerCall: 8000 },
      context({ workspace_settings: [settings] }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'workspace_settings.ai',
      params: {
        workspaceId: 'ws',
        enabled: true,
        providerProfile: null,
        cloudEgressEnabled: false,
        maxTokensPerCall: 8000,
        maxCostMicrousdPerCall: 1000,
      },
    })
    expect(result.proposal.changes).toEqual([
      { label: 'Tokens per call', before: '4000', after: '8000' },
    ])
  })

  it('merges new ID prefixes into the ones already set', async () => {
    const result = await buildWorkspaceSettingsProposal(
      WORKSPACE_ID_PREFIXES_TOOL,
      { ...base, prefixes: { material: 'MAT' } },
      context({ workspace_settings: [settings] }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      params: { p_prefixes: { experiment: 'EXP', material: 'MAT' } },
    })
  })

  it('replaces the list of roles with data access', async () => {
    const result = await buildWorkspaceSettingsProposal(
      WORKSPACE_DATA_ACCESS_TOOL,
      { ...base, roles: ['steward', 'analyst', 'analyst'] },
      context({ workspace_settings: [settings] }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      params: { p_roles: ['analyst', 'steward'] },
    })
  })

  it('turns working hours into minutes and days into numbers', async () => {
    const result = await buildWorkspaceSettingsProposal(
      SCHEDULER_HOURS_TOOL,
      {
        ...base,
        workStart: '08:30',
        workEnd: '17:00',
        workDays: ['monday', 'tuesday', 'saturday'],
      },
      context({
        scheduler_settings: [
          {
            timezone: 'Europe/London',
            work_start_minute: 540,
            work_end_minute: 1020,
            work_days: [1, 2, 3, 4, 5],
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      params: {
        p_timezone: 'Europe/London',
        p_work_start_minute: 510,
        p_work_end_minute: 1020,
        p_work_days: [1, 2, 6],
      },
    })
  })

  it('refuses working hours that end before they start', async () => {
    const result = await buildWorkspaceSettingsProposal(
      SCHEDULER_HOURS_TOOL,
      { ...base, workStart: '18:00', workEnd: '09:00' },
      context({}),
    )

    expect(result.ok).toBe(false)
  })

  it('writes the scientist level for the member role too', async () => {
    const result = await buildWorkspaceSettingsProposal(
      SETTINGS_ACCESS_TOOL,
      { ...base, area: 'ai', roles: ['scientist'], level: 'view' },
      context({ settings_access: [] }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'workspace_settings.access',
      params: { p_area: 'ai', p_level: 'view', roles: ['member', 'scientist'] },
    })
  })

  it('runs the roles card as one RPC per role, and stops at the first refusal', async () => {
    const calls: string[] = []

    const client = {
      rpc: (_name: string, args: { p_role: string }) => {
        calls.push(args.p_role)

        return args.p_role === 'member'
          ? Promise.reject(new Error('refused'))
          : Promise.resolve(undefined)
      },
    }

    await expect(
      runWorkspaceSettingsAction(
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the runner only calls `rpc`.
        client as unknown as Parameters<typeof runWorkspaceSettingsAction>[0],
        {
          kind: 'workspace_settings.access',
          params: {
            p_workspace_id: 'ws',
            p_area: 'ai',
            p_level: 'view',
            roles: ['analyst', 'member', 'scientist'],
          },
          openHref: null,
        },
      ),
    ).rejects.toThrow('refused')

    expect(calls).toEqual(['analyst', 'member'])
  })

  it('adopts group roles for the whole workspace', async () => {
    const result = await buildWorkspaceSettingsProposal(
      GROUP_ROLE_ADOPT_TOOL,
      base,
      context({}),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'workspace_settings.adopt_groups',
      params: { p_workspace_id: 'ws' },
    })
  })

  it('revokes an active SQL login found by name', async () => {
    const result = await buildWorkspaceSettingsProposal(
      OPEN_TABLES_REVOKE_TOOL,
      { ...base, login: 'tableau' },
      context({
        list_lake_credentials: [
          { id: 'c1', name: 'Tableau', username: 'lake_a1', status: 'active' },
          {
            id: 'c2',
            name: 'Tableau old',
            username: 'lake_b2',
            status: 'revoked',
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      params: { p_workspace_id: 'ws', p_credential_id: 'c1' },
    })
  })

  it('turns ontology lookup on with the ontologies named', async () => {
    const result = await buildWorkspaceSettingsProposal(
      ONTOLOGY_LOOKUP_TOOL,
      { ...base, enabled: true, ontologies: ['OBI', 'chebi'] },
      context({ ontology_settings: { enabled: false, ontologies: ['obi'] } }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.changes).toEqual([
      { label: 'Term lookup', before: 'Off', after: 'On' },
      { label: 'Ontologies', before: 'obi', after: 'obi, chebi' },
    ])
    expect(result.proposal.action).toMatchObject({
      params: { p_enabled: true, p_ontologies: ['obi', 'chebi'] },
    })
  })

  it('switches one runner point of a plugin', async () => {
    const result = await buildWorkspaceSettingsProposal(
      PLUGIN_POINT_TOOL,
      { ...base, plugin: 'qc-tools', point: 'operations', enabled: false },
      context({
        extensions: [
          { id: 'x1', key: 'qc-tools', name: 'QC tools', disabled_points: [] },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      params: {
        p_extension_id: 'x1',
        p_point: 'operations',
        p_enabled: false,
      },
    })
  })
})
