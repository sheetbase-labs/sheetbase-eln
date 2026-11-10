import { t } from '#/copy'

const SEPARATOR = ' / '

/**
 * The location as plain text, shortened, for places that take a string (a phone
 * list's second line). Short paths come back unchanged.
 *
 * Full paths run from site to position ("Cambridge site / Cold room 1 / Freezer
 * FZ-80-01 / Shelf 2 / Rack 3 / BX-LVV-07 / A2"), and at full length they push
 * the columns after them off screen. What is kept is the most specific places,
 * which is what someone fetching a tube reads first.
 */
export function shortLocation(path: string, keep = 3): string {
  const places = path.split(SEPARATOR)

  return places.length <= keep
    ? path
    : t('common.locationTail', { tail: places.slice(-keep).join(SEPARATOR) })
}
