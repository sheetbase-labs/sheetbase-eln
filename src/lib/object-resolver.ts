/**
 * Resolve a printed or typed identifier to the object it names, whatever kind
 * of object that is. Labels and QR codes carry any display identifier
 * (`SMP-2231`, `DS-0311`, `INS-0007`, `PRJ-0217`, `SHT-0019`, `PL-0003`), and
 * records can be known by an alias, so the lookup covers records, their
 * aliases and every other registry that has a display identifier.
 *
 * `kind` is an `ObjectKind` for `objectPath`, or the record's own kind for a
 * record (`sample`, `experiment`, `material`, ...), which `recordDestination`
 * maps to its page.
 */
import type { DataClient } from '#/lib/data-client'
import { objectPath, recordDestination, recordPath } from '#/lib/navigation'
import { resolveRecordByIdentifier } from '#/lib/record-resolver'

export interface ResolvedObject {
  /** `record` for anything in the records table, else the registry's kind. */
  source: 'record' | 'registry'
  id: string
  identifier: string
  /** The record kind, or the registry kind (`dataset`, `instrument`, ...). */
  kind: string
  title: string
  /** Set when the code matched an alias rather than the identifier. */
  matchedAlias?: string
}

interface Registry {
  kind: string
  table: string
  titleColumn: string
}

/** Registries addressed by `display_id`, besides the records table. */
const REGISTRIES: readonly Registry[] = [
  { kind: 'project', table: 'projects', titleColumn: 'title' },
  { kind: 'dataset', table: 'datasets', titleColumn: 'name' },
  { kind: 'instrument', table: 'instruments', titleColumn: 'name' },
  { kind: 'sheet', table: 'sheet_instances', titleColumn: 'name' },
  { kind: 'pipeline', table: 'pipeline_definitions', titleColumn: 'name' },
  { kind: 'analysis', table: 'analysis_views', titleColumn: 'name' },
]

interface RegistryRow {
  id: string
  display_id: string | null
  [column: string]: unknown
}

async function resolveRegistry(
  client: DataClient,
  identifier: string,
): Promise<ResolvedObject | null> {
  const exact = encodeURIComponent(identifier)
  const settled = await Promise.allSettled(
    REGISTRIES.map(async (registry) => {
      const rows = await client.list<RegistryRow>(
        registry.table,
        `?display_id=eq.${exact}&select=id,display_id,${registry.titleColumn}&limit=1`,
      )
      return { registry, row: rows.at(0) ?? null }
    }),
  )
  // A registry that cannot be read must not hide the one that can; a lookup
  // where every registry failed is an error, not a miss.
  if (settled.every((result) => result.status === 'rejected')) {
    throw settled[0].reason
  }
  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value.row) continue
    const { registry, row } = result.value
    const title = row[registry.titleColumn]
    return {
      source: 'registry',
      id: row.id,
      identifier: row.display_id ?? identifier,
      kind: registry.kind,
      title: typeof title === 'string' && title ? title : identifier,
    }
  }
  return null
}

async function resolveAlias(
  client: DataClient,
  identifier: string,
): Promise<ResolvedObject | null> {
  const aliases = await client.list<{ record_id: string; alias: string }>(
    'record_aliases',
    `?alias=ilike.${encodeURIComponent(identifier)}&select=record_id,alias&limit=1`,
  )
  const alias = aliases.at(0)
  if (!alias) return null
  const records = await client.list<{
    id: string
    identifier: string
    kind: string
    title: string
  }>(
    'records',
    `?id=eq.${encodeURIComponent(alias.record_id)}&deleted_at=is.null&select=id,identifier,kind,title&limit=1`,
  )
  const record = records.at(0)
  return record
    ? { source: 'record', ...record, matchedAlias: alias.alias }
    : null
}

/** The object a code names, or null when nothing in the workspace matches. */
export async function resolveObjectByIdentifier(
  client: DataClient,
  identifier: string,
): Promise<ResolvedObject | null> {
  const trimmed = identifier.trim()
  if (!trimmed) return null
  const record = await resolveRecordByIdentifier(client, trimmed)
  if (record) return { source: 'record', ...record }
  const registry = await resolveRegistry(client, trimmed)
  if (registry) return registry
  return resolveAlias(client, trimmed)
}

/** The page that owns a resolved object. */
export function resolvedObjectPath(object: ResolvedObject): string {
  return object.source === 'record'
    ? recordDestination(object.kind, object.id)
    : (objectPath(object.kind, object.id) ?? recordPath(object.id))
}
