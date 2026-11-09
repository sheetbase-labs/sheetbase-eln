import { env } from '#/env.server'
import { getPool } from '#/db/pool.server'

/**
 * A version string for the lab logo, or null when there is none. A signed-in
 * member's workspace first; otherwise the install's oldest logo, which is the
 * one the sign-in page shows. The string changes with each new logo, so the
 * page can ask for the image with `?v=` and cache it for good.
 */
export async function labLogoVersion(
  workspaceId?: string | null,
): Promise<string | null> {
  try {
    const { rows } = await getPool(env.DATABASE_URL).query<{ v: string }>(
      workspaceId
        ? `SELECT (extract(epoch FROM logo_updated_at) * 1000)::bigint::text AS v
             FROM api.workspaces WHERE id = $1::uuid AND logo_storage_key IS NOT NULL`
        : `SELECT (extract(epoch FROM logo_updated_at) * 1000)::bigint::text AS v
             FROM api.workspaces
            WHERE logo_storage_key IS NOT NULL AND status = 'active'
            ORDER BY created_at LIMIT 1`,
      workspaceId ? [workspaceId] : [],
    )

    return rows.at(0)?.v ?? null
  } catch {
    // The logo is decoration; a failed read must never stop a page loading.
    return null
  }
}
