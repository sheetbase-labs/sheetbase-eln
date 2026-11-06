/**
 * Trusted timestamps: the sweep that asks each workspace's time-stamping
 * authority to timestamp signatures made since the last pass.
 *
 * Nothing is sent anywhere until an admin picks an authority in Settings >
 * Audit. A signature is stamped within a minute of being made; a failed
 * attempt is retried with a growing wait and the signature is left alone
 * (it stays valid, just unstamped) once the sixth attempt fails.
 *
 * What leaves the install is a SHA-256 digest of the signature facts, never
 * the facts themselves.
 */
import type { QueryResultRow } from 'pg'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from '../logger'
import { authorityLabel, canonicalSignedData, sha256Hex } from './signed-data'
import {
  buildTimestampRequest,
  requestTimestamp,
  verifyTimestampResponse,
} from './tsp'
import type { TimestampFetchDeps } from './tsp'

export const TIMESTAMP_SWEEP_INTERVAL_MS = 60_000
const BATCH = 25

export interface TimestampConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

export interface TimestampSweepDeps {
  connect: () => Promise<TimestampConnection>
  fetch?: TimestampFetchDeps['fetch']
}

interface DueRow {
  signature_id: string
  workspace_id: string
  revision_id: string
  record_id: string
  signature_meaning: string
  revision_integrity_digest: string
  signer_user_id: string
  signed_at: string
  authority: string | null
  authority_url: string | null
}

/** Normalise any Postgres timestamptz text to UTC with microseconds. */
export function isoMicros(text: string): string {
  const ms = Date.parse(text)
  if (Number.isNaN(ms)) throw new Error(`unreadable time: ${text}`)
  const fraction = /\.(\d{1,6})(?!\d)/.exec(text)?.[1] ?? ''
  const base = new Date(ms).toISOString().slice(0, 19)
  return `${base}.${fraction.padEnd(6, '0')}Z`
}

/** One pass. Returns how many signatures were stamped and how many failed. */
export async function sweepTimestamps(
  deps: TimestampSweepDeps,
): Promise<{ stamped: number; failed: number }> {
  const conn = await deps.connect()
  let stamped = 0
  let failed = 0
  try {
    const { rows } = await conn.query<DueRow>(
      `SELECT signature_id, workspace_id, revision_id, record_id, signature_meaning,
              revision_integrity_digest, signer_user_id,
              to_char(signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS signed_at,
              authority, authority_url
         FROM internal.signatures_due_timestamp($1)`,
      [BATCH],
    )
    for (const due of rows) {
      try {
        const url = due.authority_url
        if (!url) throw new Error('no time-stamping authority is set')
        const signedData = canonicalSignedData({
          signatureId: due.signature_id,
          workspaceId: due.workspace_id,
          recordId: due.record_id,
          revisionId: due.revision_id,
          revisionIntegrityDigest: due.revision_integrity_digest,
          signerUserId: due.signer_user_id,
          meaning: due.signature_meaning,
          signedAt: isoMicros(due.signed_at),
        })
        const imprint = sha256Hex(signedData)
        const request = buildTimestampRequest(imprint)
        const response = await requestTimestamp(url, request, {
          fetch: deps.fetch,
        })
        const info = verifyTimestampResponse(response, {
          expectedImprintHex: imprint,
          expectedNonce: request.nonce,
        })
        await conn.query(
          `SELECT internal.record_signature_timestamp($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            due.signature_id,
            authorityLabel(due.authority, url),
            url,
            signedData,
            Buffer.from(response).toString('base64'),
            info.genTime,
            info.serial,
            info.signer,
          ],
        )
        stamped++
      } catch (error) {
        failed++
        const message = error instanceof Error ? error.message : String(error)
        await conn.query(
          `SELECT internal.record_signature_timestamp_failure($1, $2)`,
          [due.signature_id, message],
        )
        logger.warn('timestamping a signature failed', {
          signatureId: due.signature_id,
          error: message,
        })
      }
    }
    return { stamped, failed }
  } finally {
    await conn.end()
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null
let running = false
const startedGlobalKey = '__sheetbaseTimestampSchedulerStarted'

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

async function defaultConnect(): Promise<TimestampConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()
  return client
}

export function startTimestampScheduler(
  options: { deps?: TimestampSweepDeps; intervalMs?: number } = {},
): void {
  if (typeof window !== 'undefined') return
  if (schedulerDisabled()) return
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const deps = options.deps ?? { connect: defaultConnect }
  const tick = async () => {
    // A slow authority must not let passes pile up.
    if (running) return
    running = true
    try {
      const { stamped, failed } = await sweepTimestamps(deps)
      if (stamped || failed) {
        logger.info('signature timestamps swept', { stamped, failed })
      }
    } catch (error) {
      logger.warn('timestamp sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }
  bootTimer = setTimeout(() => void tick(), 15_000)
  bootTimer.unref()
  timer = setInterval(
    () => void tick(),
    options.intervalMs ?? TIMESTAMP_SWEEP_INTERVAL_MS,
  )
  timer.unref()
}

export function stopTimestampScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer)
  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  const g = globalThis as unknown as Record<string, unknown>
  delete g[startedGlobalKey]
}
