/**
 * SCI-02 — data layer for saved analysis definitions.
 *
 * Typed wrappers over the `api.analysis_definitions` PostgREST resource plus
 * shared source-revision provenance helpers. Every read/write goes through
 * the same `/api/db` boundary and RLS as the rest of the application;
 * PostgreSQL remains authoritative (decisions 0019/0034). Execution itself is
 * pure client-side TypeScript (`runAnalysis`) so rerunning a definition
 * against the same rows is deterministic and traceable to its inputs.
 */
import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import type { SourceRevision } from './analysis-studio-data'
import type { AnalysisDefinition } from './analysis-definition'
import type { ScientificTableWire } from './scientific-sheet-data'

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
 * references, so a saved definition records the exact table + schema
 * revision it was written against (stale-source detection on later loads).
 */
export function captureDefinitionSourceRevisions(
  tables: ScientificTableWire[],
  definition: AnalysisDefinition,
): SourceRevision[] {
  const byId = new Map(tables.map((t) => [t.id, t]))
  return definition.datasets.map((ref) => {
    const table = byId.get(ref.tableId) ?? null
    return {
      tableId: ref.tableId,
      schemaVersion: table?.schema_version ?? 0,
      datasetSchemaId: table?.dataset_schema_id ?? null,
      datasetSchemaRevision: table?.dataset_schema_revision ?? null,
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
 * The server re-reads the referenced definition and its dataset rows, so
 * frozen evidence is authoritative rather than client-asserted.
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
