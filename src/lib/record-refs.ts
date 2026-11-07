/**
 * Record identifiers written in free text (a notebook paragraph, a comment, a
 * line of related work): "EXP-0142", "DS-0311". Only an identifier that names a
 * record this person can see becomes a link; anything else stays plain text, so
 * a typo or another lab's number never turns into a dead link.
 */
import { useEffect, useState } from 'react'

import { notebookDataClient } from '#/lib/notebook-data'

/** Matches the identifier families that have a page of their own. */
export const RECORD_REF = /\b(?:EXP|SMP|MAT|PRT|DS|INS|PRJ|PL|AN)-\d{3,6}\b/g

interface RefSource {
  table: string
  column: string
  /** Fixed object kind, or null when the row's own `kind` column says. */
  kind: string | null
}

const RECORDS: RefSource = {
  table: 'records',
  column: 'identifier',
  kind: null,
}

const SOURCES: Partial<Record<string, RefSource>> = {
  EXP: RECORDS,
  SMP: RECORDS,
  MAT: RECORDS,
  PRT: RECORDS,
  DS: { table: 'datasets', column: 'display_id', kind: 'dataset' },
  INS: { table: 'instruments', column: 'display_id', kind: 'instrument' },
  PRJ: { table: 'projects', column: 'display_id', kind: 'project' },
  PL: { table: 'pipeline_definitions', column: 'display_id', kind: 'pipeline' },
  AN: { table: 'analysis_views', column: 'display_id', kind: 'analysis' },
}

/** One piece of a sentence: plain text, or an identifier that might be a link. */
export type RefPart = { text: string; ref: boolean }

/** Splits text around the identifiers it contains. */
export function splitRefs(text: string): RefPart[] {
  const parts: RefPart[] = []
  let last = 0
  for (const match of text.matchAll(RECORD_REF)) {
    const at = match.index
    if (at > last) parts.push({ text: text.slice(last, at), ref: false })
    parts.push({ text: match[0], ref: true })
    last = at + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), ref: false })
  return parts
}

/** The object kind of a known identifier, or null when no record has it. */
async function lookUp(ref: string): Promise<string | null> {
  const source = SOURCES[ref.slice(0, ref.indexOf('-'))]
  if (!source) return null
  const select = source.kind ? source.column : `${source.column},kind`
  const rows = await notebookDataClient.list<{ kind?: string }>(
    source.table,
    `?select=${select}&${source.column}=eq.${encodeURIComponent(ref)}&limit=1`,
  )
  const row = rows.at(0)
  if (!row) return null
  return source.kind ?? row.kind ?? 'record'
}

/** What each identifier resolved to (null: no such record), kept for the page's life. */
const resolved = new Map<string, string | null>()
const pending = new Map<string, Promise<void>>()

function resolve(ref: string): Promise<void> {
  const existing = pending.get(ref)
  if (existing) return existing
  const task = lookUp(ref)
    .then((kind) => {
      resolved.set(ref, kind)
    })
    .catch(() => {
      // A failed look-up stays plain text and is tried again next time.
    })
    .finally(() => {
      pending.delete(ref)
    })
  pending.set(ref, task)
  return task
}

/** The kind of record an identifier names, once known; null while unknown. */
export function useRecordRef(ref: string): string | null {
  return useRecordRefs([ref]).get(ref) ?? null
}

/** The kinds of several identifiers at once, keyed by identifier. */
export function useRecordRefs(refs: readonly string[]): Map<string, string> {
  const unique = [...new Set(refs)]
  const key = unique.join(' ')
  const [, setVersion] = useState(0)
  useEffect(() => {
    let live = true
    const missing = key
      .split(' ')
      .filter((ref) => ref !== '' && !resolved.has(ref))
    if (missing.length === 0) return
    void Promise.all(missing.map(resolve)).then(() => {
      if (live) setVersion((version) => version + 1)
    })
    return () => {
      live = false
    }
  }, [key])
  const known = new Map<string, string>()
  for (const ref of unique) {
    const kind = resolved.get(ref)
    if (kind) known.set(ref, kind)
  }
  return known
}
