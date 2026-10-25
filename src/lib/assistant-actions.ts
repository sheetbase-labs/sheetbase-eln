import { createServerFn } from '@tanstack/react-start'

import { askAssistant, askAssistantSchema } from './assistant'
import type { AskAssistantResult } from './assistant'
import { aiReadiness, toWorkspaceAiSettings } from './ai-settings'
import { resolveAiFeatureFlags } from './ai-feature-flags'
import type { WorkspaceAiSettingsRow } from './ai-settings'
import { AiProviderError } from './ai-providers/types'
import type { ModelProvider } from './ai-gateway'
import { logger, redact } from './logger'

/**
 * Session-authenticated assistant endpoint. The actor, workspace, policy and
 * RLS-scoped client all come from the verified session; the request supplies
 * only a question and stable object ids.
 */

interface AssistantSession {
  userId: string
  workspaceId: string
  token: string
}

async function loadSession(workspaceId: string): Promise<AssistantSession> {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  const { resolveSessionAuth } = await import('#/lib/request-auth')

  const headers = getRequestHeaders()
  const context = await getCurrentContext(headers)
  if (!context?.workspace || context.workspace.id !== workspaceId) {
    throw new Error('You do not have access to this workspace.')
  }
  const auth = await resolveSessionAuth(headers)
  if (!auth.ok || auth.context.workspaceId !== workspaceId) {
    throw new Error('You do not have access to this workspace.')
  }
  return {
    userId: context.user.id,
    workspaceId,
    token: auth.context.token,
  }
}

async function readSettings(
  token: string,
  workspaceId: string,
): Promise<WorkspaceAiSettingsRow | null> {
  const { createServerDataClient } =
    await import('#/lib/server-data-client.server')
  const client = createServerDataClient(token)
  const rows = await client.list<WorkspaceAiSettingsRow>(
    'workspace_settings',
    `?select=workspace_id,ai_enabled,ai_provider_profile,ai_model,ai_cloud_egress_enabled,ai_max_tokens_per_call,ai_max_cost_microusd_per_call,ai_feature_flags,ai_updated_by_user_id,updated_at&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
  )
  return rows.at(0) ?? null
}

export const askAssistantFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => askAssistantSchema.parse(input))
  .handler(async ({ data }): Promise<AskAssistantResult> => {
    const session = await loadSession(data.workspaceId)
    const { getPublicProviderProfiles } =
      await import('#/lib/ai-providers/config.server')
    const { profiles, error } = getPublicProviderProfiles()
    const row = await readSettings(session.token, data.workspaceId)
    if (!row) {
      return {
        status: 'unavailable',
        reason: 'disabled',
        message: 'AI is off for this workspace.',
      }
    }
    const settings = toWorkspaceAiSettings(row)
    const featureFlags = resolveAiFeatureFlags(row.ai_feature_flags)
    const readiness = aiReadiness(settings, profiles, error, featureFlags)
    if (!readiness.ready) {
      return {
        status: 'unavailable',
        reason: readiness.reason,
        message: 'AI is not available for this workspace right now.',
      }
    }

    let provider: ModelProvider | undefined
    let pricing: number | undefined
    if (readiness.mode === 'provider') {
      const { resolveProvider } =
        await import('#/lib/ai-providers/config.server')
      try {
        const resolved = resolveProvider(readiness.profileId)
        provider = resolved.provider
        pricing = resolved.estimatedMicrousdPerToken
      } catch (cause) {
        logger.warn(
          'ai.assistant.provider_unavailable',
          redact({
            workspaceId: data.workspaceId,
            profileId: readiness.profileId,
            code: cause instanceof AiProviderError ? cause.code : 'unknown',
          }),
        )
        return {
          status: 'error',
          code: 'provider_unavailable',
          message: 'The selected AI provider is not available.',
        }
      }
    }

    const { createServerDataClient } =
      await import('#/lib/server-data-client.server')
    const client = createServerDataClient(session.token)
    const result = await askAssistant(data, {
      actor: { kind: 'user', id: session.userId },
      workspaceId: data.workspaceId,
      settings,
      featureFlags,
      profiles,
      providerConfigError: error,
      client,
      provider,
      pricing,
    })

    logger.info(
      'ai.assistant.asked',
      redact({
        workspaceId: data.workspaceId,
        actorUserId: session.userId,
        model: settings.model,
        mode: readiness.mode,
        providerProfile:
          readiness.mode === 'provider' ? readiness.profileId : null,
        questionChars: data.question.length,
        objectRefs: data.objectRefs.length,
        outcome: result.status,
      }),
    )
    return result
  })
