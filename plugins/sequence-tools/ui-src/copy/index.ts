/** The plugin's text, in one catalogue, same shape as the app's. */
import { interpolate, isPlural, selectPlural } from './format'
import { molbio } from './molbio'
import { sequences } from './sequences'
import type { CopyValue, Message } from './types'

const en = {
  molbio,
  sequences,
  registry: { duplicate: { registerAnyway: 'Register anyway' } },
}

const LOCALE = 'en-GB'

export function t(
  key: string,
  values?: Readonly<Record<string, CopyValue>>,
): string {
  let node: unknown = en
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part]
  }
  if (
    typeof node !== 'string' &&
    !(typeof node === 'object' && node !== null && 'other' in node)
  )
    return key
  const message = node as Message
  const text = isPlural(message)
    ? selectPlural(LOCALE, message, Number(values?.count ?? 0))
    : message
  return interpolate(LOCALE, text, values)
}
