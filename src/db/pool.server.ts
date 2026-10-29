/**
 * One shared connection pool per database login. Every server path that needs
 * a short-lived connection borrows from here instead of opening its own, so
 * the app's total connections stay bounded no matter how many requests,
 * tabs or background jobs are running.
 */
import { Pool } from 'pg'
import type { PoolClient } from 'pg'

import { logger } from '#/lib/logger'

const DEFAULT_POOL_MAX = 10

const pools = new Map<string, Pool>()

function poolMax(): number {
  const parsed = Number(process.env.DB_POOL_MAX)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_POOL_MAX
}

export interface PoolOptions {
  /** Per-statement client-side timeout, for paths that must not hang. */
  queryTimeoutMs?: number
}

export function getPool(
  connectionString: string,
  options: PoolOptions = {},
): Pool {
  const key = `${options.queryTimeoutMs ?? 0}|${connectionString}`
  const existing = pools.get(key)
  if (existing) return existing
  const pool = new Pool({
    connectionString,
    max: poolMax(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(options.queryTimeoutMs
      ? { query_timeout: options.queryTimeoutMs }
      : {}),
  })
  // An idle connection the server drops (restart, failover) emits 'error' on
  // the pool. Unhandled, that takes the whole process down.
  pool.on('error', (error) => {
    logger.warn('database pool connection error', { message: error.message })
  })
  pools.set(key, pool)
  return pool
}

const SESSION_STATE =
  /\bset\s+(session|role)\b|\breset\s+role\b|set_config\([^)]*,\s*false\s*\)|advisory_lock\(|\blisten\b/i
const TX_OPEN = /^\s*(begin|start\s+transaction)\b/i
const TX_CLOSE = /^\s*(commit|rollback|end)\b/i

/**
 * A drop-in for `new Client({ connectionString })` that borrows from the
 * shared pool. `connect()` checks a connection out and `end()` returns it. A
 * connection that was left mid-transaction or carries session-level state is
 * closed instead of being reused, so one caller's state can never reach the
 * next.
 */
export class PooledClient {
  private client: PoolClient | null = null
  private dirty = false
  private inTransaction = false
  private readonly pool: Pool

  constructor(config: { connectionString: string; query_timeout?: number }) {
    this.pool = getPool(config.connectionString, {
      queryTimeoutMs: config.query_timeout,
    })
  }

  async connect(): Promise<void> {
    if (this.client) return
    this.client = await this.pool.connect()
  }

  readonly query = ((...args: unknown[]) => {
    const client = this.client
    if (!client) return Promise.reject(new Error('Client is not connected'))
    const first = args[0]
    const text =
      typeof first === 'string'
        ? first
        : ((first as { text?: string } | undefined)?.text ?? '')
    if (SESSION_STATE.test(text) && !/set\s+local\b/i.test(text)) {
      this.dirty = true
    }
    if (TX_OPEN.test(text)) this.inTransaction = true
    else if (TX_CLOSE.test(text)) this.inTransaction = false
    return (client.query as (...a: unknown[]) => unknown)(...args)
  }) as PoolClient['query']

  async end(): Promise<void> {
    const client = this.client
    if (!client) return
    this.client = null
    client.release(this.dirty || this.inTransaction)
  }
}
