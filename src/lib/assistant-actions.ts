import { createServerFn } from '@tanstack/react-start'

import { askAssistant, askAssistantSchema } from './assistant'
import type { AskAssistantResult, AssistantDeps } from './assistant'
import { pageAiSchema, runPageAi } from './page-ai'
import type { PageAiResult } from './page-ai'
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

async function loadSession(
  workspaceId: string,
  requestHeaders?: Headers,
): Promise<AssistantSession> {
  const { getCurrentContext } = await import('#/lib/current-user')
  const { resolveSessionAuth } = await import('#/lib/request-auth')

  const headers =
    requestHeaders ??
    (await import('@tanstack/react-start/server')).getRequestHeaders()

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

function usableTimeZone(zone: string | undefined): string | undefined {
  if (!zone) return undefined

  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })

    return zone
  } catch {
    return undefined
  }
}

export type AssistantRuntime =
  | {
      ok: true
      session: AssistantSession
      deps: AssistantDeps
      mode: 'built-in' | 'provider'
      providerProfile: string | null
    }
  | {
      ok: false
      result: Extract<AskAssistantResult, { status: 'unavailable' | 'error' }>
    }

/**
 * Everything an assistant turn needs, resolved from the verified session:
 * actor, workspace policy, provider and an RLS-scoped data client. Shared by
 * the one-shot server function and the streaming chat route so both enforce
 * the same readiness rules.
 */
export async function resolveAssistantRuntime(
  workspaceId: string,
  requestHeaders?: Headers,
  options: { timeZone?: string } = {},
): Promise<AssistantRuntime> {
  const session = await loadSession(workspaceId, requestHeaders)

  const { getPublicProviderProfiles } =
    await import('#/lib/ai-providers/config.server')

  const { profiles, error } = getPublicProviderProfiles()
  const row = await readSettings(session.token, workspaceId)

  if (!row) {
    return {
      ok: false,
      result: {
        status: 'unavailable',
        reason: 'disabled',
        message: 'AI is off for this workspace.',
      },
    }
  }

  const settings = toWorkspaceAiSettings(row)
  const featureFlags = resolveAiFeatureFlags(row.ai_feature_flags)
  const readiness = aiReadiness(settings, profiles, error, featureFlags)

  if (!readiness.ready) {
    return {
      ok: false,
      result: {
        status: 'unavailable',
        reason: readiness.reason,
        message: 'AI is not available for this workspace right now.',
      },
    }
  }

  let provider: ModelProvider | undefined
  let pricing: number | undefined

  if (readiness.mode === 'provider') {
    const { resolveProvider } = await import('#/lib/ai-providers/config.server')

    try {
      const resolved = resolveProvider(readiness.profileId)
      provider = resolved.provider
      pricing = resolved.estimatedMicrousdPerToken
    } catch (cause) {
      logger.warn(
        'ai.assistant.provider_unavailable',
        redact({
          workspaceId,
          profileId: readiness.profileId,
          code: cause instanceof AiProviderError ? cause.code : 'unknown',
        }),
      )

      return {
        ok: false,
        result: {
          status: 'error',
          code: 'provider_unavailable',
          message: 'The selected AI provider is not available.',
        },
      }
    }
  }

  const { createServerDataClient } =
    await import('#/lib/server-data-client.server')

  const client = createServerDataClient(session.token)

  const { createAssistantToolkit } =
    await import('#/lib/assistant-tools.server')

  const actor = { kind: 'user' as const, id: session.userId }

  const toolkit = await createAssistantToolkit({
    client,
    actor,
    workspaceId,
    flags: featureFlags,
    timeZone: usableTimeZone(options.timeZone),
  })

  return {
    ok: true,
    session,
    mode: readiness.mode,
    providerProfile: readiness.mode === 'provider' ? readiness.profileId : null,
    deps: {
      actor,
      workspaceId,
      settings,
      featureFlags,
      profiles,
      providerConfigError: error,
      client,
      provider,
      pricing,
      toolkit: toolkit ?? undefined,
    },
  }
}

export const askAssistantFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => askAssistantSchema.parse(input))
  .handler(async ({ data }): Promise<AskAssistantResult> => {
    const runtime = await resolveAssistantRuntime(data.workspaceId)

    if (!runtime.ok) return runtime.result
    const result = await askAssistant(data, runtime.deps)

    logger.info(
      'ai.assistant.asked',
      redact({
        workspaceId: data.workspaceId,
        actorUserId: runtime.session.userId,
        model: runtime.deps.settings.model,
        mode: runtime.mode,
        providerProfile: runtime.providerProfile,
        questionChars: data.question.length,
        objectRefs: data.objectRefs.length,
        outcome: result.status,
      }),
    )

    return result
  })

/**
 * In-page AI call (explain, rewrite, summarise, draft). Same session, policy
 * and gateway as the assistant; never writes.
 */
export const runPageAiFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => pageAiSchema.parse(input))
  .handler(async ({ data }): Promise<PageAiResult> => {
    const runtime = await resolveAssistantRuntime(data.workspaceId)

    if (!runtime.ok) return runtime.result
    const result = await runPageAi(data, runtime.deps)
    logger.info(
      'ai.page.ran',
      redact({
        workspaceId: data.workspaceId,
        actorUserId: runtime.session.userId,
        task: data.task,
        model: runtime.deps.settings.model,
        mode: runtime.mode,
        providerProfile: runtime.providerProfile,
        textChars: data.text.length,
        objectRefs: data.objectRefs.length,
        outcome: result.status,
      }),
    )

    return result
  })
