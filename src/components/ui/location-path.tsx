import { t } from '#/copy'

const SEPARATOR = ' / '

/**
 * A storage location in a table cell. Full paths run from site to position
 * ("Cambridge site / Cold room 1 / Freezer FZ-80-01 / Shelf 2 / Rack 3 /
 * BX-LVV-07 / A2"), and at full length they push the columns after them off
 * screen. The cell shows the most specific places, which is what someone
 * fetching a tube reads first; the whole path stays available on hover and to
 * assistive technology.
 */
/**
 * The location as plain text, shortened the same way, for places that take a
 * string (a phone list's second line). Short paths come back unchanged.
 */
export function shortLocation(path: string, keep = 3): string {
  const places = path.split(SEPARATOR)

  return places.length <= keep
    ? path
    : t('common.locationTail', { tail: places.slice(-keep).join(SEPARATOR) })
}

export function LocationPath({
  path,
  keep = 3,
}: {
  path: string
  /** How many of the most specific places to show. */
  keep?: number
}) {
  const short = shortLocation(path, keep)

  if (short === path) return <>{path}</>

  return (
    <span title={path} className="whitespace-nowrap">
      <span className="sr-only">{path}</span>
      <span aria-hidden="true">{short}</span>
    </span>
  )
}
