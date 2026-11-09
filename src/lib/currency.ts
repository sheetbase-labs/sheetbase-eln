/**
 * Currencies on prices and rates. A price is stored with a three-letter code;
 * the form offers the common ones and remembers the last one a person used on
 * this device, so the usual currency is already chosen the next time.
 */
export const COMMON_CURRENCIES = [
  'GBP',
  'EUR',
  'USD',
  'CHF',
  'CAD',
  'AUD',
  'JPY',
  'SEK',
  'NOK',
  'DKK',
] as const

const STORAGE_KEY = 'sheetbase.currency'

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value)
}

/** The currency last used on this device, or the lab's usual one. */
export function lastCurrency(): string {
  try {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY)

    if (stored && isCurrencyCode(stored)) return stored
  } catch {
    // Storage can be blocked; the default is fine.
  }

  return 'GBP'
}

export function rememberCurrency(code: string): void {
  if (!isCurrencyCode(code)) return

  try {
    globalThis.localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // Not remembered; nothing is lost.
  }
}

/** The currencies a form offers: the common ones, plus one already in use. */
export function currencyOptions(current: string): string[] {
  return (COMMON_CURRENCIES as readonly string[]).includes(current)
    ? [...COMMON_CURRENCIES]
    : [current, ...COMMON_CURRENCIES]
}
