import { getDisplayTimeZone } from '#/lib/display-time-zone'

/** The zone the form starts on: the person's own, else the browser's. */
export function defaultTimeZone(): string {
  return (
    getDisplayTimeZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  )
}

/** Every IANA zone this browser knows, for the zone field's suggestions. */
export function knownTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
}
