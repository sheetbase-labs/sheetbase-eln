/** The plugin's text, in one catalogue, same shape as the app's. */
import { z } from 'zod'

import { interpolate, isPlural, selectPlural } from './format'
import { molbio } from './molbio'
import { sequences } from './sequences'
import type { CopyValue } from './types'

const en = {
  molbio,
  sequences,
  registry: { duplicate: { registerAnyway: 'Register anyway' } },
}

const LOCALE = 'en-GB'
const section = z.record(z.string(), z.unknown())

const message = z.union([
  z.string(),
  z.looseObject({
    other: z.string(),
    zero: z.string().optional(),
    one: z.string().optional(),
    two: z.string().optional(),
    few: z.string().optional(),
    many: z.string().optional(),
  }),
])

export function t(
  key: string,
  values?: Readonly<Record<string, CopyValue>>,
): string {
  let node = section.parse(en)
  const parts = key.split('.')
  const last = parts.pop()

  for (const part of parts) {
    const next = section.safeParse(node[part])

    if (!next.success) return key
    node = next.data
  }

  const leaf = message.safeParse(last === undefined ? undefined : node[last])

  if (!leaf.success) return key

  const text = isPlural(leaf.data)
    ? selectPlural(LOCALE, leaf.data, Number(values?.count ?? 0))
    : leaf.data

  return interpolate(LOCALE, text, values)
}
