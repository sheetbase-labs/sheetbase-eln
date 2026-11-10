import { z } from 'zod'

/**
 * Sign-in redirects that remember where the person was going.
 *
 * Every protected route sends a signed-out visitor to `/sign-in`. Passing the
 * requested location as `?next=` lets the SSO callback return them there
 * instead of the app root (J-SET-06).
 */

/**
 * The same-origin path the SSO callback may return to, or `undefined`.
 *
 * `startsWith('/')` alone lets an open redirect through: `//evil.example` is a
 * protocol-relative URL, and browsers read `/\evil.example` as `//`, so either
 * would leave the site after sign-in. Only a rooted path with no backslash and
 * no control character is a path on this origin; anything else is dropped, so
 * the callback falls back to the app root.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Route validators and public callers provide raw URL input; decode strings here before checking rooted-path safety.
export function safeNextPath(value: unknown): string | undefined {
  const path = z.string().safeParse(value)

  if (!path.success || !path.data.startsWith('/')) return undefined

  if (path.data.startsWith('//') || path.data.includes('\\')) return undefined

  for (const char of path.data) {
    const code = char.charCodeAt(0)

    if (code < 0x20 || code === 0x7f) return undefined
  }

  return path.data
}

/**
 * Argument for `redirect()` in a `beforeLoad` guard. `/sign-in` itself and the
 * root are not worth returning to, so they carry no `next`.
 */
export function signInRedirect(location: { href: string }) {
  const next = safeNextPath(location.href)

  return {
    to: '/sign-in' as const,
    search:
      next && next !== '/' && !next.startsWith('/sign-in') ? { next } : {},
  }
}
