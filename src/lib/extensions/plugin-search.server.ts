/**
 * Search from plugins: the search page and the assistant ask every switched-on
 * search provider what it finds for the words typed.
 *
 * What a provider is handed comes from the search index through the signed-in
 * person's own access (row-level security), so it can only ever look through
 * what that person may already see, and it can only point back at records it
 * was handed. A provider that fails costs its own hits, never the search.
 */
import type { DataClient } from '#/lib/data-client'
import { listExtensions } from './client'
import { runExtensionSearch } from './data-runtime.server'
import type { SearchDocument } from './data-runtime.server'
import { resolveRunnerPoints } from './runner-points'

export interface PluginSearchHit {
  type: string
  id: string
  identifier: string
  title: string
  kind: string
  status: string
  deepLink: string
  /** What the plugin said about the hit; empty when it said nothing. */
  snippet: string
  score: number
  pluginName: string
  providerTitle: string
}

export interface PluginSearchView {
  hits: PluginSearchHit[]
  /** One plain-words line for each provider that could not answer. */
  problems: string[]
}

interface IndexRow {
  object_type: string
  object_id: string
  title: string
  identifier: string
  kind: string
  status: string
  body: string
  /** The record's own field values (text, numbers, yes/no). */
  fields: Record<string, unknown> | null
  deep_link: string
}

interface IndexHit {
  record_id: string
  entry_key: string
  score: number
  snippet: string | null
}

const DOCUMENT_LIMIT = 5000
const FIELD_VALUE_LIMIT = 8000

/** What a provider may read of a record's fields: text, numbers and yes/no. */
function fieldValues(
  fields: Record<string, unknown> | null,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [name, value] of Object.entries(fields ?? {})) {
    if (typeof value === 'string') out[name] = value.slice(0, FIELD_VALUE_LIMIT)
    else if (typeof value === 'number' || typeof value === 'boolean')
      out[name] = value
  }
  return out
}

function documentOf(row: IndexRow): SearchDocument {
  return {
    id: row.object_id,
    type: row.object_type,
    title: row.title,
    text: `${row.identifier} ${row.title}\n${row.body}`.slice(0, 4000),
    // The record's own field values come first so the fixed ones win a clash.
    fields: {
      ...fieldValues(row.fields),
      identifier: row.identifier,
      kind: row.kind,
      status: row.status,
    },
  }
}

/** What an indexed provider is handed when it does not ask for a number: more than most labs have of one kind. */
const INDEX_CANDIDATES = 5000

/** The index rows for these records, read with the person's own access. */
async function rowsFor(client: DataClient, ids: string[]): Promise<IndexRow[]> {
  const rows: IndexRow[] = []
  for (let at = 0; at < ids.length; at += 100)
    rows.push(
      ...(await client.list<IndexRow>(
        'search_documents',
        `?select=object_type,object_id,title,identifier,kind,status,body,fields,deep_link` +
          `&archived=eq.false&object_id=in.(${ids.slice(at, at + 100).join(',')})`,
      )),
    )
  return rows
}

function hitFor(
  row: IndexRow,
  provider: {
    extensionName: string
    declaration: { title: string }
  },
  snippet: string,
  score: number,
): PluginSearchHit {
  return {
    type: row.object_type,
    id: row.object_id,
    identifier: row.identifier,
    title: row.title,
    kind: row.kind,
    status: row.status,
    deepLink: row.deep_link,
    snippet,
    score,
    pluginName: provider.extensionName,
    providerTitle: provider.declaration.title,
  }
}

export async function searchWithPlugins(
  client: DataClient,
  args: { workspaceId: string; actorUserId: string; query: string },
): Promise<PluginSearchView> {
  const query = args.query.trim()
  if (!query) return { hits: [], problems: [] }
  const installs = await listExtensions(client).catch(() => [])
  const providers = resolveRunnerPoints(installs).data['search-providers']
  if (providers.length === 0) return { hits: [], problems: [] }

  const types = [
    ...new Set(providers.flatMap((item) => item.declaration.types)),
  ]
  const rows = await client.list<IndexRow>(
    'search_documents',
    `?select=object_type,object_id,title,identifier,kind,status,body,fields,deep_link` +
      `&archived=eq.false&object_type=in.(${types.join(',')})` +
      `&order=updated_at.desc.nullslast&limit=${DOCUMENT_LIMIT}`,
  )
  const byId = new Map(rows.map((row) => [row.object_id, row]))
  const documents: SearchDocument[] = rows.map(documentOf)

  const hits: PluginSearchHit[] = []
  const problems: string[] = []
  for (const provider of providers) {
    try {
      const indexed = provider.declaration.indexed === true
      let { hits: found, nearest } = await runExtensionSearch({
        workspaceId: args.workspaceId,
        actorUserId: args.actorUserId,
        extensionKey: provider.extensionKey,
        providerId: provider.id,
        query,
        // An indexed provider first says what to look up, so it is handed
        // nothing yet.
        documents: indexed ? [] : documents,
        ...(indexed ? { stage: 'plan' as const } : {}),
      })
      if (nearest?.verify) {
        // The index finds the candidates; the provider checks and scores them.
        const ranked = await client.rpc<IndexHit[]>('search_plugin_index', {
          p_extension_key: provider.extensionKey,
          p_index_name: nearest.index,
          p_query: nearest.text,
          p_vector: nearest.vector,
          p_limit: nearest.limit ?? INDEX_CANDIDATES,
        })
        const ids = [...new Set(ranked.map((entry) => entry.record_id))]
        const candidates = await rowsFor(client, ids)
        for (const row of candidates) byId.set(row.object_id, row)
        const checked = await runExtensionSearch({
          workspaceId: args.workspaceId,
          actorUserId: args.actorUserId,
          extensionKey: provider.extensionKey,
          providerId: provider.id,
          query,
          documents: candidates.map(documentOf),
          stage: 'rank',
        })
        found = checked.hits
        nearest = null
      }
      for (const hit of found) {
        const row = byId.get(hit.id)
        if (!row) continue
        hits.push(hitFor(row, provider, hit.snippet ?? '', hit.score))
      }
      if (nearest) {
        const ranked = await client.rpc<IndexHit[]>('search_plugin_index', {
          p_extension_key: provider.extensionKey,
          p_index_name: nearest.index,
          p_query: nearest.text,
          p_vector: nearest.vector,
          p_limit: 50,
        })
        const missing = [
          ...new Set(
            ranked
              .map((entry) => entry.record_id)
              .filter((id) => !byId.has(id)),
          ),
        ]
        if (missing.length > 0) {
          const more = await client.list<IndexRow>(
            'search_documents',
            `?select=object_type,object_id,title,identifier,kind,status,body,deep_link` +
              `&archived=eq.false&object_id=in.(${missing.join(',')})`,
          )
          for (const row of more) byId.set(row.object_id, row)
        }
        const seen = new Set<string>()
        for (const entry of ranked) {
          const row = byId.get(entry.record_id)
          // One hit per record: the closest entry wins.
          if (!row || seen.has(row.object_id)) continue
          seen.add(row.object_id)
          hits.push(hitFor(row, provider, entry.snippet ?? '', entry.score))
        }
      }
    } catch (error) {
      problems.push(
        `${provider.declaration.title}: ${error instanceof Error ? error.message : 'could not search.'}`,
      )
    }
  }
  hits.sort((a, b) => b.score - a.score)
  return { hits: hits.slice(0, 100), problems }
}
