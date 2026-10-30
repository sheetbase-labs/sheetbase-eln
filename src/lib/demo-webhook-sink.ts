/**
 * Where the demo's outgoing webhooks go.
 *
 * The demo's integrations point at addresses that do not exist, so every
 * delivery failed and the connections page read "Failing" all day. In the
 * sign-in-free demo they point here instead: the app accepts the delivery and
 * says so, which is all a real receiver would do for the demo. It exists
 * nowhere else.
 */
export const DEMO_WEBHOOK_SINK_PATH = '/api/demo/webhook-sink'

export function demoWebhookSinkResponse(
  request: Request,
  demo: boolean,
): Response {
  if (!demo) return new Response('Not found', { status: 404 })
  if (request.method !== 'POST')
    return Response.json({ message: 'POST required.' }, { status: 405 })
  return Response.json(
    { received: true, demo: true },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * The sink's public address for a deployment, or null where there isn't one
 * the delivery engine may call (it only calls public https addresses).
 */
export function demoWebhookSinkUrl(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null
  try {
    const base = new URL(baseUrl)
    if (base.protocol !== 'https:') return null
    const host = base.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    )
      return null
    return new URL(DEMO_WEBHOOK_SINK_PATH, base.origin).toString()
  } catch {
    return null
  }
}
