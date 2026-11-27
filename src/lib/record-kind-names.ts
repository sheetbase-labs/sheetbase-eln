import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

import type { DataClient } from '#/lib/data-client'

/**
 * What a lab calls each kind of record, read from its record models rather
 * than guessed from the kind key. "aav_vector" is the AAV vector model, not
 * "Aav vector". The names are kept after a read so plain functions that build
 * a label (a scan result, a peek card) can use them without a hook.
 */
/** `snake_case` and `camelCase` keys and values, said as plain words. */
export function humanise(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

let known = new Map<string, string>()

const modelNameSchema = z.object({ key: z.string(), name: z.string() })

export async function loadRecordKindNames(
  client: DataClient,
): Promise<Map<string, string>> {
  const rows = await client
    .list<unknown>('record_models', '?select=key,name')
    .catch(() => [])

  known = new Map(
    rows.flatMap((row) => {
      const model = modelNameSchema.safeParse(row)

      return model.success ? [[model.data.key, model.data.name] as const] : []
    }),
  )

  return known
}

/** The model's name for a record kind, or the kind said as plain words. */
export function recordKindName(kind: string): string {
  return known.get(kind) ?? humanise(kind)
}

/** Whether a lab model defines this kind (once the names are read). */
export function isModelKind(kind: string): boolean {
  return known.has(kind)
}

/** For tests: forget what was read. */
export function resetRecordKindNames(): void {
  known = new Map()
}

/**
 * The names as a query, for a screen that labels kinds: it re-renders once
 * the lab's model names have arrived.
 */
export function useRecordKindNames(client: DataClient): void {
  useQuery({
    queryKey: ['record-kind-names'],
    queryFn: () => loadRecordKindNames(client),
    staleTime: 60_000,
  })
}
