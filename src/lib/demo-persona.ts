/**
 * "View as" for the sign-in-free demo. One person is switched to another so
 * review and signing between teammates can be shown without signing in. The
 * choice is a cookie; the server only honours it for a real workspace member
 * and only where auth-free mode is on (`getDevSession`).
 */
export const VIEW_AS_COOKIE = 'sb-view-as'

export interface DemoPersona {
  id: string
  name: string
  role: string
}

/** A person's session row in the demo, apart from the default identity's. */
export function personaSessionId(userId: string): string {
  return `dev-auth-free-session-${userId}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseViewAsCookie(header: string | null | undefined) {
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === VIEW_AS_COOKIE) {
      const value = decodeURIComponent(rest.join('='))
      return UUID.test(value) ? value.toLowerCase() : null
    }
  }
  return null
}

/** Writes the choice; an empty id clears it (back to the default person). */
export function writeViewAsCookie(userId: string | null) {
  const attrs = 'path=/; samesite=lax'
  document.cookie = userId
    ? `${VIEW_AS_COOKIE}=${userId}; ${attrs}; max-age=31536000`
    : `${VIEW_AS_COOKIE}=; ${attrs}; max-age=0`
}
