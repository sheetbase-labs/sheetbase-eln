/**
 * Search by meaning, the query half. Runs under the caller's own access: the
 * query is turned into a vector with the workspace's embeddings profile, then
 * api.semantic_search ranks stored chunks through row security, so a hidden
 * object cannot appear. Merged with the ordinary word search by rank.
 */
import {
  MIN_SIMILARITY,
  fuseRankings,
  toSemanticHit,
  vectorArg,
} from './ai-embeddings'
import type { SemanticHit, SemanticHitWire } from './ai-embeddings'
import { getProviderConfiguration } from './ai-providers/config.server'
import { embedTexts } from './ai-providers/embeddings'
import { isCloudProvider } from './ai-providers/types'
import type { ProviderDeps, ProviderProfile } from './ai-providers/types'
import type { DataClient } from './data-client'
import { executeSearch } from './search'
import type { RpcSearchResult, SearchResultType } from './search'

export type SemanticUnavailableReason =
  | 'ai_off'
  | 'not_enabled'
  | 'no_profile'
  | 'profile_missing'
  | 'key_missing'
  | 'consent_required'
  | 'not_indexed'

export class SemanticUnavailableError extends Error {
  readonly reason: SemanticUnavailableReason
  constructor(reason: SemanticUnavailableReason) {
    super(semanticUnavailableMessage(reason))
    this.name = 'SemanticUnavailableError'
    this.reason = reason
  }
}

export function semanticUnavailableMessage(
  reason: SemanticUnavailableReason,
): string {
  switch (reason) {
    case 'ai_off':
      return 'AI is off for this workspace, so searching by meaning is off too.'
    case 'not_enabled':
      return 'Searching by meaning is not turned on. A workspace owner can turn it on in Settings, AI.'
    case 'no_profile':
    case 'profile_missing':
      return 'No embeddings model is set up for this workspace. A workspace owner can choose one in Settings, AI.'
    case 'key_missing':
      return 'The chosen embeddings model has no key on this deployment.'
    case 'consent_required':
      return 'The chosen embeddings model sends text to a cloud provider. An owner must record consent first in Settings, AI.'
    case 'not_indexed':
      return 'Nothing has been read for searching by meaning yet. It fills in over the next few minutes.'
  }
}

interface SettingsRow {
  ai_enabled: boolean
  ai_cloud_egress_enabled: boolean
  semantic_search_enabled: boolean
  embeddings_profile: string | null
  literature_search_enabled: boolean
}

export async function readSemanticRow(
  client: DataClient,
  workspaceId: string,
): Promise<SettingsRow | null> {
  const rows = await client.list<SettingsRow>(
    'workspace_settings',
    `?select=ai_enabled,ai_cloud_egress_enabled,semantic_search_enabled,embeddings_profile,literature_search_enabled&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
  )
  return rows[0] ?? null
}

export interface ResolvedEmbeddings {
  profile: ProviderProfile
  apiKey: string | undefined
}

/** Why a workspace can or cannot be searched by meaning right now. */
export function resolveEmbeddings(
  row: SettingsRow | null,
  profiles: readonly ProviderProfile[],
): ResolvedEmbeddings {
  if (!row?.ai_enabled) throw new SemanticUnavailableError('ai_off')
  if (!row.semantic_search_enabled) {
    throw new SemanticUnavailableError('not_enabled')
  }
  if (!row.embeddings_profile) throw new SemanticUnavailableError('no_profile')
  const profile = profiles.find((p) => p.id === row.embeddings_profile)
  if (!profile?.embeddingModel || profile.kind === 'anthropic') {
    throw new SemanticUnavailableError('profile_missing')
  }
  if (isCloudProvider(profile.kind) && !row.ai_cloud_egress_enabled) {
    throw new SemanticUnavailableError('consent_required')
  }
  const apiKey = profile.apiKeyEnv ? process.env[profile.apiKeyEnv] : undefined
  if (profile.apiKeyEnv && !apiKey) {
    throw new SemanticUnavailableError('key_missing')
  }
  return { profile, apiKey }
}

export async function embedQuery(
  client: DataClient,
  workspaceId: string,
  query: string,
  deps: ProviderDeps = {},
): Promise<number[]> {
  const row = await readSemanticRow(client, workspaceId)
  const configuration = getProviderConfiguration()
  const { profile, apiKey } = resolveEmbeddings(row, configuration.profiles)
  const done = await embedTexts(profile, apiKey, [query.slice(0, 4000)], deps)
  return done.vectors[0]!
}

export interface SemanticSearchOptions {
  limit?: number
  types?: readonly SearchResultType[]
  deps?: ProviderDeps
}

/** Meaning-only ranking: the closest chunks, one hit per object. */
export async function semanticHits(
  client: DataClient,
  workspaceId: string,
  query: string,
  options: SemanticSearchOptions = {},
): Promise<SemanticHit[]> {
  const vector = await embedQuery(client, workspaceId, query, options.deps)
  const raw = await client.rpc<SemanticHitWire | SemanticHitWire[] | null>(
    'semantic_search',
    {
      p_embedding: vectorArg(vector),
      p_limit: options.limit ?? 20,
      p_types: options.types?.length ? [...options.types] : null,
    },
  )
  const rows = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
  return rows
    .map(toSemanticHit)
    .filter((hit) => hit.similarity >= MIN_SIMILARITY)
}

export interface HybridHit {
  type: SearchResultType
  id: string
  identifier: string
  title: string
  status: string
  kind: string
  archived: boolean
  deepLink: string
  /** Words that matched, or the passage that matched by meaning. */
  context: string
  byWords: boolean
  byMeaning: boolean
  similarity: number | null
}

function fromWords(
  row: RpcSearchResult,
): Omit<HybridHit, 'byWords' | 'byMeaning' | 'similarity'> {
  return {
    type: row.resultType,
    id: row.recordId,
    identifier: row.identifier,
    title: row.title,
    status: row.status,
    kind: row.kind,
    archived: row.archived,
    deepLink: row.deepLink,
    context: row.matchedContext.replace(/<\/?b>/g, ''),
  }
}

/**
 * Word search and meaning search merged by rank. If meaning search is not
 * available the words alone are returned and `meaning` says why, so the page
 * can say so instead of silently showing less.
 */
export async function hybridSearch(
  client: DataClient,
  workspaceId: string,
  query: string,
  options: SemanticSearchOptions = {},
): Promise<{
  hits: HybridHit[]
  meaning: { used: true } | { used: false; reason: SemanticUnavailableReason }
}> {
  const limit = options.limit ?? 20
  const wordsPromise = executeSearch(client, {
    query,
    limit: limit * 2,
    offset: 0,
  }).catch(() => [] as RpcSearchResult[])
  let meaningHits: SemanticHit[] = []
  let meaning:
    { used: true } | { used: false; reason: SemanticUnavailableReason } = {
    used: true,
  }
  try {
    meaningHits = await semanticHits(client, workspaceId, query, {
      ...options,
      limit: limit * 2,
    })
  } catch (error) {
    if (!(error instanceof SemanticUnavailableError)) throw error
    meaning = { used: false, reason: error.reason }
  }
  const words = await wordsPromise
  const wordKeys = words.map((row) => ({
    type: row.resultType,
    id: row.recordId,
  }))
  const meaningKeys = meaningHits.map((hit) => ({ type: hit.type, id: hit.id }))
  const fused = fuseRankings([wordKeys, meaningKeys], limit)
  const byWords = new Map(
    words.map((row) => [`${row.resultType}:${row.recordId}`, row]),
  )
  const byMeaning = new Map(
    meaningHits.map((hit) => [`${hit.type}:${hit.id}`, hit]),
  )
  const hits = fused.map(({ item }): HybridHit => {
    const key = `${item.type}:${item.id}`
    const w = byWords.get(key)
    const m = byMeaning.get(key)
    if (w) {
      const base = fromWords(w)
      return {
        ...base,
        context: base.context || m?.passage || '',
        byWords: true,
        byMeaning: m !== undefined,
        similarity: m?.similarity ?? null,
      }
    }
    const hit = m!
    return {
      type: hit.type,
      id: hit.id,
      identifier: hit.identifier,
      title: hit.title,
      status: hit.status,
      kind: hit.kind,
      archived: hit.archived,
      deepLink: hit.deepLink,
      context: hit.passage,
      byWords: false,
      byMeaning: true,
      similarity: hit.similarity,
    }
  })
  return { hits, meaning }
}

/** Work that reads like an object, from its stored vectors; needs no provider call. */
export async function similarWork(
  client: DataClient,
  objectType: SearchResultType,
  objectId: string,
  options: { limit?: number; types?: readonly SearchResultType[] } = {},
): Promise<SemanticHit[]> {
  const raw = await client.rpc<SemanticHitWire | SemanticHitWire[] | null>(
    'similar_work',
    {
      p_object_type: objectType,
      p_object_id: objectId,
      p_limit: options.limit ?? 8,
      p_types: options.types?.length ? [...options.types] : null,
    },
  )
  const rows = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
  return rows
    .map(toSemanticHit)
    .filter((hit) => hit.similarity >= MIN_SIMILARITY)
}
