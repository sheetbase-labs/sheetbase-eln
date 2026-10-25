import { describe, expect, it } from 'vitest'

import {
  aiReadiness,
  aiReadinessMessage,
  defaultWorkspaceAiSettings,
  toWorkspaceAiSettings,
} from './ai-settings'
import type { PublicProviderProfile } from './ai-providers/profiles'
import { defaultAiFeatureFlags } from './ai-feature-flags'
import type { WorkspaceAiSettings } from './ai-settings'

const localProfile: PublicProviderProfile = {
  id: 'local',
  label: 'Local',
  kind: 'local',
  model: 'local-model',
  dataClass: 'local',
  keyAvailable: true,
}

const cloudProfile: PublicProviderProfile = {
  id: 'cloud',
  label: 'Cloud',
  kind: 'openai-compatible',
  model: 'cloud-model',
  dataClass: 'cloud',
  keyAvailable: true,
}

const base: WorkspaceAiSettings = {
  ...defaultWorkspaceAiSettings(),
  enabled: true,
}

describe('AI readiness', () => {
  it('is disabled until the workspace opts in', () => {
    expect(
      aiReadiness({ ...base, enabled: false }, [localProfile], null),
    ).toEqual({ ready: false, reason: 'disabled' })
    expect(aiReadinessMessage({ ready: false, reason: 'disabled' })).toContain(
      'Settings → AI',
    )
  })

  it('is unavailable when the assistant access flag is off', () => {
    expect(
      aiReadiness(base, [localProfile], null, {
        ...defaultAiFeatureFlags(),
        assistant: false,
      }),
    ).toEqual({ ready: false, reason: 'feature_disabled' })
    expect(
      aiReadinessMessage({ ready: false, reason: 'feature_disabled' }),
    ).toContain('access flag')
  })

  it('uses the built-in model when no provider profile is selected', () => {
    expect(aiReadiness(base, [localProfile], null)).toEqual({
      ready: true,
      mode: 'built-in',
    })
  })

  it('requires a configured profile, a key and cloud consent', () => {
    expect(
      aiReadiness(
        { ...base, providerProfile: 'missing' },
        [localProfile],
        null,
      ),
    ).toEqual({ ready: false, reason: 'profile_missing' })

    expect(
      aiReadiness(
        { ...base, providerProfile: 'cloud' },
        [{ ...cloudProfile, keyAvailable: false }],
        null,
      ),
    ).toEqual({ ready: false, reason: 'key_missing' })

    expect(
      aiReadiness({ ...base, providerProfile: 'cloud' }, [cloudProfile], null),
    ).toEqual({ ready: false, reason: 'consent_required' })

    expect(
      aiReadiness(
        {
          ...base,
          providerProfile: 'cloud',
          cloudEgressEnabled: true,
        },
        [cloudProfile],
        null,
      ),
    ).toEqual({
      ready: true,
      mode: 'provider',
      profileId: 'cloud',
      dataClass: 'cloud',
    })
  })

  it('treats a malformed deployment configuration as unavailable', () => {
    expect(
      aiReadiness(base, [], 'AI_PROVIDER_PROFILES is not valid JSON'),
    ).toEqual({ ready: false, reason: 'provider_config_invalid' })
  })

  it('normalises an unknown stored model to the assistant role', () => {
    const settings = toWorkspaceAiSettings({
      workspace_id: '11111111-1111-4111-8111-111111111111',
      ai_enabled: true,
      ai_provider_profile: null,
      ai_model: 'retired-model',
      ai_cloud_egress_enabled: false,
      ai_max_tokens_per_call: 8_000,
      ai_max_cost_microusd_per_call: 50_000,
      ai_feature_flags: {},
      ai_updated_by_user_id: null,
      updated_at: '2026-10-24T00:00:00.000Z',
    })
    expect(settings.model).toBe('sheetbase-assist-1')
  })
})
