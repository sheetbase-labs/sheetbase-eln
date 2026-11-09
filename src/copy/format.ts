import type { CatalogueTree, CopyValue, Message, PluralMessage } from './types'

const pluralRules = new Map<string, Intl.PluralRules>()
const numberFormats = new Map<string, Intl.NumberFormat>()

function rulesFor(locale: string) {
  let rules = pluralRules.get(locale)

  if (!rules) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }

  return rules
}

function numberFormatFor(locale: string) {
  let format = numberFormats.get(locale)

  if (!format) {
    format = new Intl.NumberFormat(locale)
    numberFormats.set(locale, format)
  }

  return format
}

/** Catalogue sections contain messages; `other` identifies a plural leaf. */
export function isMessage(
  value: Message | CatalogueTree | null | undefined,
): value is Message {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The compiled catalogue's message alternatives are strings and plural objects; missing dynamic keys remain non-messages.
  if (typeof value === 'string') return true

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The object alternative is a trusted catalogue section or plural; `other` marks a plural leaf. Keep the existing null-safe missing-key fallback.
  return typeof value === 'object' && value !== null && 'other' in value
}

export function isPlural(message: Message): message is PluralMessage {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Message is the trusted string | PluralMessage union, not unparsed input; its object alternative is always a plural.
  return typeof message === 'object'
}

/** Picks the plural form for `count`. An exact `zero` wins when present. */
export function selectPlural(
  locale: string,
  message: PluralMessage,
  count: number,
): string {
  if (count === 0 && message.zero !== undefined) return message.zero
  const category = rulesFor(locale).select(count)

  return message[category] ?? message.other
}

export function formatValue(locale: string, value: CopyValue): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- CopyValue is already string | number; only the numeric alternative needs Intl number formatting.
  return typeof value === 'number'
    ? numberFormatFor(locale).format(value)
    : value
}

/** Replaces `{name}` with its value. Unknown placeholders are left as is. */
export function interpolate(
  locale: string,
  text: string,
  values: Readonly<Record<string, CopyValue>> | undefined,
): string {
  if (!values) return text

  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? formatValue(locale, values[name]) : whole,
  )
}

const PSEUDO = new Map(
  Object.entries({
    a: 'á',
    b: 'ƀ',
    c: 'ç',
    d: 'ð',
    e: 'é',
    f: 'ƒ',
    g: 'ĝ',
    h: 'ĥ',
    i: 'í',
    j: 'ĵ',
    k: 'ķ',
    l: 'ļ',
    m: 'ɱ',
    n: 'ñ',
    o: 'ó',
    p: 'þ',
    r: 'ŕ',
    s: 'š',
    t: 'ţ',
    u: 'ú',
    w: 'ŵ',
    y: 'ý',
    z: 'ž',
    A: 'Á',
    B: 'Ɓ',
    C: 'Ç',
    D: 'Ð',
    E: 'É',
    F: 'Ƒ',
    G: 'Ĝ',
    H: 'Ĥ',
    I: 'Í',
    J: 'Ĵ',
    K: 'Ķ',
    L: 'Ļ',
    M: 'Ṁ',
    N: 'Ñ',
    O: 'Ó',
    P: 'Þ',
    R: 'Ŕ',
    S: 'Š',
    T: 'Ţ',
    U: 'Ú',
    W: 'Ŵ',
    Y: 'Ý',
    Z: 'Ž',
  }),
)

/**
 * The stretched test language: accents every letter, pads the text by about
 * a third and brackets it, keeping placeholders and tags intact. Text on
 * screen that is not stretched did not come from the catalogue, and a layout
 * that breaks under it will break for longer languages.
 */
export function pseudo(text: string): string {
  let letters = 0

  const body = text.replace(/\{\w+\}|<\/?\w+>|[A-Za-z]/g, (token) => {
    if (token.length !== 1) return token
    letters += 1

    return PSEUDO.get(token) ?? token
  })

  return `⟦${body}${'·'.repeat(Math.ceil(letters / 3))}⟧`
}
