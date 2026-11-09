/** The feed endpoint's work: look the secret up and write the document. */
import { db } from '#/db/client.server'

import { buildIcs, isFeedToken } from './calendar-feed'
import type { Feed } from './calendar-feed'

export async function readFeed(token: string): Promise<Feed | null> {
  if (!isFeedToken(token)) return null

  const { rows } = await db.$client.query<{ feed: Feed | null }>(
    'SELECT internal.calendar_feed_by_token($1) AS feed',
    [token],
  )

  return rows[0]?.feed ?? null
}

export async function handleFeedRequest(token: string): Promise<Response> {
  // A secret that is not a feed, a revoked one and a former member's all look
  // the same from outside: not found.
  const feed = await readFeed(token.replace(/\.ics$/i, ''))

  if (!feed) return new Response('Not found', { status: 404 })

  return new Response(buildIcs(feed), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="bookings.ics"',
      'Cache-Control': 'private, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
  })
}
