import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import type { SemanticHit, SemanticSettings } from './ai-embeddings'
import type { PublicProviderProfile } from './ai-providers/profiles'
import type {
  HybridHit,
  SemanticUnavailableReason,
} from './semantic-search.server'
import { SEARCH_RESULT_TYPES } from './search'
import { logger, redact } from './logger'
import { canManageSettings } from './settings-access'

/**
 * Server functions for search by meaning. The route imports only these; the
 * provider key, the database and the embeddings call stay on the server.
 */

interface Session {
  userId: string
  workspaceId: string
  canManage: boolean
  token: string
}

async function loadSession(workspaceId: string): Promise<Session> {
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
    canManage: canManageSettings(context.workspace, 'ai'),
    token: auth.context.token,
  }
}

async function dataClient(token: string) {
  const { createServerDataClient } =
    await import('#/lib/server-data-client.server')

  return createServerDataClient(token)
}

export interface SemanticSettingsView {
  settings: SemanticSettings
  /** Models set up on this deployment that can read text into vectors. */
  profiles: PublicProviderProfile[]
  canManage: boolean
}

async function buildView(session: Session): Promise<SemanticSettingsView> {
  const client = await dataClient(session.token)

  const { getPublicProviderProfiles } =
    await import('#/lib/ai-providers/config.server')

  const settings = await client.rpc<SemanticSettings>(
    'semantic_search_settings',
    { p_workspace_id: session.workspaceId },
  )

  return {
    settings,
    profiles: getPublicProviderProfiles().profiles.filter(
      (profile) => profile.embeddings === true,
    ),
    canManage: session.canManage,
  }
}

export const getSemanticSettingsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<SemanticSettingsView> => {
    return buildView(await loadSession(data.workspaceId))
  })

const updateSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  enabled: z.boolean(),
  profile: z.string().min(1).max(80).nullable(),
  literatureEnabled: z.boolean(),
})

export const updateSemanticSettingsFn = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof updateSchema>) => updateSchema.parse(input))
  .handler(async ({ data }): Promise<SemanticSettingsView> => {
    const session = await loadSession(data.workspaceId)

    if (!session.canManage) {
      throw new Error('Your role cannot change AI settings.')
    }

    const view = await buildView(session)

    const chosen = data.profile
      ? view.profiles.find((profile) => profile.id === data.profile)
      : undefined

    if (data.profile && !chosen) {
      throw new Error('That embeddings model is not set up on this deployment.')
    }

    const client = await dataClient(session.token)

    if (data.enabled && chosen?.dataClass === 'cloud') {
      const rows = await client.list<{ ai_cloud_egress_enabled: boolean }>(
        'workspace_settings',
        `?select=ai_cloud_egress_enabled&workspace_id=eq.${encodeURIComponent(data.workspaceId)}`,
      )

      if (!rows[0]?.ai_cloud_egress_enabled) {
        throw new Error(
          'That model sends text to a cloud provider. Allow that for this workspace in the assistant section first.',
        )
      }
    }

    await client.rpc('set_semantic_search_settings', {
      p_workspace_id: data.workspaceId,
      p_enabled: data.enabled,
      p_profile: data.profile,
      p_literature: data.literatureEnabled,
    })
    logger.info(
      'ai.semantic_search.settings.updated',
      redact({
        workspaceId: data.workspaceId,
        actorUserId: session.userId,
        enabled: data.enabled,
        profile: data.profile,
        literatureEnabled: data.literatureEnabled,
      }),
    )

    return buildView(session)
  })

export const reindexEmbeddingsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }): Promise<SemanticSettingsView> => {
    const session = await loadSession(data.workspaceId)

    if (!session.canManage) {
      throw new Error('Your role cannot change AI settings.')
    }

    const client = await dataClient(session.token)
    await client.rpc('reindex_embeddings', { p_workspace_id: data.workspaceId })

    return buildView(session)
  })

const searchSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  types: z.array(z.enum(SEARCH_RESULT_TYPES)).max(20).optional(),
})

export interface HybridSearchView {
  hits: HybridHit[]
  meaning:
    | { used: true }
    | { used: false; reason: SemanticUnavailableReason; message: string }
}

/** Words and meaning together, in one ranked list, under the caller's access. */
export const hybridSearchFn = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof searchSchema>) => searchSchema.parse(input))
  .handler(async ({ data }): Promise<HybridSearchView> => {
    const session = await loadSession(data.workspaceId)
    const client = await dataClient(session.token)

    const { hybridSearch, semanticUnavailableMessage } =
      await import('#/lib/semantic-search.server')

    const out = await hybridSearch(client, data.workspaceId, data.query, {
      limit: data.limit,
      types: data.types,
    })

    return {
      hits: out.hits,
      meaning: out.meaning.used
        ? { used: true }
        : {
            used: false,
            reason: out.meaning.reason,
            message: semanticUnavailableMessage(out.meaning.reason),
          },
    }
  })

export type SimilarWorkView = { hits: SemanticHit[] }

const pluginSearchSchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1).max(500),
})

/** What the plugins' search providers find for the words typed. */
export const pluginSearchFn = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof pluginSearchSchema>) =>
    pluginSearchSchema.parse(input),
  )
  .handler(async ({ data }) => {
    const session = await loadSession(data.workspaceId)
    const client = await dataClient(session.token)

    const { searchWithPlugins } =
      await import('#/lib/extensions/plugin-search.server')

    return searchWithPlugins(client, {
      workspaceId: data.workspaceId,
      actorUserId: session.userId,
      query: data.query,
    })
  })
