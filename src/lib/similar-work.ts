import { MIN_SIMILARITY, toSemanticHit } from './ai-embeddings'
import type { SemanticHit, SemanticHitWire } from './ai-embeddings'
import type { DataClient } from './data-client'
import type { SearchResultType } from './search'

/** Kinds of object that make sense next to an experiment or dataset. */
export const SIMILAR_WORK_TYPES = [
  'record',
  'file',
  'dataset',
  'sheet',
  'template',
  'analysis',
] as const satisfies readonly SearchResultType[]

/**
 * Work that reads like an object, from its stored vectors; needs no model
 * call. Runs through the caller's own access, so only visible work appears.
 * The object's own comments are left out (they are part of it, not like it).
 */
export async function fetchSimilarWork(
  client: DataClient,
  objectType: SearchResultType,
  objectId: string,
  options: { limit?: number; types?: readonly SearchResultType[] } = {},
): Promise<SemanticHit[]> {
  const limit = options.limit ?? 6

  const raw = await client.rpc<SemanticHitWire | SemanticHitWire[] | null>(
    'similar_work',
    {
      p_object_type: objectType,
      p_object_id: objectId,
      p_limit: limit + 6,
      p_types: [...(options.types ?? SIMILAR_WORK_TYPES)],
    },
  )

  const rows = raw === null ? [] : Array.isArray(raw) ? raw : [raw]

  return rows
    .map(toSemanticHit)
    .filter(
      (hit) => hit.similarity >= MIN_SIMILARITY && hit.parentId !== objectId,
    )
    .slice(0, limit)
}
