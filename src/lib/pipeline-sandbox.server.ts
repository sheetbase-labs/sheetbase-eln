/**
 * Pipeline SQL sandbox.
 *
 * Transform SQL is untrusted, so it never runs on the connection that holds
 * the run's authority. It runs on its own connection that logs in directly as
 * the `pipeline_sandbox` role: no table or schema grants, no membership of any
 * other role, no superuser and no ability to create objects outside its own
 * temp schema. There is nothing for a statement to reset to. A
 * `set_config('role', ...)` or `RESET ROLE` lands on the same unprivileged
 * login, and `SET ROLE authenticated` fails because the login is not a member.
 *
 * The earlier design switched the orchestration session (a superuser) into a
 * low-privilege role with `SET LOCAL ROLE`, which the statement itself could
 * undo. The static checks in `./pipelines/statement` are therefore only for
 * authoring feedback; this boundary is what holds when they are bypassed.
 *
 * Data reaches the sandbox by value: the orchestration connection reads the
 * materialized temp tables and the sandbox recreates them in its own session.
 * The sandbox session is discarded when the run's steps finish, taking its temp
 * tables with it.
 */
import { Client } from 'pg'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'

export interface SandboxQueryResult<T extends QueryResultRow> {
  rows: T[]
}

/** One sandbox login session. */
export interface SandboxConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<SandboxQueryResult<T>>
  /** The server-side backend id, so a hung statement can be terminated. */
  backendPid: number
  end: () => Promise<void>
}

/** The read side of a copy: the orchestration connection that owns the temp tables. */
export interface SandboxSource {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<SandboxQueryResult<T>>
}

export type ConnectSandbox = () => Promise<SandboxConnection>

export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxUnavailableError'
  }
}

/** Rows copied per statement; bounds the size of each INSERT payload. */
const COPY_CHUNK_ROWS = 2_000

/** Grace added to the statement timeout before the backend is terminated. */
const WATCHDOG_GRACE_MS = 5_000

export const connectPipelineSandbox: ConnectSandbox = async () => {
  const connectionString = env.PIPELINE_SANDBOX_DATABASE_URL
  if (!connectionString) {
    throw new SandboxUnavailableError(
      'The pipeline SQL sandbox is not configured. Set PIPELINE_SANDBOX_DATABASE_URL to the pipeline_sandbox login.',
    )
  }
  const client = new Client({ connectionString })
  await client.connect()
  const pid = await client.query<{ pid: number }>(
    'SELECT pg_backend_pid() AS pid',
  )
  return {
    query: async (text, values = []) => client.query(text, values),
    backendPid: pid.rows[0].pid,
    end: () => client.end(),
  }
}

export function quoteSandboxIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * A sandbox session for one run's steps. Connects lazily on first use so a run
 * with no SQL step never opens one, and `close()` is always safe to call.
 */
export class SandboxSession {
  private conn: SandboxConnection | null = null
  private readonly loaded = new Set<string>()

  constructor(
    private readonly connect: ConnectSandbox,
    /** Terminates a backend from the trusted side when a statement will not stop. */
    private readonly terminate?: (pid: number) => Promise<void>,
  ) {}

  private async session(): Promise<SandboxConnection> {
    if (!this.conn) this.conn = await this.connect()
    return this.conn
  }

  /** Whether `name` has already been copied into this session. */
  has(name: string): boolean {
    return this.loaded.has(name)
  }

  /**
   * Copy the temp table `pg_temp.<name>` from the source connection into the
   * sandbox, replacing any earlier copy. Values travel as JSON text, never
   * parsed in Node, so wide integers and numerics keep their precision.
   */
  async copyTable(source: SandboxSource, name: string): Promise<void> {
    const sandbox = await this.session()
    const quoted = quoteSandboxIdentifier(name)
    const { rows: columns } = await source.query<{
      name: string
      type: string
    }>(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
        WHERE a.attrelid = to_regclass('pg_temp.' || quote_ident($1))
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [name],
    )
    await sandbox.query(`DROP TABLE IF EXISTS pg_temp.${quoted}`)
    await sandbox.query(
      `CREATE TEMP TABLE ${quoted} (${columns
        .map((c) => `${quoteSandboxIdentifier(c.name)} ${c.type}`)
        .join(', ')})`,
    )
    this.loaded.add(name)
    if (columns.length === 0) return
    const { rows } = await source.query<{ doc: string }>(
      `SELECT row_to_json(t)::text AS doc FROM pg_temp.${quoted} t`,
    )
    for (let i = 0; i < rows.length; i += COPY_CHUNK_ROWS) {
      const chunk = `[${rows
        .slice(i, i + COPY_CHUNK_ROWS)
        .map((r) => r.doc)
        .join(',')}]`
      await sandbox.query(
        `INSERT INTO pg_temp.${quoted}
           SELECT * FROM jsonb_populate_recordset(NULL::pg_temp.${quoted}, $1::jsonb)`,
        [chunk],
      )
    }
  }

  /**
   * Run one statement under a statement timeout. The role setting is a floor
   * the statement can raise for itself, so the session timer also terminates
   * the backend from the trusted side if the statement outlives its budget.
   */
  async run<T extends QueryResultRow>(
    statement: string,
    timeoutSeconds: number,
  ): Promise<{ rows: T[] }> {
    const sandbox = await this.session()
    await sandbox.query(`SET statement_timeout = '${timeoutSeconds}s'`)
    let watchdog: ReturnType<typeof setTimeout> | undefined
    if (this.terminate) {
      const terminate = this.terminate
      watchdog = setTimeout(
        () => void terminate(sandbox.backendPid).catch(() => {}),
        timeoutSeconds * 1000 + WATCHDOG_GRACE_MS,
      )
    }
    try {
      return await sandbox.query<T>(statement)
    } catch (error) {
      // A failed or terminated statement leaves an unknown session: drop it
      // so the next step starts from a clean one.
      await this.close()
      throw error
    } finally {
      if (watchdog) clearTimeout(watchdog)
    }
  }

  async close(): Promise<void> {
    const conn = this.conn
    this.conn = null
    this.loaded.clear()
    await conn?.end().catch(() => {})
  }
}
