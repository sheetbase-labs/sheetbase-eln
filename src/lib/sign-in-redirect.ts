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
export function safeNextPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!value.startsWith('/')) return undefined
  if (value.startsWith('//') || value.includes('\\')) return undefined
  const control = [...value].some((char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
  if (control) return undefined
  return value
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
