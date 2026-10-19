/**
 * Server-side display-identifier resolution (DSYS-06). Maps a display
 * identifier (`PRJ-0217`, `EXP-0142`, `DS-0311`, `CB-0012`, …) to the row UUID
 * for the caller's workspace.
 *
 * The lookup runs on a scoped connection with the caller's JWT claims stamped
 * (`SET LOCAL ROLE authenticated`), so PostgREST's row-level security applies,
 * and it additionally filters on `workspace_id` — one workspace can never
 * resolve another workspace's identifier. Read-only: the transaction is
 * committed by `getScopedClient`'s release.
 */
import type { Pool } from 'pg'

import { getScopedClient } from '#/lib/admin-platform'
import type { IdentifierEntity } from '#/lib/identifier-resolution'

interface EntitySpec {
  table: string
  column: string
  /** Records are resolved by identifier; restrict to one kind when the route
   * names a specific one (an experiment or a sample, not any record). */
  kind?: string
  /** `review` addresses a record's latest revision, not the record row. */
  revisionOfRecord?: boolean
}

const ENTITY_SPECS: Record<IdentifierEntity, EntitySpec> = {
  project: { table: 'api.projects', column: 'display_id' },
  dataset: { table: 'api.datasets', column: 'display_id' },
  instrument: { table: 'api.instruments', column: 'display_id' },
  sheet: { table: 'api.sheet_instances', column: 'display_id' },
  pipeline: { table: 'api.pipeline_definitions', column: 'display_id' },
  analysis: { table: 'api.analysis_views', column: 'display_id' },
  record: { table: 'api.records', column: 'identifier' },
  experiment: {
    table: 'api.records',
    column: 'identifier',
    kind: 'experiment',
  },
  sample: { table: 'api.records', column: 'identifier', kind: 'sample' },
  review: {
    table: 'api.records',
    column: 'identifier',
    revisionOfRecord: true,
  },
}

export interface ResolveIdentifierRequest {
  entity: IdentifierEntity
  identifier: string
  workspaceId: string
  userId: string
  /** Test seam: a pool against the test database. Defaults to the app pool. */
  pool?: Pool
}

export async function resolveIdentifier(
  input: ResolveIdentifierRequest,
): Promise<string | null> {
  const spec = ENTITY_SPECS[input.entity]
  const { client, release } = await getScopedClient(
    input.workspaceId,
    input.userId,
    input.pool,
  )
  try {
    if (spec.revisionOfRecord) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT r.id AS id
           FROM api.revisions r
           JOIN api.records rec ON rec.id = r.record_id
          WHERE rec.workspace_id = $1 AND rec.identifier = $2
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT 1`,
        [input.workspaceId, input.identifier],
      )
      return rows[0]?.id ?? null
    }

    const params: string[] = [input.workspaceId, input.identifier]
    let where = `workspace_id = $1 AND ${spec.column} = $2`
    if (spec.kind) {
      params.push(spec.kind)
      where += ` AND kind = $3`
    }
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ${spec.table}
        WHERE ${where}
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      params,
    )
    return rows[0]?.id ?? null
  } finally {
    await release()
  }
}
