/**
 * A large lab's worth of records, for checking that lists, counts and search
 * stay right (and fast) once a workspace outgrows the first page: about ten
 * thousand experiments and fifty thousand samples spread over a few years.
 *
 * Not part of any seed by default. `pnpm db:seed --design --scale` adds it to
 * the design workspace, and the database suite (`tests/db/list-scale.test.ts`)
 * runs it against a scratch database. Idempotent: the same identifiers are
 * written again as no-ops.
 */
import type { Client } from 'pg'

export const SCALE_EXPERIMENTS = 10_000
export const SCALE_SAMPLES = 50_000

/** The statuses the scale experiments cycle through, in this proportion. */
export const SCALE_EXPERIMENT_STATUSES = [
  'draft',
  'planned',
  'in_progress',
  'in_review',
  'approved',
  'approved',
  'approved',
  'on_hold',
] as const

const SAMPLE_STATUSES = [
  'available',
  'available',
  'available',
  'reserved',
  'quarantined',
  'consumed',
] as const

const SAMPLE_TYPES = ['Plasmid', 'Filtrate', 'Cell pellet', 'Lysate', 'Buffer']

export interface ScaleSeedInput {
  workspaceId: string
  /** Experiments are spread over these projects. */
  projectIds: string[]
  /** Records are created by these people in turn. */
  userIds: string[]
  experiments?: number
  samples?: number
}

export async function seedScale(
  client: Pick<Client, 'query'>,
  input: ScaleSeedInput,
): Promise<{ experiments: number; samples: number }> {
  const experiments = input.experiments ?? SCALE_EXPERIMENTS
  const samples = input.samples ?? SCALE_SAMPLES
  const experimentResult = await client.query(
    `INSERT INTO api.records
       (workspace_id, project_id, kind, identifier, title, status,
        created_by_user_id, created_at, updated_at)
     SELECT $1::uuid,
            ($2::uuid[])[1 + n % cardinality($2::uuid[])],
            'experiment',
            'EXP-' || lpad((100000 + n)::text, 6, '0'),
            'Scale run ' || n,
            ($5::text[])[1 + n % cardinality($5::text[])],
            ($3::text[])[1 + n % cardinality($3::text[])],
            now() - make_interval(mins => n * 157),
            now() - make_interval(mins => n * 157)
       FROM generate_series(1, $4::int) AS n
     ON CONFLICT DO NOTHING`,
    [
      input.workspaceId,
      input.projectIds,
      input.userIds,
      experiments,
      SCALE_EXPERIMENT_STATUSES,
    ],
  )
  const sampleResult = await client.query(
    `INSERT INTO api.records
       (workspace_id, project_id, kind, identifier, title, status,
        created_by_user_id, created_at, updated_at, properties)
     SELECT $1::uuid,
            ($2::uuid[])[1 + n % cardinality($2::uuid[])],
            'sample',
            'SMP-' || lpad((100000 + n)::text, 6, '0'),
            'Scale sample ' || n,
            ($5::text[])[1 + n % cardinality($5::text[])],
            ($3::text[])[1 + n % cardinality($3::text[])],
            now() - make_interval(mins => n * 31),
            now() - make_interval(mins => n * 31),
            jsonb_build_object(
              'sampleType', ($6::text[])[1 + n % cardinality($6::text[])],
              'storageLocation', 'Freezer ' || (1 + n % 40) || ', rack ' || (1 + n % 12))
       FROM generate_series(1, $4::int) AS n
     ON CONFLICT DO NOTHING`,
    [
      input.workspaceId,
      input.projectIds,
      input.userIds,
      samples,
      SAMPLE_STATUSES,
      SAMPLE_TYPES,
    ],
  )
  return {
    experiments: experimentResult.rowCount ?? 0,
    samples: sampleResult.rowCount ?? 0,
  }
}
