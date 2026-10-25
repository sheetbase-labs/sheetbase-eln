import { z } from 'zod'

import type { PublicProviderProfile } from './ai-providers/profiles'
import { defaultAiFeatureFlags } from './ai-feature-flags'
import type { AiFeatureFlags } from './ai-feature-flags'
import { MODEL_NAMES } from './metrics'

/**
 * AI-04 — workspace AI policy wire contract.
 *
 * The policy selects a deployment provider profile and bounds every call. It
 * carries no secret: a profile names an environment variable, and the key
 * never leaves the server. `enabled` is the workspace kill switch.
 */

export const AI_SETTINGS_MAX_TOKENS_CEILING = 100_000
export const AI_SETTINGS_MAX_COST_CEILING = 10_000_000
export const AI_SETTINGS_DEFAULT_MAX_TOKENS = 8_000
export const AI_SETTINGS_DEFAULT_MAX_COST_MICROUSD = 50_000

export type AiModel = (typeof MODEL_NAMES)[number]

export interface WorkspaceAiSettings {
  enabled: boolean
  providerProfile: string | null
  model: AiModel
  cloudEgressEnabled: boolean
  maxTokensPerCall: number
  maxCostMicrousdPerCall: number
  updatedByUserId: string | null
  updatedAt: string | null
}

export interface WorkspaceAiSettingsRow {
  workspace_id: string
  ai_enabled: boolean
  ai_provider_profile: string | null
  ai_model: string
  ai_cloud_egress_enabled: boolean
  ai_max_tokens_per_call: number
  ai_max_cost_microusd_per_call: number
  ai_feature_flags: unknown
  ai_updated_by_user_id: string | null
  updated_at: string
}

export interface AiSettingsView {
  workspaceId: string
  settings: WorkspaceAiSettings
  featureFlags: AiFeatureFlags
  profiles: PublicProviderProfile[]
  providerConfigError: string | null
  canManage: boolean
  /** Why the assistant will or will not serve a request right now. */
  readiness: AiReadiness
}

export type AiReadiness =
  | { ready: true; mode: 'built-in' }
  | {
      ready: true
      mode: 'provider'
      profileId: string
      dataClass: 'cloud' | 'local'
    }
  | {
      ready: false
      reason:
        | 'disabled'
        | 'feature_disabled'
        | 'profile_missing'
        | 'key_missing'
        | 'consent_required'
        | 'provider_config_invalid'
    }

export const updateAiSettingsSchema = z
  .object({
    workspaceId: z.string().uuid(),
    enabled: z.boolean(),
    providerProfile: z.string().min(1).max(80).nullable(),
    model: z.enum(MODEL_NAMES),
    cloudEgressEnabled: z.boolean(),
    maxTokensPerCall: z
      .number()
      .int()
      .min(1)
      .max(AI_SETTINGS_MAX_TOKENS_CEILING),
    maxCostMicrousdPerCall: z
      .number()
      .int()
      .min(0)
      .max(AI_SETTINGS_MAX_COST_CEILING),
  })
  .strict()

export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>

function asModel(value: string): AiModel {
  return (MODEL_NAMES as readonly string[]).includes(value)
    ? (value as AiModel)
    : 'sheetbase-assist-1'
}

export function toWorkspaceAiSettings(
  row: WorkspaceAiSettingsRow,
): WorkspaceAiSettings {
  return {
    enabled: row.ai_enabled,
    providerProfile: row.ai_provider_profile,
    model: asModel(row.ai_model),
    cloudEgressEnabled: row.ai_cloud_egress_enabled,
    maxTokensPerCall: row.ai_max_tokens_per_call,
    maxCostMicrousdPerCall: row.ai_max_cost_microusd_per_call,
    updatedByUserId: row.ai_updated_by_user_id,
    updatedAt: row.updated_at,
  }
}

export function defaultWorkspaceAiSettings(): WorkspaceAiSettings {
  return {
    enabled: false,
    providerProfile: null,
    model: 'sheetbase-assist-1',
    cloudEgressEnabled: false,
    maxTokensPerCall: AI_SETTINGS_DEFAULT_MAX_TOKENS,
    maxCostMicrousdPerCall: AI_SETTINGS_DEFAULT_MAX_COST_MICROUSD,
    updatedByUserId: null,
    updatedAt: null,
  }
}

/** Resolve the assistant's current operating mode without calling anything. */
export function aiReadiness(
  settings: WorkspaceAiSettings,
  profiles: PublicProviderProfile[],
  providerConfigError: string | null,
  featureFlags: AiFeatureFlags = defaultAiFeatureFlags(),
): AiReadiness {
  if (providerConfigError) {
    return { ready: false, reason: 'provider_config_invalid' }
  }
  if (!settings.enabled) return { ready: false, reason: 'disabled' }
  if (!featureFlags.assistant) {
    return { ready: false, reason: 'feature_disabled' }
  }
  if (!settings.providerProfile) return { ready: true, mode: 'built-in' }
  const profile = profiles.find(
    (entry) => entry.id === settings.providerProfile,
  )
  if (!profile) return { ready: false, reason: 'profile_missing' }
  if (!profile.keyAvailable) return { ready: false, reason: 'key_missing' }
  if (profile.dataClass === 'cloud' && !settings.cloudEgressEnabled) {
    return { ready: false, reason: 'consent_required' }
  }
  return {
    ready: true,
    mode: 'provider',
    profileId: profile.id,
    dataClass: profile.dataClass,
  }
}

/** Human-readable readiness, used by settings and the assistant panel. */
export function aiReadinessMessage(readiness: AiReadiness): string {
  if (readiness.ready) {
    return readiness.mode === 'built-in'
      ? 'Built-in deterministic model. No external provider is configured.'
      : `Using provider profile '${readiness.profileId}' (${readiness.dataClass}).`
  }
  switch (readiness.reason) {
    case 'disabled':
      return 'AI is off for this workspace. A workspace owner can enable it in Settings → AI.'
    case 'feature_disabled':
      return 'The assistant is disabled by a workspace access flag. A workspace owner can enable it in Settings → AI.'
    case 'profile_missing':
      return 'The selected provider profile is no longer configured on this deployment.'
    case 'key_missing':
      return 'The selected provider profile has no API key on this deployment.'
    case 'consent_required':
      return 'This profile sends data to a cloud provider. An owner must record cloud-egress consent first.'
    case 'provider_config_invalid':
      return 'The deployment AI provider configuration is invalid.'
  }
}
