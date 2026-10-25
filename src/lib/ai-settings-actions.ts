import { createServerFn } from '@tanstack/react-start'

import {
  aiReadiness,
  defaultWorkspaceAiSettings,
  toWorkspaceAiSettings,
  updateAiSettingsSchema,
} from './ai-settings'
import {
  resolveAiFeatureFlags,
  updateAiFeatureFlagsSchema,
} from './ai-feature-flags'
import type { UpdateAiFeatureFlagsInput } from './ai-feature-flags'
import type {
  AiSettingsView,
  UpdateAiSettingsInput,
  WorkspaceAiSettingsRow,
} from './ai-settings'
import { logger, redact } from './logger'

/**
 * Server functions for the workspace AI policy. The route imports only these
 * functions; every server-only dependency is loaded inside a handler so the
 * client bundle never sees the database, the environment or a provider key.
 */

const AI_SETTINGS_COLUMNS = [
  'workspace_id',
  'ai_enabled',
  'ai_provider_profile',
  'ai_model',
  'ai_cloud_egress_enabled',
  'ai_max_tokens_per_call',
  'ai_max_cost_microusd_per_call',
  'ai_feature_flags',
  'ai_updated_by_user_id',
  'updated_at',
].join(',')

interface SessionContext {
  userId: string
  workspaceId: string
  role: string
  token: string
}

async function loadSession(
  workspaceId: string,
  options: { requireOwner: boolean },
): Promise<SessionContext> {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  const { resolveSessionAuth } = await import('#/lib/request-auth')

  const headers = getRequestHeaders()
  const context = await getCurrentContext(headers)
  if (!context?.workspace || context.workspace.id !== workspaceId) {
    throw new Error('You do not have access to this workspace.')
  }
  if (options.requireOwner && context.workspace.role !== 'owner') {
    throw new Error('Only a workspace owner can change AI settings.')
  }
  const auth = await resolveSessionAuth(headers)
  if (!auth.ok || auth.context.workspaceId !== workspaceId) {
    throw new Error('You do not have access to this workspace.')
  }
  return {
    userId: context.user.id,
    workspaceId,
    role: context.workspace.role,
    token: auth.context.token,
  }
}

async function readRow(
  token: string,
  workspaceId: string,
): Promise<WorkspaceAiSettingsRow | null> {
  const { createServerDataClient } =
    await import('#/lib/server-data-client.server')
  const client = createServerDataClient(token)
  const rows = await client.list<WorkspaceAiSettingsRow>(
    'workspace_settings',
    `?select=${AI_SETTINGS_COLUMNS}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
  )
  return rows.at(0) ?? null
}

async function buildView(
  session: SessionContext,
  row: WorkspaceAiSettingsRow | null,
  providerConfigError: string | null,
  profiles: AiSettingsView['profiles'],
): Promise<AiSettingsView> {
  const settings = row
    ? toWorkspaceAiSettings(row)
    : defaultWorkspaceAiSettings()
  const featureFlags = resolveAiFeatureFlags(row?.ai_feature_flags)
  return {
    workspaceId: session.workspaceId,
    settings,
    featureFlags,
    profiles,
    providerConfigError,
    canManage: session.role === 'owner',
    readiness: aiReadiness(
      settings,
      profiles,
      providerConfigError,
      featureFlags,
    ),
  }
}

export const getAiSettingsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<AiSettingsView> => {
    const session = await loadSession(data.workspaceId, {
      requireOwner: false,
    })
    const { getPublicProviderProfiles } =
      await import('#/lib/ai-providers/config.server')
    const { profiles, error } = getPublicProviderProfiles()
    const row = await readRow(session.token, data.workspaceId)
    return buildView(session, row, error, profiles)
  })

export const updateAiSettingsFn = createServerFn({ method: 'POST' })
  .validator((input: UpdateAiSettingsInput) =>
    updateAiSettingsSchema.parse(input),
  )
  .handler(async ({ data }): Promise<AiSettingsView> => {
    const session = await loadSession(data.workspaceId, { requireOwner: true })
    const { getPublicProviderProfiles } =
      await import('#/lib/ai-providers/config.server')
    const { profiles, error } = getPublicProviderProfiles()
    if (error) throw new Error(error)

    const profile = data.providerProfile
      ? profiles.find((entry) => entry.id === data.providerProfile)
      : undefined
    if (data.providerProfile && !profile) {
      throw new Error('That provider profile is not configured here.')
    }
    if (
      data.enabled &&
      profile?.dataClass === 'cloud' &&
      !data.cloudEgressEnabled
    ) {
      throw new Error(
        'Cloud-egress consent is required before enabling a cloud provider.',
      )
    }

    const { createServerDataClient } =
      await import('#/lib/server-data-client.server')
    const client = createServerDataClient(session.token)
    const updated = await client.rpc<WorkspaceAiSettingsRow | null>(
      'update_workspace_ai_settings',
      {
        p_workspace_id: data.workspaceId,
        p_enabled: data.enabled,
        p_provider_profile: data.providerProfile,
        p_model: data.model,
        p_cloud_egress_enabled: data.cloudEgressEnabled,
        p_max_tokens: data.maxTokensPerCall,
        p_max_cost: data.maxCostMicrousdPerCall,
      },
    )
    if (!updated || !updated.workspace_id) {
      throw new Error('The AI settings update was not applied.')
    }

    logger.info(
      'ai.settings.updated',
      redact({
        workspaceId: data.workspaceId,
        actorUserId: session.userId,
        enabled: data.enabled,
        providerProfile: data.providerProfile,
        model: data.model,
        cloudEgressEnabled: data.cloudEgressEnabled,
        maxTokensPerCall: data.maxTokensPerCall,
        maxCostMicrousdPerCall: data.maxCostMicrousdPerCall,
      }),
    )

    return buildView(session, updated, error, profiles)
  })

export const updateAiFeatureFlagsFn = createServerFn({ method: 'POST' })
  .validator((input: UpdateAiFeatureFlagsInput) =>
    updateAiFeatureFlagsSchema.parse(input),
  )
  .handler(async ({ data }): Promise<AiSettingsView> => {
    const session = await loadSession(data.workspaceId, { requireOwner: true })
    const { getPublicProviderProfiles } =
      await import('#/lib/ai-providers/config.server')
    const { profiles, error } = getPublicProviderProfiles()
    if (error) throw new Error(error)

    const { createServerDataClient } =
      await import('#/lib/server-data-client.server')
    const client = createServerDataClient(session.token)
    const updated = await client.rpc<WorkspaceAiSettingsRow | null>(
      'update_workspace_ai_feature_flags',
      {
        p_workspace_id: data.workspaceId,
        p_feature_flags: data.featureFlags,
      },
    )
    if (!updated || !updated.workspace_id) {
      throw new Error('The AI access flags update was not applied.')
    }

    logger.info(
      'ai.access_flags.updated',
      redact({
        workspaceId: data.workspaceId,
        actorUserId: session.userId,
        featureFlags: data.featureFlags,
      }),
    )

    return buildView(session, updated, error, profiles)
  })
