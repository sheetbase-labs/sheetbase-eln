/**
 * The settings of the two steps that reach outside the run's own database:
 * a remote job (a script on an HPC queue, which may take hours) and SQL
 * against the lakehouse (the open tables, read as they stand).
 *
 * Plain data and plain checks, so the configuration validator, the editor and
 * the runner all read the same rules. Nothing here imports the configuration
 * module, which imports this one.
 */

import { z } from 'zod'

/** Queue names as a scheduler writes them: `hpc-short`, `gpu.a100`. */
export const REMOTE_QUEUE_RE = /^[a-z0-9][a-z0-9_.-]{0,62}$/

/** A connection is named by the key its steward gave it. */
export const REMOTE_CONNECTION_RE = /^[a-z][a-z0-9-]{0,48}$/

export const MIN_REMOTE_LIMIT_MINUTES = 1

/** A week: longer than that is a project, not a pipeline step. */
export const MAX_REMOTE_LIMIT_MINUTES = 10_080
export const DEFAULT_REMOTE_LIMIT_MINUTES = 60
export const MAX_REMOTE_SCRIPT_LENGTH = 20_000

/** Open tables are named like database tables. */
export const LAKE_TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/
export const MAX_LAKE_TABLES = 10

/** What a remote job step runs, and where. */
export interface PipelineRemoteJob {
  /** The key of the remote job connection a steward set up in Settings. */
  connection: string
  /** A queue that connection offers. */
  queue: string
  /** The script the job runs on the cluster (bash). */
  script: string
  /** The job is stopped, and the run fails, after this long. */
  limitMinutes: number
}

/** Which open tables a lakehouse step reads. */
export interface PipelineLake {
  tables: string[]
}

export const emptyRemoteJob = (): PipelineRemoteJob => ({
  connection: '',
  queue: '',
  script: '',
  limitMinutes: DEFAULT_REMOTE_LIMIT_MINUTES,
})

export const emptyLake = (): PipelineLake => ({ tables: [] })

const remoteJobSchema = z.strictObject({
  connection: z.string(),
  queue: z.string(),
  script: z.string(),
  limitMinutes: z.number(),
})

const lakeSchema = z.strictObject({ tables: z.array(z.string()) })

/** Narrow a stored value to remote job settings; null when it is not that shape. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored version is JSON of any shape until this parses it.
export function readRemoteJob(value: unknown): PipelineRemoteJob | null {
  const parsed = remoteJobSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

/** Narrow a stored value to lakehouse settings; null when it is not that shape. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored version is JSON of any shape until this parses it.
export function readLake(value: unknown): PipelineLake | null {
  const parsed = lakeSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

/** Why remote job settings cannot run, as a code, or null when they can. */
export function remoteJobProblem(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored version is JSON of any shape until this parses it.
  value: unknown,
): 'invalid' | 'connection' | 'queue' | 'script' | 'limit' | null {
  const job = readRemoteJob(value)

  if (!job) return 'invalid'

  if (!REMOTE_CONNECTION_RE.test(job.connection)) return 'connection'

  if (!REMOTE_QUEUE_RE.test(job.queue)) return 'queue'

  if (
    job.script.trim().length === 0 ||
    job.script.length > MAX_REMOTE_SCRIPT_LENGTH
  )
    return 'script'

  if (
    !Number.isInteger(job.limitMinutes) ||
    job.limitMinutes < MIN_REMOTE_LIMIT_MINUTES ||
    job.limitMinutes > MAX_REMOTE_LIMIT_MINUTES
  )
    return 'limit'

  return null
}

/** Why lakehouse settings cannot run, as a code, or null when they can. */
export function lakeProblem(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored version is JSON of any shape until this parses it.
  value: unknown,
): 'invalid' | 'none' | 'many' | 'name' | 'duplicate' | null {
  const lake = readLake(value)

  if (!lake) return 'invalid'

  if (lake.tables.length === 0) return 'none'

  if (lake.tables.length > MAX_LAKE_TABLES) return 'many'

  if (lake.tables.some((name) => !LAKE_TABLE_RE.test(name))) return 'name'

  if (new Set(lake.tables).size !== lake.tables.length) return 'duplicate'

  return null
}

/** `20m`, `3h`, `2 days`: the limit as a person says it. */
export function formatLimit(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440

    return days === 1 ? '1 day' : `${days} days`
  }

  if (minutes % 60 === 0) return `${minutes / 60} h`

  if (minutes > 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`

  return `${minutes} min`
}
