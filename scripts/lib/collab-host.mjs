import { createCollabServer } from './collab-server.mjs'

export { COLLAB_PATH } from './collab-server.mjs'

/**
 * Wires the bundled co-editing server to the app it runs beside. Access is
 * never decided here: each connection asks the app's own
 * `/api/collaboration/ticket` endpoint, with the browser's cookies, who the
 * person is and whether they may read or write the room. So a room follows
 * exactly the same session, membership and per-object permissions as the rest
 * of Sheetbase.
 *
 * @param {{
 *   fetchApp: (request: Request) => Promise<Response>,
 *   log?: Parameters<typeof createCollabServer>[0]['log'],
 * }} options
 */
export function createCollabHost({ fetchApp, log }) {
  return createCollabServer({
    log,
    authorize: async (incoming, room) => {
      const forwardedProto = String(incoming.headers['x-forwarded-proto'] ?? '')
        .split(',')[0]
        .trim()
      const scheme = forwardedProto === 'https' ? 'https' : 'http'
      const host = String(incoming.headers.host ?? 'localhost')
      const url = new URL(
        `/api/collaboration/ticket?room=${encodeURIComponent(room)}`,
        `${scheme}://${host}`,
      )
      const headers = new Headers()
      for (const name of [
        'cookie',
        'authorization',
        'user-agent',
        'x-forwarded-for',
        'x-forwarded-proto',
      ]) {
        const value = incoming.headers[name]
        if (typeof value === 'string') headers.set(name, value)
      }
      const response = await fetchApp(new Request(url, { headers }))
      if (!response.ok) return { ok: false, status: response.status }
      const ticket = await response.json()
      return {
        ok: true,
        user: {
          id: ticket.userId,
          name: ticket.name,
          avatar: ticket.avatar ?? null,
        },
        canWrite: ticket.canWrite === true,
      }
    },
  })
}
