/**
 * SCI-02 — data layer for saved analysis definitions.
 *
 * Typed wrappers over the `api.analysis_definitions` PostgREST resource plus
 * source-revision provenance helpers. Every read/write goes through the
 * same `/api/db` boundary and RLS as the rest of the application;
 * PostgreSQL remains authoritative. Definitions reference canonical
 * Datasets (decision 0037); execution itself is pure client-side
 * TypeScript (`runAnalysis`) so rerunning a definition against the same
 * rows is deterministic and traceable to its inputs.
 */
import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import type { SourceRevision } from './analysis-studio-data'
import type { AnalysisDefinition } from './analysis-definition'
import type { CanonicalDatasetSource } from './chart-data'

export { detectStaleSources } from './analysis-studio-data'

export const analysisDefinitionsDataClient = createDataClient()

export const analysisDefinitionQueryKeys = {
  all: ['analysis-definitions'] as const,
  list: () => ['analysis-definitions', 'list'] as const,
  detail: (id: string) => ['analysis-definitions', 'detail', id] as const,
}

export interface AnalysisDefinitionWire {
  id: string
  workspace_id: string
  owner_user_id: string
  name: string
  version: number
  definition: unknown
  source_revisions: SourceRevision[]
  created_at: string
  updated_at: string
}

/**
 * Capture the source revisions for every dataset an analysis definition
 * references, so a saved definition records the exact Dataset + schema
 * revision it was written against (stale-source detection on later loads).
 */
export function captureDefinitionSourceRevisions(
  sources: CanonicalDatasetSource[],
  definition: AnalysisDefinition,
): SourceRevision[] {
  const byId = new Map(sources.map((s) => [s.datasetId, s]))
  return definition.datasets.map((ref) => {
    const source = byId.get(ref.datasetId)
    return {
      datasetId: ref.datasetId,
      schemaVersionNumber: source?.schemaVersionNumber ?? 0,
      revision: source?.revision ?? 0,
    }
  })
}

export async function fetchAnalysisDefinitions(
  client: DataClient = analysisDefinitionsDataClient,
): Promise<AnalysisDefinitionWire[]> {
  return client.list<AnalysisDefinitionWire>(
    'analysis_definitions',
    '?select=*&order=name.asc',
  )
}

export async function fetchAnalysisDefinition(
  client: DataClient,
  id: string,
): Promise<AnalysisDefinitionWire | null> {
  const rows = await client.list<AnalysisDefinitionWire>(
    'analysis_definitions',
    `?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
  )
  return rows[0] ?? null
}

export interface SaveAnalysisDefinitionInput {
  id?: string
  name: string
  definition: AnalysisDefinition
  source_revisions: SourceRevision[]
}

/** Insert a new saved definition; the server assigns id and version 1. */
export async function createAnalysisDefinition(
  client: DataClient,
  input: SaveAnalysisDefinitionInput,
  workspaceId: string,
  userId: string,
): Promise<AnalysisDefinitionWire> {
  return client.insert<AnalysisDefinitionWire>('analysis_definitions', {
    workspace_id: workspaceId,
    owner_user_id: userId,
    name: input.name,
    definition: input.definition,
    source_revisions: input.source_revisions,
  })
}

/**
 * Update an existing definition's body and revisions. The
 * `bump_analysis_definition_version` trigger increments version and
 * updated_at server-side, so the caller re-sends the full definition.
 */
export async function updateAnalysisDefinition(
  client: DataClient,
  id: string,
  input: SaveAnalysisDefinitionInput,
): Promise<AnalysisDefinitionWire> {
  const updated = await client.patch<AnalysisDefinitionWire>(
    'analysis_definitions',
    `?id=eq.${encodeURIComponent(id)}`,
    {
      name: input.name,
      definition: input.definition,
      source_revisions: input.source_revisions,
    },
  )
  return updated[0]
}

/** Save (upsert): insert when no id, update when one is present. */
export async function saveAnalysisDefinition(
  client: DataClient,
  input: SaveAnalysisDefinitionInput,
  workspaceId: string,
  userId: string,
): Promise<AnalysisDefinitionWire> {
  if (input.id) {
    return updateAnalysisDefinition(client, input.id, input)
  }
  return createAnalysisDefinition(client, input, workspaceId, userId)
}

export async function deleteAnalysisDefinition(
  client: DataClient,
  id: string,
): Promise<void> {
  await client.remove(
    'analysis_definitions',
    `?id=eq.${encodeURIComponent(id)}`,
  )
}

// --- SCI-03 lifecycle RPCs -------------------------------------------------

export interface FreezeAnalysisBlockArgs {
  blockId: string
  expectedVersion: number
}

/**
 * Freeze an analysis block through the transactional SECURITY DEFINER RPC.
 * The server re-reads the referenced definition, snapshots the input
 * Dataset into an immutable Dataset Version, and pins that Version plus
 * row-count/checksum provenance — frozen evidence is authoritative rather
 * than client-asserted. Binding to the submitted revision happens inside
 * submission on the server.
 */
export async function freezeAnalysisBlock(
  client: DataClient,
  args: FreezeAnalysisBlockArgs,
): Promise<unknown> {
  return client.rpc('freeze_analysis_block', {
    p_block_id: args.blockId,
    p_expected_version: args.expectedVersion,
  })
}

export async function unfreezeAnalysisBlock(
  client: DataClient,
  args: FreezeAnalysisBlockArgs,
): Promise<unknown> {
  return client.rpc('unfreeze_analysis_block', {
    p_block_id: args.blockId,
    p_expected_version: args.expectedVersion,
  })
}

/**
 * A name the saved-definition check accepts: letters and digits at both ends,
 * letters, digits, space, underscore, dot and hyphen between, at most 100
 * characters. Anything else in the source name becomes a space.
 */
export function definitionNameFrom(base: string, attempt = 1): string {
  const suffix = attempt > 1 ? ` ${attempt}` : ''
  const cleaned = base
    .replace(/[^\p{L}\p{N} _.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  const head = (cleaned || 'Analysis').slice(0, 99 - suffix.length)
  return `${head.replace(/[^\p{L}\p{N}]+$/u, '') || 'Analysis'}${suffix}`
}

/**
 * Put a saved chart view into an analysis block's definition: the statistic's
 * body with the chart beside it, or a chart-only definition when there is no
 * statistic. Saves a new definition and leaves both sources as they were. A
 * name clash is retried with a number, so the person never sees it.
 */
export async function composeAnalysisDefinition(
  client: DataClient,
  input: {
    chartViewId: string
    statisticDefinitionId?: string | null
    name: string
  },
): Promise<AnalysisDefinitionWire> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await client.rpc<AnalysisDefinitionWire>(
        'compose_analysis_definition',
        {
          p_chart_view_id: input.chartViewId,
          p_statistic_definition_id: input.statisticDefinitionId ?? null,
          p_name: definitionNameFrom(input.name, attempt),
        },
      )
    } catch (error) {
      lastError = error
      const code = (error as { code?: string }).code
      if (code !== '23505') throw error
    }
  }
  throw lastError
}
