import type { Client } from 'pg'

/**
 * An account a spec owns outright, a member of one workspace only.
 *
 * Which workspace the app reads through is the signed-in person's *active*
 * workspace, kept per person in `api.user_preferences`. Specs that moved the
 * shared fixture user's active workspace and put it back afterwards broke
 * every other spec signed in as that user at the same time, so a spec that
 * needs a workspace of its own signs in as an account of its own instead. It
 * belongs to nothing else, so the app opens that workspace with no preference
 * to set. Idempotent: the account is made once and kept.
 */
export async function ensureOwnUser(
  admin: Client,
  user: { id: string; name: string; workspaceId: string; role?: string },
): Promise<string> {
  await admin.query(
    `insert into internal."user"(id, name, email, "emailVerified")
     values ($1, $2, $1 || '@sheetbase.test', true)
     on conflict (id) do nothing`,
    [user.id, user.name],
  )
  await admin.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role)
     values ($1, $2, $3)
     on conflict do nothing`,
    [user.workspaceId, user.id, user.role ?? 'owner'],
  )
  return user.id
}
