import { createServerFn } from '@tanstack/react-start'

/**
 * SET-03.1 — the caller's own display name.
 *
 * Better Auth's HTTP `update-user` endpoint only knows about sessions it minted,
 * so an auth-free development deployment (fixed identity, no cookie) answered
 * 401 and the profile form reported "Unauthorized" without saving anything.
 * This runs on the server instead: the change goes through Better Auth wherever
 * sign-in is configured, and otherwise writes the same `internal.user` row the
 * shell, the members list and signing capture read.
 */

/** `update_workspace_name` and the surrounding RPCs allow 1–120 characters. */
const MAX_NAME_LENGTH = 120

export const updateProfileNameFn = createServerFn({ method: 'POST' })
  .validator((input: { name: string }) => input)
  .handler(async ({ data }): Promise<{ name: string }> => {
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    if (!name) throw new Error('Enter your full name.')
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(
        `Use ${MAX_NAME_LENGTH} characters or fewer for your name.`,
      )
    }

    // Loaded inside the handler: `#/lib/auth` reads server-only env and the DB
    // client, and a static import would pull it into the browser bundle.
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    const { isDevAuthFreeEnabled } = await import('#/lib/auth')

    const headers = getRequestHeaders()
    const context = await getCurrentContext(headers)
    if (!context) {
      throw new Error(
        'Your session has ended. Sign in again to change your name.',
      )
    }

    if (isDevAuthFreeEnabled()) {
      // No Better Auth session exists to carry the write, so apply the same
      // update Better Auth would make to the row its identity is read from.
      const { eq } = await import('drizzle-orm')
      const { db } = await import('#/db/client.server')
      const { user } = await import('#/db/schema')
      const updated = await db
        .update(user)
        .set({ name, updatedAt: new Date() })
        .where(eq(user.id, context.user.id))
        .returning({ name: user.name })
      if (!updated[0]) {
        throw new Error(
          'Your account row is missing, so the name was not saved.',
        )
      }
      return { name: updated[0].name }
    }

    const { auth } = await import('#/lib/auth')
    await auth.api.updateUser({ body: { name }, headers })
    return { name }
  })
