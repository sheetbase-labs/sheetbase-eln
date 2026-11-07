/**
 * Setting a repository's token. The token is sealed with the app's key and kept
 * where PostgREST cannot see it; only the publisher reads it back. It is never
 * returned to any caller, so a token is set or replaced, never shown again.
 *
 * Lives in a non-`.server` module so the settings page can import the server
 * function; server-only code loads inside the handler.
 */
import { createServerFn } from '@tanstack/react-start'

export const setPublicationTokenFn = createServerFn({ method: 'POST' })
  .validator((input: { targetId: string; token: string }) => input)
  .handler(async ({ data }) => {
    const token = data.token.trim()
    if (!/^[0-9a-f-]{36}$/i.test(data.targetId)) throw new Error('Unknown repository.')
    if (token.length < 8 || token.length > 500) {
      throw new Error('Paste the access token the repository gave you.')
    }
    const { setPublicationToken } = await import('./targets-admin.server')
    await setPublicationToken(data.targetId, token)
    return { ok: true as const }
  })
