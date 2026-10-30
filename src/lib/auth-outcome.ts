/**
 * How an auth call ended, for the request log. Better Auth reports failures
 * either as an APIError with a code, or (for link flows) as a redirect back to
 * the app with `?error=CODE`, so both are read.
 */
export function authOutcome(returned: unknown): string {
  if (returned === null || typeof returned !== 'object') return 'ok'
  const reply = returned as {
    status?: unknown
    body?: { code?: unknown }
    headers?: { get?: (name: string) => string | null }
  }
  // Plain results (`{ status: true }`, a session, a token) are successes.
  if (typeof reply.status !== 'string' && typeof reply.status !== 'number')
    return 'ok'
  const location = reply.headers?.get?.('location')
  if (location) {
    const redirectError = new URL(location, 'http://local').searchParams.get(
      'error',
    )
    return redirectError ? `error:${redirectError}` : 'ok'
  }
  const code = reply.body?.code
  if (typeof code === 'string') return `error:${code}`
  const status = reply.status
  // A redirect with no error is a success; any other APIError is a failure.
  if (status === 'FOUND' || status === 302) return 'ok'
  return `error:${String(status)}`
}
