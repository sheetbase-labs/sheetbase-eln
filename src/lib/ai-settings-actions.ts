import { createServerFn } from '@tanstack/react-start'

import {
  aiReadiness,
  defaultWorkspaceAiSettings,
  toWorkspaceAiSettings,
  updateAiSettingsSchema,
} from './ai-settings'
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
  return {
    workspaceId: session.workspaceId,
    settings,
    profiles,
    providerConfigError,
    canManage: session.role === 'owner',
    readiness: aiReadiness(settings, profiles, providerConfigError),
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
    const updated = await client.patch<WorkspaceAiSettingsRow>(
      'workspace_settings',
      `?workspace_id=eq.${encodeURIComponent(data.workspaceId)}`,
      {
        ai_enabled: data.enabled,
        ai_provider_profile: data.providerProfile,
        ai_model: data.model,
        ai_cloud_egress_enabled: data.cloudEgressEnabled,
        ai_max_tokens_per_call: data.maxTokensPerCall,
        ai_max_cost_microusd_per_call: data.maxCostMicrousdPerCall,
        ai_updated_by_user_id: session.userId,
        updated_at: new Date().toISOString(),
      },
    )
    if (updated.length === 0) {
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

    const row = await readRow(session.token, data.workspaceId)
    return buildView(session, row, error, profiles)
  })
