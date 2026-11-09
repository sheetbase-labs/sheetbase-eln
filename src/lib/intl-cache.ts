/**
 * Shared `Intl.DateTimeFormat` instances.
 *
 * Building a formatter costs tens of microseconds (it resolves the locale and
 * loads time-zone data); formatting with an existing one costs about one.
 * Helpers such as `formatInstant` run once per table cell or calendar entry,
 * so constructing a formatter on each call dominated their cost. Formatters
 * are immutable, which makes sharing them safe.
 *
 * The cache is keyed by locale and options. Callers pass option literals, so
 * the key set stays small; the bound only guards against an unexpected
 * explosion of distinct keys (for example, many time zones on a server).
 */
const MAX_ENTRIES = 500

const formatters = new Map<string, Intl.DateTimeFormat>()

/**
 * Returns a `Intl.DateTimeFormat` for `locale` and `options`, reusing an
 * earlier one built with the same arguments. Throws exactly as the
 * constructor does (for example, a `RangeError` for an unknown time zone);
 * failures are not cached.
 */
export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormat {
  // JSON drops undefined values, matching Intl, which treats an undefined
  // option the same as an absent one.
  const key = `${locale}\u0000${JSON.stringify(options)}`
  let formatter = formatters.get(key)

  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)

    if (formatters.size >= MAX_ENTRIES) formatters.clear()
    formatters.set(key, formatter)
  }

  return formatter
}
