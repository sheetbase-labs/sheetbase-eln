/**
 * Search by meaning, the background half: read the text of searchable objects
 * into vectors, for workspaces that turned it on.
 *
 * Each sweep takes the objects whose text changed since they were last read (or
 * that were never read), cuts them into chunks, asks the workspace's embeddings
 * profile for a vector per chunk and stores them. An unchanged object is not
 * sent again (its text hash matches), and a workspace with AI off, no profile,
 * or a cloud profile it has not consented to is skipped entirely: nothing
 * leaves the deployment for it. Runs with the privileged app connection, like
 * the other sweeps, and writes only api.search_embeddings.
 */
import { createHash } from 'node:crypto'

import type { QueryResultRow } from 'pg'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'

import { SEMANTIC_OBJECT_TYPES, chunkDocument } from './ai-embeddings'
import { getProviderConfiguration } from './ai-providers/config.server'
import { EMBEDDING_BATCH, embedTexts } from './ai-providers/embeddings'
import { isCloudProvider } from './ai-providers/types'
import type { ProviderDeps, ProviderProfile } from './ai-providers/types'
import { logger } from './logger'

export const EMBEDDING_SWEEP_DOCUMENTS = 25
const SWEEP_INTERVAL_MS = 60_000
const MAX_BATCHES_PER_SWEEP = 20

export interface EmbeddingConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

interface WorkspaceRow extends QueryResultRow {
  workspace_id: string
  embeddings_profile: string
  ai_cloud_egress_enabled: boolean
}

interface PendingRow extends QueryResultRow {
  object_type: string
  object_id: string
  workspace_id: string
  title: string
  identifier: string
  kind: string
  body: string
  old_hash: string | null
  old_model: string | null
}

export interface EmbeddingSweepResult {
  workspaces: number
  scanned: number
  embedded: number
  unchanged: number
  failed: number
  chunks: number
  tokens: number
}

export type EmbedFn = typeof embedTexts

export function documentHash(doc: {
  title: string
  identifier: string
  kind: string
  body: string
}): string {
  return createHash('md5')
    .update(`${doc.title}\n${doc.identifier}\n${doc.kind}\n${doc.body}`)
    .digest('hex')
}

/** The name a workspace's vectors are filed under: a different model means a different space. */
export function embeddingModelId(profile: ProviderProfile): string {
  return `${profile.id}:${profile.embeddingModel ?? profile.model}`
}

function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((v) => Math.round(v * 1e7) / 1e7).join(',')}]`
}

interface UsableProfile {
  profile: ProviderProfile
  apiKey: string | undefined
}

/**
 * Workspaces that may be read into vectors right now, with the profile each
 * will use. A cloud profile needs the workspace's recorded consent, as for the
 * assistant.
 */
export async function usableWorkspaces(
  conn: EmbeddingConnection,
  profiles: readonly ProviderProfile[],
): Promise<Map<string, UsableProfile>> {
  const { rows } = await conn.query<WorkspaceRow>(
    `SELECT workspace_id, embeddings_profile, ai_cloud_egress_enabled
       FROM api.workspace_settings
      WHERE semantic_search_enabled AND ai_enabled
        AND embeddings_profile IS NOT NULL`,
  )
  const out = new Map<string, UsableProfile>()
  for (const row of rows) {
    const profile = profiles.find((p) => p.id === row.embeddings_profile)
    if (!profile?.embeddingModel || profile.kind === 'anthropic') continue
    if (isCloudProvider(profile.kind) && !row.ai_cloud_egress_enabled) continue
    const apiKey = profile.apiKeyEnv
      ? process.env[profile.apiKeyEnv]
      : undefined
    if (profile.apiKeyEnv && !apiKey) continue
    out.set(row.workspace_id, { profile, apiKey })
  }
  return out
}

/** One batch: returns what it did, and how many objects it looked at. */
export async function sweepEmbeddingsBatch(
  conn: EmbeddingConnection,
  profiles: readonly ProviderProfile[],
  options: { limit?: number; embed?: EmbedFn; deps?: ProviderDeps } = {},
): Promise<EmbeddingSweepResult> {
  const embed = options.embed ?? embedTexts
  const result: EmbeddingSweepResult = {
    workspaces: 0,
    scanned: 0,
    embedded: 0,
    unchanged: 0,
    failed: 0,
    chunks: 0,
    tokens: 0,
  }
  const usable = await usableWorkspaces(conn, profiles)
  result.workspaces = usable.size
  if (usable.size === 0) return result

  const { rows } = await conn.query<PendingRow>(
    `SELECT d.object_type, d.object_id, d.workspace_id, d.title, d.identifier,
            d.kind, d.body, e.text_hash AS old_hash, e.model_id AS old_model
       FROM api.search_documents d
       LEFT JOIN api.search_embeddings e
              ON e.object_type = d.object_type AND e.object_id = d.object_id
             AND e.chunk_no = 0
      WHERE d.workspace_id = ANY ($1::uuid[])
        AND d.object_type = ANY ($2::text[])
        AND (d.title <> '' OR d.identifier <> '' OR d.body <> '')
        AND (e.object_id IS NULL OR d.updated_at > e.updated_at)
      ORDER BY d.updated_at DESC NULLS LAST
      LIMIT $3`,
    [
      [...usable.keys()],
      [...SEMANTIC_OBJECT_TYPES],
      options.limit ?? EMBEDDING_SWEEP_DOCUMENTS,
    ],
  )
  result.scanned = rows.length

  // A workspace whose provider errors is left alone until the next sweep.
  const broken = new Set<string>()
  for (const row of rows) {
    const use = usable.get(row.workspace_id)
    if (!use || broken.has(row.workspace_id)) continue
    const modelId = embeddingModelId(use.profile)
    const hash = documentHash(row)
    try {
      if (row.old_hash === hash && row.old_model === modelId) {
        await conn.query(
          `UPDATE api.search_embeddings SET updated_at = now()
            WHERE object_type = $1 AND object_id = $2`,
          [row.object_type, row.object_id],
        )
        result.unchanged += 1
        continue
      }
      const chunks = chunkDocument(row)
      const vectors: number[][] = []
      for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH) {
        const part = chunks.slice(i, i + EMBEDDING_BATCH)
        const done = await embed(
          use.profile,
          use.apiKey,
          part.map((chunk) => chunk.text),
          options.deps,
        )
        vectors.push(...done.vectors)
        result.tokens += done.tokens
      }
      await conn.query('BEGIN')
      try {
        await conn.query(
          `DELETE FROM api.search_embeddings
            WHERE object_type = $1 AND object_id = $2`,
          [row.object_type, row.object_id],
        )
        for (const [index, chunk] of chunks.entries()) {
          await conn.query(
            `INSERT INTO api.search_embeddings
               (workspace_id, object_type, object_id, chunk_no, chunk_text,
                text_hash, model_id, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::extensions.vector)`,
            [
              row.workspace_id,
              row.object_type,
              row.object_id,
              chunk.chunkNo,
              chunk.text,
              hash,
              modelId,
              vectorLiteral(vectors[index]),
            ],
          )
        }
        await conn.query('COMMIT')
      } catch (error) {
        await conn.query('ROLLBACK')
        throw error
      }
      result.embedded += 1
      result.chunks += chunks.length
    } catch (error) {
      result.failed += 1
      broken.add(row.workspace_id)
      logger.warn('embedding sweep could not read an object', {
        workspace_id: row.workspace_id,
        object_type: row.object_type,
        object_id: row.object_id,
        profile: use.profile.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

/** Walk batches until nothing is left or the cap is reached. */
export async function sweepEmbeddings(
  conn: EmbeddingConnection,
  profiles: readonly ProviderProfile[],
  options: {
    limit?: number
    maxBatches?: number
    embed?: EmbedFn
    deps?: ProviderDeps
  } = {},
): Promise<EmbeddingSweepResult> {
  const total: EmbeddingSweepResult = {
    workspaces: 0,
    scanned: 0,
    embedded: 0,
    unchanged: 0,
    failed: 0,
    chunks: 0,
    tokens: 0,
  }
  const limit = options.limit ?? EMBEDDING_SWEEP_DOCUMENTS
  for (let batch = 0; batch < (options.maxBatches ?? MAX_BATCHES_PER_SWEEP);) {
    batch += 1
    const done = await sweepEmbeddingsBatch(conn, profiles, options)
    total.workspaces = done.workspaces
    for (const key of [
      'scanned',
      'embedded',
      'unchanged',
      'failed',
      'chunks',
      'tokens',
    ] as const) {
      total[key] += done[key]
    }
    // A failed object stays pending, so stop rather than retry it in a loop.
    if (done.scanned < limit || done.failed > 0) break
  }
  return total
}

export async function connectForEmbeddings(): Promise<EmbeddingConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()
  return {
    query: async (text, values = []) => client.query(text, values),
    end: () => client.end(),
  }
}

const startedGlobalKey = '__sheetbaseEmbeddingIndexerStarted'

function disabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

/** Sweep every minute in the background. Errors are logged and never reach the server. */
export function startEmbeddingIndexer(): void {
  if (typeof window !== 'undefined') return
  if (disabled()) return
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true
  let running = false
  const tick = () => {
    if (running) return
    running = true
    void (async () => {
      const configuration = getProviderConfiguration()
      if (configuration.error || configuration.profiles.length === 0) return
      const startedAt = Date.now()
      const conn = await connectForEmbeddings()
      try {
        const result = await sweepEmbeddings(conn, configuration.profiles)
        if (result.scanned > 0) {
          logger.info('embedding sweep complete', {
            ...result,
            durationMs: Date.now() - startedAt,
          })
        }
      } finally {
        await conn.end()
      }
    })()
      .catch((error: unknown) => {
        logger.warn('embedding sweep failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        running = false
      })
  }
  setTimeout(() => {
    tick()
    setInterval(tick, SWEEP_INTERVAL_MS).unref()
  }, 30_000).unref()
}
