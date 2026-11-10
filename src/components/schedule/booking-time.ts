/**
 * Wall-clock ↔ instant conversion for bookings, kept beside the schedule data
 * rather than in the dialog that reads it.
 */
import { getDisplayTimeZone } from '#/lib/display-time-zone'
import { dateTimeFormat } from '#/lib/intl-cache'
import { fetchWorkspaceGeneral } from '#/lib/workspace-general'

/**
 * The IANA time zone a booking is made in — the person's own, else the
 * workspace's. Schedule and Home render bookings on the same clock, so a
 * booking written in another zone would show a different time there. `null` when the setting cannot be read or resolved: the
 * dialog then refuses the booking rather than writing an instant the person did
 * not ask for.
 */
export async function workspaceTimezone(): Promise<string | null> {
  try {
    const zone =
      getDisplayTimeZone() ?? (await fetchWorkspaceGeneral())?.timezone

    if (!zone) return null
    // Resolving the name proves the platform can read it; a name it cannot read
    // would make every conversion silently wrong.
    new Intl.DateTimeFormat('en-US', { timeZone: zone })

    return zone
  } catch {
    return null
  }
}

/**
 * The UTC instant for a wall-clock date and time in an IANA zone. `Intl` turns
 * an instant into a zone but cannot invert, so the zone's offset is read at the
 * naive instant and re-read at the result: the second pass settles the answer
 * across a DST boundary. `null` when the date or time is not one.
 */
export function instantInZone(
  date: string,
  time: string,
  timeZone: string,
): string | null {
  const naiveMs = Date.parse(`${date}T${time}:00.000Z`)

  if (Number.isNaN(naiveMs)) return null
  let instant = new Date(naiveMs)

  for (let pass = 0; pass < 2; pass += 1) {
    instant = new Date(naiveMs - wallClockOffsetMs(instant, timeZone))
  }

  return instant.toISOString()
}

/** Offset (ms) of the timezone at the given UTC instant. */
function wallClockOffsetMs(instant: Date, timeZone: string): number {
  const parts = dateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)

  const wallMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  )

  return wallMs - instant.getTime()
}
