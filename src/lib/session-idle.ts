import { sql } from 'drizzle-orm'

import type { db } from '#/db/client.server'

/** How long a session may sit unused in a regulated lab: an unattended bench workstation. */
export const REGULATED_IDLE_SECONDS = 60 * 30
/** How long it may sit unused anywhere else: a working day, so nobody signs in several times a day. */
export const WORKING_DAY_IDLE_SECONDS = 60 * 60 * 12

const CACHE_MS = 30_000
const cache = new Map<string, { seconds: number; at: number }>()

/**
 * The idle window for one person's sessions. Someone who belongs to any
 * regulated lab keeps the short window, so joining a regulated lab never
 * leaves a session open longer than that lab allows.
 */
export async function sessionIdleSeconds(
  database: typeof db,
  userId: string,
  now: number = Date.now(),
): Promise<number> {
  const cached = cache.get(userId)
  if (cached && now - cached.at < CACHE_MS) return cached.seconds
  const result = await database.execute<{ regulated: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
        FROM api.workspace_memberships m
        JOIN api.workspace_settings s ON s.workspace_id = m.workspace_id
       WHERE m.user_id = ${userId} AND m.suspended_at IS NULL AND s.regulated_lab
    ) AS regulated`)
  const seconds = result.rows[0]?.regulated
    ? REGULATED_IDLE_SECONDS
    : WORKING_DAY_IDLE_SECONDS
  cache.set(userId, { seconds, at: now })
  return seconds
}

/** Forget what was cached, so a changed setting applies at once (and tests stay isolated). */
export function resetSessionIdleCache(): void {
  cache.clear()
}
