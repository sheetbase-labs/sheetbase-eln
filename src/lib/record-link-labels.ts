/**
 * The records a measurement table column links to, by id.
 *
 * A link column stores the record's UUID. People read the record's identifier
 * (SMP-2231), so every screen that shows a link column looks the ids up here,
 * in small batches: the data proxy refuses a query value past 500 characters.
 */
import { useQuery } from '@tanstack/react-query'

import { z } from 'zod'

import { isLinkableObjectKind } from '#/lib/navigation'
import type { ObjectKind } from '#/lib/navigation'
import { notebookDataClient } from '#/lib/notebook-data'

export interface RecordLinkLabel {
  id: string
  kind: string
  identifier: string
  title: string
}

/** Ids per read: 12 UUIDs plus commas stay well under the proxy's limit. */
const IDS_PER_READ = 12

export type RecordLinkLabels = Readonly<
  Record<string, RecordLinkLabel | undefined>
>

/** The page kind a link opens: the record's own page, else the record page. */
export function recordLinkObjectKind(kind: string): ObjectKind {
  return isLinkableObjectKind(kind) ? kind : 'record'
}

export async function fetchRecordLinkLabels(
  ids: readonly string[],
): Promise<RecordLinkLabels> {
  const unique = [...new Set(ids)]
  const found: Record<string, RecordLinkLabel> = {}

  for (let at = 0; at < unique.length; at += IDS_PER_READ) {
    const chunk = unique.slice(at, at + IDS_PER_READ)

    const rows = await notebookDataClient.list<RecordLinkLabel>(
      'records',
      `?id=in.(${chunk.join(',')})&select=id,kind,identifier,title`,
    )

    for (const row of rows) found[row.id] = row
  }

  return found
}

const idSchema = z.string().min(1)

/** The ids a column's cells hold, in any order, without blanks or repeats. */
export function linkedRecordIds(values: readonly unknown[]): string[] {
  const ids = new Set<string>()

  for (const value of values) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const id = idSchema.safeParse(item)

      if (id.success) ids.add(id.data)
    }
  }

  return [...ids]
}

/** Labels for the records a screen's link cells hold. */
export function useRecordLinkLabels(ids: readonly string[]) {
  const key = [...ids].sort()

  return useQuery({
    queryKey: ['record-link-labels', key],
    queryFn: () => fetchRecordLinkLabels(key),
    enabled: key.length > 0,
    staleTime: 60_000,
  })
}
