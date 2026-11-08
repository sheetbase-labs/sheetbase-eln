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
  deep_link: string
}

const DOCUMENT_LIMIT = 5000

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
    `?select=object_type,object_id,title,identifier,kind,status,body,deep_link` +
      `&archived=eq.false&object_type=in.(${types.join(',')})` +
      `&order=updated_at.desc.nullslast&limit=${DOCUMENT_LIMIT}`,
  )
  const byId = new Map(rows.map((row) => [row.object_id, row]))
  const documents: SearchDocument[] = rows.map((row) => ({
    id: row.object_id,
    type: row.object_type,
    title: row.title,
    text: `${row.identifier} ${row.title}\n${row.body}`.slice(0, 4000),
    fields: { identifier: row.identifier, kind: row.kind, status: row.status },
  }))

  const hits: PluginSearchHit[] = []
  const problems: string[] = []
  for (const provider of providers) {
    try {
      const found = await runExtensionSearch({
        workspaceId: args.workspaceId,
        actorUserId: args.actorUserId,
        extensionKey: provider.extensionKey,
        providerId: provider.id,
        query,
        documents,
      })
      for (const hit of found) {
        const row = byId.get(hit.id)
        if (!row) continue
        hits.push({
          type: row.object_type,
          id: row.object_id,
          identifier: row.identifier,
          title: row.title,
          kind: row.kind,
          status: row.status,
          deepLink: row.deep_link,
          snippet: hit.snippet ?? '',
          score: hit.score,
          pluginName: provider.extensionName,
          providerTitle: provider.declaration.title,
        })
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
