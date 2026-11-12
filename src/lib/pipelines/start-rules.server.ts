/**
 * Start rules, read where a start is judged: the scheduler's sweep and the
 * inbound webhook. The judging itself is pure and lives in `start-rules.ts`;
 * this reads what it needs from the database.
 */
import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { parseStartRules } from './start-rules'
import type { StartRules } from './start-rules'

interface Queryable {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
}

/** A run that has not moved for this long is not counted as going. */
const STALE_THRESHOLD_SECONDS = 900

/**
 * The pipeline's start rules, and whether any were set. A pipeline with no
 * rules behaves as it did before they existed (a schedule skips only over its
 * own overlap, an event never waits).
 */
export async function loadStartRules(
  conn: Queryable,
  definitionId: string,
): Promise<{ rules: StartRules; set: boolean }> {
  const { rows } = await conn.query<{ start_rules: unknown }>(
    `SELECT start_rules FROM api.pipeline_definitions WHERE id = $1`,
    [definitionId],
  )

  const raw = rows.at(0)?.start_rules

  const set =
    Object.keys(z.record(z.string(), z.unknown()).catch({}).parse(raw)).length >
    0

  return { rules: parseStartRules(raw), set }
}

/**
 * Is any run of this pipeline going, whichever start began it? A run waiting
 * for a person counts as going. Returns that run, or null.
 */
export async function runGoing(
  conn: Queryable,
  definitionId: string,
  ignoreRunIds: string[] = [],
): Promise<{ id: string; status: string } | null> {
  const { rows } = await conn.query<{ id: string; status: string }>(
    `SELECT r.id, r.status
       FROM api.pipeline_runs r
       JOIN api.pipeline_definition_versions v ON v.id = r.definition_version_id
      WHERE v.definition_id = $1 AND r.status IN ('running', 'waiting')
        AND NOT (r.id = ANY($3::uuid[]))
        AND (r.started_at >= clock_timestamp() - ($2 || ' seconds')::interval
             OR r.status = 'waiting'
             OR internal.pipeline_run_job_is_live(r.id))
      ORDER BY r.started_at DESC LIMIT 1`,
    [definitionId, STALE_THRESHOLD_SECONDS, ignoreRunIds],
  )

  return rows.at(0) ?? null
}
