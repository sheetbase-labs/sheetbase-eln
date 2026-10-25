import { describe, expect, it, vi } from 'vitest'

import { askAssistant } from './assistant'
import type { AssistantDeps } from './assistant'
import type { WorkspaceAiSettings } from './ai-settings'
import type { ModelProvider } from './ai-gateway'
import type { DataClient } from './data-client'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const RECORD_ID = '22222222-2222-4222-8222-222222222222'

const enabledSettings: WorkspaceAiSettings = {
  enabled: true,
  providerProfile: null,
  model: 'sheetbase-assist-1',
  cloudEgressEnabled: false,
  maxTokensPerCall: 8_000,
  maxCostMicrousdPerCall: 50_000,
  updatedByUserId: null,
  updatedAt: null,
}

const recordRow = {
  id: RECORD_ID,
  workspace_id: WORKSPACE_ID,
  project_id: null,
  folder_id: null,
  kind: 'experiment',
  identifier: 'EXP-024',
  title: 'Cell viability study',
  status: 'in_progress',
  tags: [],
  structure_version: 1,
  metadata_version: 1,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  archived_at: null,
  deleted_at: null,
  created_by_user_id: 'user-1',
  updated_by_user_id: null,
  properties: {},
  custom_fields: {},
  locked_at: null,
  locked_by_revision_id: null,
}

function fakeClient(): DataClient {
  return {
    list: vi.fn(async (resource: string) => {
      if (resource === 'records') return [recordRow]
      return []
    }),
    count: vi.fn(async () => 0),
    rpc: vi.fn(async () => ({})),
    insert: vi.fn(async () => ({})),
    patch: vi.fn(async () => []),
    remove: vi.fn(async () => []),
  } as unknown as DataClient
}

function deps(overrides: Partial<AssistantDeps> = {}): AssistantDeps {
  return {
    actor: { kind: 'user', id: 'user-1' },
    workspaceId: WORKSPACE_ID,
    settings: enabledSettings,
    profiles: [],
    providerConfigError: null,
    client: fakeClient(),
    ...overrides,
  }
}

describe('assistant policy', () => {
  it('serves nothing when the workspace has AI off', async () => {
    const client = fakeClient()
    const result = await askAssistant(
      { workspaceId: WORKSPACE_ID, question: 'What is this?', objectRefs: [] },
      deps({ settings: { ...enabledSettings, enabled: false }, client }),
    )
    expect(result).toMatchObject({ status: 'unavailable', reason: 'disabled' })
    expect(client.list).not.toHaveBeenCalled()
  })

  it('refuses a cloud profile without recorded egress consent', async () => {
    const result = await askAssistant(
      { workspaceId: WORKSPACE_ID, question: 'What is this?', objectRefs: [] },
      deps({
        settings: { ...enabledSettings, providerProfile: 'cloud' },
        profiles: [
          {
            id: 'cloud',
            label: 'Cloud',
            kind: 'openai-compatible',
            model: 'm',
            dataClass: 'cloud',
            keyAvailable: true,
          },
        ],
      }),
    )
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'consent_required',
    })
  })
})

describe('assistant grounding', () => {
  it('answers through the gateway stub with the assembled sources', async () => {
    const result = await askAssistant(
      {
        workspaceId: WORKSPACE_ID,
        question: 'Summarise this experiment.',
        objectRefs: [{ kind: 'record', id: RECORD_ID }],
      },
      deps(),
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.mode).toBe('built-in')
    expect(result.generated).toBe(true)
    expect(result.text).toContain('Built-in deterministic answer')
    expect(result.sources).toEqual([
      expect.objectContaining({
        kind: 'record',
        id: RECORD_ID,
        title: 'Cell viability study',
        freshness: 'live',
      }),
    ])
    expect(result.usage.tokensUsed).toBeGreaterThan(0)
  })

  it('never writes while answering', async () => {
    const client = fakeClient()
    await askAssistant(
      {
        workspaceId: WORKSPACE_ID,
        question: 'Summarise this experiment.',
        objectRefs: [{ kind: 'record', id: RECORD_ID }],
      },
      deps({ client }),
    )
    expect(client.insert).not.toHaveBeenCalled()
    expect(client.patch).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
  })

  it('uses an injected provider and reports its profile', async () => {
    const complete = vi.fn(async () => ({
      text: 'Provider answer.',
      tokensUsed: 10,
      costMicrousd: 20,
    }))
    const provider: ModelProvider = { name: 'test-provider', complete }
    const result = await askAssistant(
      { workspaceId: WORKSPACE_ID, question: 'Question', objectRefs: [] },
      deps({
        settings: { ...enabledSettings, providerProfile: 'provider' },
        profiles: [
          {
            id: 'provider',
            label: 'Provider',
            kind: 'local',
            model: 'local-model',
            dataClass: 'local',
            keyAvailable: true,
          },
        ],
        provider,
        pricing: 1,
      }),
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: 'ok',
      mode: 'provider',
      providerProfile: 'provider',
      text: 'Provider answer.',
    })
  })

  it('reports a provider-mode request with no provider as unavailable', async () => {
    const result = await askAssistant(
      { workspaceId: WORKSPACE_ID, question: 'Question', objectRefs: [] },
      deps({
        settings: { ...enabledSettings, providerProfile: 'provider' },
        profiles: [
          {
            id: 'provider',
            label: 'Provider',
            kind: 'local',
            model: 'local-model',
            dataClass: 'local',
            keyAvailable: true,
          },
        ],
      }),
    )
    expect(result).toMatchObject({
      status: 'error',
      code: 'provider_unavailable',
    })
  })

  it('surfaces a budget rejection without calling a provider', async () => {
    const complete = vi.fn(async () => ({
      text: 'Should not run.',
      tokensUsed: 1,
      costMicrousd: 1,
    }))
    const result = await askAssistant(
      { workspaceId: WORKSPACE_ID, question: 'Question', objectRefs: [] },
      deps({
        settings: { ...enabledSettings, maxCostMicrousdPerCall: 0 },
        provider: { name: 'never', complete },
      }),
    )
    expect(result).toMatchObject({ status: 'error', code: 'gateway_error' })
    expect(complete).not.toHaveBeenCalled()
  })
})
