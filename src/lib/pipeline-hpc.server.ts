/**
 * Remote jobs: a pipeline step that sends a script to an HPC queue and waits.
 *
 * The run does not hold a connection for hours. The step sends the job, records
 * it (api.pipeline_remote_jobs), and the run waits like it waits for a person.
 * A sweep asks the scheduler how each open job is doing, stops one that is out
 * of time, and wakes the run once its job has finished. The job gets its table
 * from Sheetbase and gives its answer back over two plain HTTPS calls, so any
 * scheduler that can run a script and reach Sheetbase works:
 *
 *   GET  $SHEETBASE_INPUT_URL   the rows of the step before: { columns, rows }
 *   POST $SHEETBASE_RESULT_URL  { rows: [...] } or { error: "..." }
 *
 * both with `Authorization: Bearer $SHEETBASE_JOB_TOKEN`, a key made for this
 * job alone that stops working when the job is done. Slurm (its REST service,
 * slurmrestd) is the scheduler this file knows how to talk to; the connection
 * says which, and the scheduler sits behind `SchedulerClient`, so another one is
 * a client and nothing else.
 *
 * Nothing in this file reads or writes a secret outside this process: the
 * connection's token comes from the connector's sealed secrets and is only sent
 * to the scheduler.
 */
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { validateConnectorEndpointUrl } from './connectors/enterprise/host-policy.server'
import {
  INPUT_FIELD_LIMIT,
  INPUT_ROW_LIMIT,
  PAYLOAD_BYTE_LIMIT,
  RESULT_CELL_LIMIT,
} from './pipeline-limits'
import type { PythonInputValue } from './pipeline-python.server'
import type { PipelineRemoteJobStep } from './pipelines/config'
import { DEFAULT_REMOTE_SECRET } from './pipelines/remote/settings'

/** The part of a database connection this module needs. */
export interface HpcQueryable {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[]; rowCount?: number | null }>
}

const plainCell = z.union([z.string(), z.number(), z.boolean(), z.null()])

/**
 * A value of the step before as a cell the job can read: text, numbers, true or
 * false and nothing stay as they are, whole numbers and dates become text, and
 * anything built of parts (bytes, lists, objects) is left out.
 */
export function remoteCell(value: PythonInputValue): Cell | undefined {
  const plain = plainCell.safeParse(value)

  if (plain.success) return plain.data
  const big = z.bigint().safeParse(value)

  if (big.success) return String(big.data)

  return value instanceof Date ? value.toISOString() : undefined
}

/** The rows of the step before, as the job reads them. */
export function remoteRowsOf(
  rows: Array<Record<string, PythonInputValue>>,
): RemoteRow[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([name, value]) => [name, remoteCell(value)]),
    ),
  )
}

/** A cell the job may hand back. */
type Cell = string | number | boolean | null

export type RemoteRow = Record<string, Cell | undefined>

// ---------------------------------------------------------------------------
// The connection a steward set up (Settings > Integrations).
// ---------------------------------------------------------------------------

export const HPC_SCHEDULERS = ['slurm'] as const

export interface HpcQueue {
  name: string
  /** The longest job this queue takes; a step asking for more is refused. */
  maxMinutes?: number
}

export interface HpcConnection {
  key: string
  scheduler: (typeof HPC_SCHEDULERS)[number]
  baseUrl: string
  apiVersion: string
  user: string
  queues: HpcQueue[]
  /** Where jobs reach Sheetbase from; the app's own address when absent. */
  callbackUrl?: string
  /** The scheduler's token. Never leaves this process. */
  token: string
}

const connectionConfigSchema = z.object({
  scheduler: z.enum(HPC_SCHEDULERS).default('slurm'),
  apiVersion: z
    .string()
    .regex(/^v[0-9]+\.[0-9]+\.[0-9]+$/)
    .default('v0.0.40'),
  user: z.string().min(1).max(64),
  queues: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,62}$/),
        maxMinutes: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(50),
  callbackUrl: z.string().min(1).optional(),
})

/** A connection a step may use, or the plain words for why it may not. */
export type ConnectionLookup =
  | { kind: 'ready'; connection: HpcConnection }
  | { kind: 'refused'; message: string }

const refused = (message: string): ConnectionLookup => ({
  kind: 'refused',
  message,
})

/** Read a cluster connection's address and settings; a message when they are not usable. */
export function parseHpcConfig(
  key: string,
  baseUrl: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A connection's settings are JSON of any shape until this parses them.
  settings: unknown,
  token: string,
): ConnectionLookup {
  const parsed = connectionConfigSchema.safeParse(settings)

  if (!parsed.success)
    return refused(
      'This remote job connection is not set up: it needs a scheduler address, a user and at least one queue.',
    )

  try {
    validateConnectorEndpointUrl(baseUrl)

    if (parsed.data.callbackUrl)
      validateConnectorEndpointUrl(parsed.data.callbackUrl)
  } catch (error) {
    return refused(
      error instanceof Error ? error.message : 'The address is not valid.',
    )
  }

  return { kind: 'ready', connection: { key, baseUrl, ...parsed.data, token } }
}

// ---------------------------------------------------------------------------
// The scheduler.
// ---------------------------------------------------------------------------

export interface SubmitJob {
  /** Names the job in the scheduler's own queue listing. */
  name: string
  queue: string
  script: string
  limitMinutes: number
  environment: Record<string, string>
}

export type SchedulerState = 'queued' | 'running' | 'finished' | 'failed'

export interface SchedulerClient {
  submit: (job: SubmitJob) => Promise<{ jobId: string }>
  status: (
    jobId: string,
  ) => Promise<{ state: SchedulerState; message?: string }>
  cancel: (jobId: string) => Promise<void>
}

const SLURM_FAILED = new Set([
  'FAILED',
  'CANCELLED',
  'TIMEOUT',
  'NODE_FAIL',
  'OUT_OF_MEMORY',
  'BOOT_FAIL',
  'DEADLINE',
  'PREEMPTED',
])

const SLURM_RUNNING = new Set([
  'RUNNING',
  'COMPLETING',
  'SUSPENDED',
  'STOPPED',
  'CONFIGURING',
  'REQUEUED',
  'RESIZING',
])

const slurmStatusSchema = z.object({
  jobs: z
    .array(z.object({ job_state: z.union([z.string(), z.array(z.string())]) }))
    .min(1),
})

const slurmSubmitSchema = z.object({
  job_id: z.union([z.number(), z.string()]),
})

/** Slurm's REST service (slurmrestd). */
export function slurmClient(
  connection: HpcConnection,
  fetcher: typeof fetch = fetch,
): SchedulerClient {
  const base = `${connection.baseUrl.replace(/\/+$/, '')}/slurm/${connection.apiVersion}`

  const headers = {
    'content-type': 'application/json',
    'x-slurm-user-name': connection.user,
    'x-slurm-user-token': connection.token,
  }

  const call = async (path: string, init: RequestInit) => {
    validateConnectorEndpointUrl(base)

    const response = await fetcher(`${base}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok)
      throw new Error(
        `The scheduler answered ${response.status} ${response.statusText}`.trim(),
      )

    return response
  }

  return {
    async submit(job) {
      const response = await call('/job/submit', {
        method: 'POST',
        body: JSON.stringify({
          job: {
            name: job.name,
            partition: job.queue,
            script: `#!/bin/bash\nset -euo pipefail\n${job.script}\n`,
            time_limit: { set: true, number: job.limitMinutes },
            current_working_directory: '/tmp',
            environment: [
              'PATH=/usr/local/bin:/usr/bin:/bin',
              ...Object.entries(job.environment).map(
                ([name, value]) => `${name}=${value}`,
              ),
            ],
          },
        }),
      })

      const body = slurmSubmitSchema.safeParse(await response.json())

      if (!body.success)
        throw new Error('The scheduler did not say which job it started.')

      return { jobId: String(body.data.job_id) }
    },
    async status(jobId) {
      const response = await call(`/job/${encodeURIComponent(jobId)}`, {
        method: 'GET',
      })

      const body = slurmStatusSchema.safeParse(await response.json())

      if (!body.success)
        throw new Error('The scheduler gave an unreadable answer.')
      const raw = body.data.jobs[0].job_state
      const state = (Array.isArray(raw) ? raw[0] : raw).toUpperCase()

      if (state === 'COMPLETED') return { state: 'finished' }

      if (SLURM_FAILED.has(state))
        return {
          state: 'failed',
          message: `The scheduler ended the job: ${state.toLowerCase().replace(/_/g, ' ')}.`,
        }

      return { state: SLURM_RUNNING.has(state) ? 'running' : 'queued' }
    },
    async cancel(jobId) {
      await call(`/job/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
    },
  }
}

/** Everything the module needs from outside, so a test hands in its own. */
export interface RemoteJobDeps {
  /** The connection with this key, or a message saying why there is none. */
  loadConnection: (
    conn: HpcQueryable,
    workspaceId: string,
    key: string,
    /** The secret the step names, or the default when it names none. */
    secret: string,
  ) => Promise<ConnectionLookup>
  client: (connection: HpcConnection) => SchedulerClient
  /** The address jobs call back on when the connection has none. */
  publicUrl: () => string
  now: () => Date
}

// ---------------------------------------------------------------------------
// One job.
// ---------------------------------------------------------------------------

export type RemoteJobState =
  'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type RemoteJobReason =
  'job_failed' | 'timed_out' | 'no_result' | 'cancelled' | 'submit_failed'

export interface RemoteJobRow {
  id: string
  workspace_id: string
  run_id: string
  step_name: string
  connection_key: string
  queue: string
  secret_name: string | null
  external_job_id: string | null
  state: RemoteJobState
  reason: RemoteJobReason | null
  message: string | null
  limit_minutes: number
  deadline_at: string
  result_rows: number | null
  submitted_at: string
  /** When the scheduler first said the job had ended, if it has. */
  scheduler_done_at: string | null
  finished_at: string | null
}

const OPEN_STATES: RemoteJobState[] = ['submitted', 'running']

/** Time the scheduler gets, on top of the limit, to stop a job before Sheetbase gives up on it. */
const DEADLINE_GRACE_MINUTES = 2

/** How long a finished job may go without giving a table before the step fails. */
const NO_RESULT_GRACE_MINUTES = 5

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')

/** The words a person reads when a job does not give a table. */
export function remoteJobFailure(job: RemoteJobRow, step: string): string {
  const where = `Remote job ${step} on ${job.queue}`

  switch (job.reason) {
    case 'timed_out':
      return `${where} ran out of time after ${job.limit_minutes} minutes and was stopped.`
    case 'no_result':
      return `${where} finished without sending a table back. It must POST its rows to $SHEETBASE_RESULT_URL.`
    case 'cancelled':
      return `${where} was cancelled.`
    case 'submit_failed':
      return `${where} could not be sent: ${job.message ?? 'the scheduler refused it'}.`
    default:
      return `${where} failed${job.message ? `: ${job.message}` : '.'}`
  }
}

export type RemoteStepOutcome =
  | { kind: 'rows'; rows: RemoteRow[] }
  | { kind: 'waiting'; job: RemoteJobRow }
  | { kind: 'error'; message: string }

/** Send the job, or pick up where an earlier pass left it. */
export async function runRemoteJobStep(args: {
  conn: HpcQueryable
  run: { id: string; workspace_id: string }
  step: PipelineRemoteJobStep
  /** The rows of the step before, which the job reads. */
  previous: RemoteRow[]
  deps: RemoteJobDeps
  /** Reproduce: read what the job gave back, never send it again. */
  recordedOnly?: boolean
}): Promise<RemoteStepOutcome> {
  const { conn, run, step, previous, deps } = args
  const settings = step.remoteJob

  const { rows: existing } = await conn.query<RemoteJobRow>(
    `SELECT * FROM api.pipeline_remote_jobs WHERE run_id = $1 AND step_name = $2`,
    [run.id, step.name],
  )

  const known = existing.at(0)

  if (known) {
    if (OPEN_STATES.includes(known.state))
      return args.recordedOnly
        ? {
            kind: 'error',
            message: `Remote job ${step.name} has not finished, so there is no answer to reproduce.`,
          }
        : { kind: 'waiting', job: known }

    if (known.state === 'succeeded') {
      const { rows: data } = await conn.query<{
        result_rows: RemoteRow[] | null
      }>(
        `SELECT result_rows FROM internal.pipeline_remote_job_data WHERE job_id = $1`,
        [known.id],
      )

      const rows = data.at(0)?.result_rows

      if (!rows)
        return {
          kind: 'error',
          message: `Remote job ${step.name} gave its table, but Sheetbase no longer holds it. Run the pipeline again.`,
        }

      return { kind: 'rows', rows }
    }

    return { kind: 'error', message: remoteJobFailure(known, step.name) }
  }

  if (args.recordedOnly)
    return {
      kind: 'error',
      message: `Remote job ${step.name} has no recorded answer to reproduce.`,
    }

  const lookup = await deps.loadConnection(
    conn,
    run.workspace_id,
    settings.connection,
    settings.secret ?? DEFAULT_REMOTE_SECRET,
  )

  if (lookup.kind === 'refused')
    return {
      kind: 'error',
      message: `Remote job ${step.name}: ${lookup.message}`,
    }
  const { connection } = lookup

  const queue = connection.queues.find((q) => q.name === settings.queue)

  if (!queue)
    return {
      kind: 'error',
      message: `Remote job ${step.name}: ${connection.key} has no queue called ${settings.queue}.`,
    }

  if (queue.maxMinutes && settings.limitMinutes > queue.maxMinutes)
    return {
      kind: 'error',
      message: `Remote job ${step.name}: queue ${queue.name} takes jobs up to ${queue.maxMinutes} minutes, and this step asks for ${settings.limitMinutes}.`,
    }

  const id = randomUUID()
  const token = randomBytes(32).toString('hex')

  const callback = (connection.callbackUrl ?? deps.publicUrl()).replace(
    /\/+$/,
    '',
  )

  const client = deps.client(connection)
  let externalId: string

  try {
    externalId = (
      await client.submit({
        name: `sheetbase-${step.name}`.slice(0, 40),
        queue: queue.name,
        script: settings.script,
        limitMinutes: settings.limitMinutes,
        environment: {
          SHEETBASE_INPUT_URL: `${callback}/api/remote-jobs/${id}/input`,
          SHEETBASE_RESULT_URL: `${callback}/api/remote-jobs/${id}/result`,
          SHEETBASE_JOB_TOKEN: token,
        },
      })
    ).jobId
  } catch (error) {
    return {
      kind: 'error',
      message: remoteJobFailure(
        // SAFETY: remoteJobFailure reads only reason, message, queue and limit_minutes, all given here.
        {
          reason: 'submit_failed',
          message:
            error instanceof Error
              ? error.message
              : 'the scheduler did not answer',
          queue: queue.name,
          limit_minutes: settings.limitMinutes,
        } as RemoteJobRow,
        step.name,
      ),
    }
  }

  const deadline = new Date(
    deps.now().getTime() +
      (settings.limitMinutes + DEADLINE_GRACE_MINUTES) * 60_000,
  )

  const { rows } = await conn.query<RemoteJobRow>(
    `INSERT INTO api.pipeline_remote_jobs
       (id, workspace_id, run_id, step_name, connection_key, queue, secret_name, external_job_id, limit_minutes, deadline_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      id,
      run.workspace_id,
      run.id,
      step.name,
      connection.key,
      queue.name,
      settings.secret ?? DEFAULT_REMOTE_SECRET,
      externalId,
      settings.limitMinutes,
      deadline.toISOString(),
    ],
  )

  await conn.query(
    `INSERT INTO internal.pipeline_remote_job_data (job_id, token_sha256, input_rows)
     VALUES ($1, $2, $3::jsonb)`,
    [id, sha256(token), JSON.stringify(previous)],
  )

  return { kind: 'waiting', job: rows[0] }
}

// ---------------------------------------------------------------------------
// What the job calls back on.
// ---------------------------------------------------------------------------

const resultSchema = z.union([
  z.object({
    rows: z.array(
      z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      ),
    ),
  }),
  z.object({ error: z.string().min(1).max(2000) }),
])

export interface JobCallbackDeps {
  /** A transaction on the database, as the app. */
  withTransaction: <T>(fn: (conn: HpcQueryable) => Promise<T>) => Promise<T>
  now: () => Date
}

type JsonBody =
  | Record<string, string | number | boolean | null>
  | { columns: string[]; rows: RemoteRow[] }

const json = (status: number, body: JsonBody) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const found = /^Bearer\s+(\S+)$/i.exec(header)

  return found ? found[1] : null
}

function sameDigest(expected: string, token: string): boolean {
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(sha256(token), 'hex')

  return a.length === b.length && timingSafeEqual(a, b)
}

interface JobAuthRow extends RemoteJobRow {
  token_sha256: string
  input_rows: RemoteRow[] | null
  actor_user_id: string | null
}

/** Check the job and its key; the job's row when both are good, otherwise the answer to give. */
async function authorise(
  conn: HpcQueryable,
  request: Request,
  jobId: string,
): Promise<JobAuthRow | Response> {
  const token = bearer(request)

  if (!token || !z.uuid().safeParse(jobId).success)
    return json(401, { error: 'A job key is required.' })

  const { rows } = await conn.query<JobAuthRow>(
    `SELECT j.*, d.token_sha256, d.input_rows, r.actor_user_id
       FROM api.pipeline_remote_jobs j
       JOIN internal.pipeline_remote_job_data d ON d.job_id = j.id
       JOIN api.pipeline_runs r ON r.id = j.run_id
      WHERE j.id = $1 FOR UPDATE OF j`,
    [jobId],
  )

  const job = rows.at(0)

  if (!job || !sameDigest(job.token_sha256, token))
    return json(401, { error: 'That job key is not valid.' })

  if (!OPEN_STATES.includes(job.state))
    return json(409, { error: 'This job is no longer open.' })

  return job
}

/** `GET …/input`: the rows of the step before the job. */
export async function handleRemoteJobInput(
  request: Request,
  jobId: string,
  deps: JobCallbackDeps,
): Promise<Response> {
  return deps.withTransaction(async (conn) => {
    const job = await authorise(conn, request, jobId)

    if (job instanceof Response) return job
    const rows = job.input_rows ?? []

    return json(200, {
      columns: [...new Set(rows.flatMap((row) => Object.keys(row)))],
      rows,
    })
  })
}

/** `POST …/result`: the job's table, or why it failed. */
export async function handleRemoteJobResult(
  request: Request,
  jobId: string,
  deps: JobCallbackDeps,
): Promise<Response> {
  const text = await request.text()

  if (Buffer.byteLength(text) > PAYLOAD_BYTE_LIMIT)
    return json(413, {
      error: 'That answer is larger than a step may give back.',
    })

  let body: z.infer<typeof resultSchema>

  try {
    const parsed = resultSchema.safeParse(JSON.parse(text))

    if (!parsed.success)
      return json(400, {
        error: 'Send { "rows": [...] } or { "error": "..." }.',
      })
    body = parsed.data
  } catch {
    return json(400, { error: 'The body is not JSON.' })
  }

  return deps.withTransaction(async (conn) => {
    const job = await authorise(conn, request, jobId)

    if (job instanceof Response) return job

    // The change events carry the person the run acts as.
    await conn.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        role: 'authenticated',
        sub: job.actor_user_id,
        workspace_id: job.workspace_id,
      }),
    ])

    if ('error' in body) {
      await conn.query(
        `UPDATE api.pipeline_remote_jobs
            SET state = 'failed', reason = 'job_failed', message = $2, finished_at = now()
          WHERE id = $1`,
        [job.id, body.error.slice(0, 500)],
      )
      await conn.query(
        `UPDATE internal.pipeline_remote_job_data SET input_rows = NULL WHERE job_id = $1`,
        [job.id],
      )

      return json(200, { ok: true })
    }

    const columns = new Set(body.rows.flatMap((row) => Object.keys(row)))

    if (
      body.rows.length > INPUT_ROW_LIMIT ||
      columns.size > INPUT_FIELD_LIMIT ||
      body.rows.length * columns.size > RESULT_CELL_LIMIT
    )
      return json(413, {
        error: `A step gives back at most ${INPUT_ROW_LIMIT} rows and ${RESULT_CELL_LIMIT} cells.`,
      })

    await conn.query(
      `UPDATE internal.pipeline_remote_job_data
          SET result_rows = $2::jsonb, input_rows = NULL WHERE job_id = $1`,
      [job.id, JSON.stringify(body.rows)],
    )
    await conn.query(
      `UPDATE api.pipeline_remote_jobs
          SET state = 'succeeded', result_rows = $2, finished_at = now()
        WHERE id = $1`,
      [job.id, body.rows.length],
    )

    return json(200, { ok: true, rows: body.rows.length })
  })
}

// ---------------------------------------------------------------------------
// The sweep.
// ---------------------------------------------------------------------------

interface OpenJob extends RemoteJobRow {
  actor_user_id: string | null
  run_status: string
}

export interface RemoteSweepReport {
  examined: number
  finished: number
  stopped: number
  /** Runs whose job is done and which are ready to carry on. */
  ready: string[]
}

async function settle(
  conn: HpcQueryable,
  job: OpenJob,
  state: 'failed' | 'cancelled',
  reason: RemoteJobReason,
  message: string | null,
): Promise<void> {
  await conn.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: job.actor_user_id,
      workspace_id: job.workspace_id,
    }),
  ])
  await conn.query(
    `UPDATE api.pipeline_remote_jobs
        SET state = $2, reason = $3, message = $4, finished_at = now()
      WHERE id = $1 AND state IN ('submitted', 'running')`,
    [job.id, state, reason, message?.slice(0, 500) ?? null],
  )
  await conn.query(
    `UPDATE internal.pipeline_remote_job_data SET input_rows = NULL WHERE job_id = $1`,
    [job.id],
  )
}

/**
 * Ask the scheduler about every open job. A job past its time is stopped, a
 * job whose run was cancelled is cancelled, and a job that finished without
 * answering fails the step after a few minutes. The runs whose job is done are
 * handed back for the runner to wake. One unreachable scheduler skips its own
 * jobs and nothing else; the next sweep asks again.
 */
export async function sweepRemoteJobs(
  withTransaction: JobCallbackDeps['withTransaction'],
  deps: RemoteJobDeps,
): Promise<RemoteSweepReport> {
  const report: RemoteSweepReport = {
    examined: 0,
    finished: 0,
    stopped: 0,
    ready: [],
  }

  const ready = new Set<string>()

  const jobs = await withTransaction((conn) =>
    conn
      .query<OpenJob>(
        `SELECT j.*, r.actor_user_id, r.status AS run_status
           FROM api.pipeline_remote_jobs j
           JOIN api.pipeline_runs r ON r.id = j.run_id
          WHERE j.state IN ('submitted', 'running')
          ORDER BY j.submitted_at
          LIMIT 100`,
      )
      .then((result) => result.rows),
  )

  const connections = new Map<string, ConnectionLookup>()

  for (const job of jobs) {
    report.examined += 1
    const cacheKey = `${job.workspace_id}:${job.connection_key}`

    try {
      let connection = connections.get(cacheKey)

      if (connection === undefined) {
        connection = await withTransaction((conn) =>
          deps.loadConnection(
            conn,
            job.workspace_id,
            job.connection_key,
            job.secret_name ?? DEFAULT_REMOTE_SECRET,
          ),
        )
        connections.set(cacheKey, connection)
      }

      const now = deps.now()

      const stop = async (
        reason: RemoteJobReason,
        state: 'failed' | 'cancelled',
        message: string | null,
      ) => {
        if (connection.kind === 'ready' && job.external_job_id) {
          await deps
            .client(connection.connection)
            .cancel(job.external_job_id)
            .catch(() => {})
        }

        await withTransaction((conn) =>
          settle(conn, job, state, reason, message),
        )
        report.stopped += 1
        ready.add(job.run_id)
      }

      if (job.run_status !== 'waiting') {
        // The run was cancelled or ended: nobody wants the job any more.
        await stop('cancelled', 'cancelled', null)
        continue
      }

      if (new Date(job.deadline_at) <= now) {
        await stop('timed_out', 'failed', null)
        continue
      }

      if (connection.kind === 'refused' || !job.external_job_id) continue

      const status = await deps
        .client(connection.connection)
        .status(job.external_job_id)

      if (status.state === 'failed') {
        await withTransaction((conn) =>
          settle(conn, job, 'failed', 'job_failed', status.message ?? null),
        )
        report.finished += 1
        ready.add(job.run_id)
      } else if (status.state === 'finished') {
        // It ended cleanly; its answer should already be here. Give a late
        // answer a few minutes before calling it missing.
        const doneAt = job.scheduler_done_at
          ? new Date(job.scheduler_done_at)
          : null

        if (!doneAt) {
          await withTransaction((conn) =>
            conn.query(
              `UPDATE api.pipeline_remote_jobs SET scheduler_done_at = $2 WHERE id = $1`,
              [job.id, now.toISOString()],
            ),
          )
        } else if (
          now.getTime() - doneAt.getTime() >
          NO_RESULT_GRACE_MINUTES * 60_000
        )
          await stop('no_result', 'failed', null)
      } else if (status.state === 'running' && job.state === 'submitted') {
        await withTransaction((conn) =>
          conn.query(
            `UPDATE api.pipeline_remote_jobs SET state = 'running' WHERE id = $1 AND state = 'submitted'`,
            [job.id],
          ),
        )
      }
    } catch {
      // The scheduler could not be reached or answered badly. The job stays
      // open and the next sweep asks again; its deadline still applies.
      continue
    }
  }

  // Runs whose job finished (here, or by calling back) and which still wait.
  const waiting = await withTransaction((conn) =>
    conn
      .query<{ run_id: string }>(
        `SELECT DISTINCT j.run_id
           FROM api.pipeline_remote_jobs j
           JOIN api.pipeline_runs r ON r.id = j.run_id
          WHERE r.status = 'waiting' AND j.state IN ('succeeded', 'failed', 'cancelled')
            AND NOT EXISTS (
              SELECT 1 FROM api.pipeline_remote_jobs o
               WHERE o.run_id = j.run_id AND o.state IN ('submitted', 'running'))
          LIMIT 50`,
      )
      .then((result) => result.rows),
  )

  for (const row of waiting) ready.add(row.run_id)
  report.ready = [...ready]

  return report
}

/** Cancel a run's open jobs at the scheduler (best effort) and mark them. */
export async function cancelRemoteJobsOfRun(
  withTransaction: JobCallbackDeps['withTransaction'],
  deps: RemoteJobDeps,
  runId: string,
): Promise<number> {
  const jobs = await withTransaction((conn) =>
    conn
      .query<OpenJob>(
        `SELECT j.*, r.actor_user_id, r.status AS run_status
           FROM api.pipeline_remote_jobs j JOIN api.pipeline_runs r ON r.id = j.run_id
          WHERE j.run_id = $1 AND j.state IN ('submitted', 'running')`,
        [runId],
      )
      .then((result) => result.rows),
  )

  for (const job of jobs) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- One job at a time: each cancel is a call to the cluster, and a refusal on one must not race the rest.
    const connection = await withTransaction((conn) =>
      deps.loadConnection(
        conn,
        job.workspace_id,
        job.connection_key,
        job.secret_name ?? DEFAULT_REMOTE_SECRET,
      ),
    )

    if (connection.kind === 'ready' && job.external_job_id)
      await deps
        .client(connection.connection)
        .cancel(job.external_job_id)
        .catch(() => {})
    await withTransaction((conn) =>
      settle(conn, job, 'cancelled', 'cancelled', null),
    )
  }

  return jobs.length
}
