/**
 * The ICS feed behind a calendar subscription (migration 0079). The database
 * decides which bookings a feed shows; this module only writes them out as an
 * iCalendar document (RFC 5545) that Outlook, Google Calendar and Apple
 * Calendar can subscribe to.
 */

export interface FeedEvent {
  id: string
  title: string
  resource: string
  starts_at: string
  ends_at: string
  all_day: boolean
  /** `tentative`, `confirmed` or `cancelled` today; the database owns the vocabulary. */
  status: string
  location: string | null
  notes: string | null
  updated_at: string
}

export interface Feed {
  name: string
  events: FeedEvent[]
}

/** A secret is 64 hex characters; anything else cannot be a feed. */
export function isFeedToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/** "20261105T093000Z" */
function stamp(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)

  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

/** "20261105" */
function day(value: string): string {
  return stamp(value).slice(0, 8)
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Lines longer than 75 octets continue on the next line after a space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder()

  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let bytes = 0

  for (const char of line) {
    const size = encoder.encode(char).length
    const limit = parts.length === 0 ? 75 : 74

    if (bytes + size > limit) {
      parts.push(current)
      current = ''
      bytes = 0
    }

    current += char
    bytes += size
  }

  parts.push(current)

  return parts.join('\r\n ')
}

function eventLines(event: FeedEvent): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${event.id}@sheetbase`]
  lines.push(`DTSTAMP:${stamp(event.updated_at)}`)

  if (event.all_day) {
    lines.push(`DTSTART;VALUE=DATE:${day(event.starts_at)}`)
    // An all-day end is exclusive: the day after the last day.
    const end = new Date(event.ends_at)
    end.setUTCDate(end.getUTCDate() + 1)
    lines.push(`DTEND;VALUE=DATE:${day(end.toISOString())}`)
  } else {
    lines.push(`DTSTART:${stamp(event.starts_at)}`)
    lines.push(`DTEND:${stamp(event.ends_at)}`)
  }

  lines.push(`SUMMARY:${escapeText(`${event.resource}: ${event.title}`)}`)

  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)

  if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`)
  lines.push(
    `STATUS:${
      event.status === 'cancelled'
        ? 'CANCELLED'
        : event.status === 'tentative'
          ? 'TENTATIVE'
          : 'CONFIRMED'
    }`,
  )
  lines.push('TRANSP:OPAQUE', 'END:VEVENT')

  return lines
}

/** The whole document, with CRLF line ends as the standard asks. */
export function buildIcs(feed: Feed): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sheetbase//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(feed.name)}`,
    // Ask clients to look again every fifteen minutes.
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
    ...feed.events.flatMap(eventLines),
    'END:VCALENDAR',
  ]

  return lines.map(foldLine).join('\r\n') + '\r\n'
}
