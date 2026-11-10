import { z } from 'zod'

/**
 * What Better Auth's after hook reports for one call, decoded once here so the
 * log reads named fields: a plain result (`{ token }`, a session), an APIError
 * (`{ status: 'UNAUTHORIZED', body: { code } }`) or a redirect
 * (`{ status: 'FOUND', headers }`). Malformed `body` and `headers` are treated
 * as absent rather than failing the whole reply, as the log always did.
 */
const authReplySchema = z.object({
  status: z.union([z.string(), z.number()]),
  body: z.object({ code: z.string() }).optional().catch(undefined),
  headers: z.instanceof(Headers).optional().catch(undefined),
})

/**
 * How an auth call ended, for the request log. Better Auth reports failures
 * either as an APIError with a code, or (for link flows) as a redirect back to
 * the app with `?error=CODE`, so both are read.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This function is the boundary that decodes the framework's untyped hook return value, so the raw value has to arrive here.
export function authOutcome(returned: unknown): string {
  const reply = authReplySchema.safeParse(returned)

  // Plain results (`{ status: true }`, a session, a token) are successes.
  if (!reply.success) return 'ok'
  const { status, body, headers } = reply.data
  const location = headers?.get('location')

  if (location) {
    const redirectError = new URL(location, 'http://local').searchParams.get(
      'error',
    )

    return redirectError ? `error:${redirectError}` : 'ok'
  }

  if (body?.code !== undefined) return `error:${body.code}`

  // A redirect with no error is a success; any other APIError is a failure.
  if (status === 'FOUND' || status === 302) return 'ok'

  return `error:${String(status)}`
}
