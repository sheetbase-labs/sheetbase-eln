/**
 * REV-05.2 — the server's own audit check. Without it the trail was only ever
 * verified when someone ran `pnpm audit:verify` by hand, so a deployment with no
 * cron entry never said whether its records were intact.
 *
 * Every hour the server looks for workspaces whose last check is more than a day
 * old (or that never had one) and verifies them. Several replicas are harmless:
 * the second finds a fresh result and skips. Guarded like the other schedulers and
 * never started under test runners unless explicitly enabled.
 */
import { Client } from 'pg'

import { env } from '#/env.server'
import { logger } from '#/lib/logger'
import {
  VERIFICATION_MAX_AGE_MS,
  verifyWorkspaces,
} from '#/lib/audit-verification'
import type { VerificationQueryable } from '#/lib/audit-verification'

export const AUDIT_VERIFICATION_INTERVAL_MS = 60 * 60 * 1000

export interface AuditVerificationConnection extends VerificationQueryable {
  end: () => Promise<void>
}

export interface AuditVerificationDeps {
  connect: () => Promise<AuditVerificationConnection>
}

/** One pass: returns how many workspaces were checked and how many failed. */
export async function sweepAuditVerification(
  deps: AuditVerificationDeps,
  maxAgeMs: number = VERIFICATION_MAX_AGE_MS,
): Promise<{ checked: number; failed: number }> {
  const conn = await deps.connect()
  try {
    const results = await verifyWorkspaces(conn, maxAgeMs)
    const failed = results.filter(({ result }) => !result.ok)
    for (const { slug, result } of failed) {
      logger.error('audit verification failed', {
        workspace: slug,
        firstBadSequence: result.chain.firstBadSequence,
        firstBadRevision: result.signedRevisions.firstBadRevisionId,
      })
    }
    return { checked: results.length, failed: failed.length }
  } finally {
    await conn.end()
  }
}

export function createAuditVerificationTick(
  deps: AuditVerificationDeps,
): () => Promise<void> {
  return async () => {
    const startedAt = Date.now()
    try {
      const { checked, failed } = await sweepAuditVerification(deps)
      if (checked > 0) {
        logger.info('audit verification complete', {
          checked,
          failed,
          durationMs: Date.now() - startedAt,
        })
      }
    } catch (error) {
      logger.warn('audit verification sweep failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      })
    }
  }
}

let verificationTimer: ReturnType<typeof setInterval> | null = null
let verificationBootTimer: ReturnType<typeof setTimeout> | null = null
const startedGlobalKey = '__sheetbaseAuditVerificationSchedulerStarted'

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export interface StartAuditVerificationOptions {
  deps?: AuditVerificationDeps
  intervalMs?: number
}

export function startAuditVerificationScheduler(
  options: StartAuditVerificationOptions = {},
): void {
  if (typeof window !== 'undefined') return
  if (schedulerDisabled()) return
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const tick = createAuditVerificationTick(
    options.deps ?? { connect: defaultConnect },
  )
  // First pass shortly after boot, so a fresh or reseeded deployment shows a
  // result straight away, then hourly.
  verificationBootTimer = setTimeout(() => void tick(), 20_000)
  verificationBootTimer.unref()
  verificationTimer = setInterval(
    () => void tick(),
    options.intervalMs ?? AUDIT_VERIFICATION_INTERVAL_MS,
  )
  verificationTimer.unref()
}

export function stopAuditVerificationScheduler(): void {
  if (verificationBootTimer) {
    clearTimeout(verificationBootTimer)
    verificationBootTimer = null
  }
  if (verificationTimer) {
    clearInterval(verificationTimer)
    verificationTimer = null
  }
  const g = globalThis as unknown as Record<string, unknown>
  delete g[startedGlobalKey]
}

/**
 * The function only accepts its owner when no user is signed in, which is the
 * role migrations run as; deployments that keep it separate set
 * MIGRATION_DATABASE_URL, otherwise the app's own connection is used.
 */
async function defaultConnect(): Promise<AuditVerificationConnection> {
  const client = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
  })
  await client.connect()
  return client
}
