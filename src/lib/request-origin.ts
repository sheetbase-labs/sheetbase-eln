/**
 * Same-origin check for state-changing requests. Behind a hosting proxy the
 * server sees its own internal `http://` address, so comparing the browser's
 * Origin with the request URL alone rejects every legitimate request. The
 * browser origin is also accepted when it matches the forwarded public host
 * or the configured public URL of the site.
 */
function originOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function firstValue(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null
}

export function isSameOriginRequest(
  request: Request,
  publicUrl?: string | null,
): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const accepted = new Set<string>()
  const own = originOf(request.url)
  if (own) accepted.add(own)
  const proto = firstValue(request.headers.get('x-forwarded-proto'))
  const host =
    firstValue(request.headers.get('x-forwarded-host')) ??
    request.headers.get('host')
  if ((proto === 'https' || proto === 'http') && host) {
    const forwarded = originOf(`${proto}://${host}`)
    if (forwarded) accepted.add(forwarded)
  }
  const configured = originOf(publicUrl)
  if (configured) accepted.add(configured)
  return accepted.has(origin)
}
