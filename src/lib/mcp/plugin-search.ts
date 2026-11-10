/**
 * `sheetbase.plugin.search`: asks every switched-on search provider from a
 * plugin what it finds for the words, as the person. It is the way a plugin
 * operation (or an agent) reaches another plugin's search, such as `sub:` and
 * `sim:` structure search from the chemistry plugin, without the by-meaning
 * search mixed in.
 */
import { z } from 'zod'

import type { DataClient } from '../data-client'

export const PLUGIN_SEARCH_TOOL = 'sheetbase.plugin.search'

export const pluginSearchSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      'What to search for, in the form the plugin documents, such as `sub:c1ccccc1` or `sim:CCO`.',
    ),
  limit: z.number().int().min(1).max(100).nullish(),
})

export function pluginSearchMcpTool() {
  return {
    name: PLUGIN_SEARCH_TOOL,
    description:
      'Search with the search tools plugins have added, such as structure search. Each hit has an identifier, a title, the kind of record, a score from 0 to 1 and a link.',
    inputSchema: z.toJSONSchema(pluginSearchSchema, { io: 'input' }),
    annotations: {
      title: 'Search with plugin search tools',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }
}

export async function runPluginSearch(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- MCP transport input is decoded by pluginSearchSchema before any provider call.
  args: unknown,
  context: { client: DataClient; workspaceId: string; actorUserId?: string },
): Promise<{ text: string; isError: boolean }> {
  const parsed = pluginSearchSchema.safeParse(args)

  if (!parsed.success)
    return { text: 'Send a query, such as "sub:c1ccccc1".', isError: true }

  if (!context.actorUserId)
    return { text: 'Plugin search needs a signed-in person.', isError: true }

  const { searchWithPlugins } =
    await import('../extensions/plugin-search.server')

  const found = await searchWithPlugins(context.client, {
    workspaceId: context.workspaceId,
    actorUserId: context.actorUserId,
    query: parsed.data.query,
  })

  const hits = found.hits.slice(0, parsed.data.limit ?? 50).map((hit) => ({
    id: hit.id,
    identifier: hit.identifier,
    title: hit.title,
    kind: hit.kind,
    status: hit.status,
    score: hit.score,
    snippet: hit.snippet,
    foundBy: hit.providerTitle,
    open: hit.deepLink,
  }))

  return {
    text: JSON.stringify({ hits, problems: found.problems }),
    isError: false,
  }
}
