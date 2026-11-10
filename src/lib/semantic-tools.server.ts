/**
 * Search by meaning and literature search as tools, for the in-app assistant
 * ("Ask the lab") and for MCP agents. Both read only. Meaning search runs
 * under the caller's own access; literature search sends a short phrase to an
 * open index and only when a workspace owner has turned it on.
 */
import { z } from 'zod'

import type { ProviderToolDef } from './ai-providers/types'
import type { DataClient } from './data-client'
import {
  LITERATURE_SOURCES,
  LiteratureError,
  describePaper,
  searchLiterature,
} from './literature'
import type { FetchLike, LiteratureOptions } from './literature'
import { logger, redact } from './logger'
import {
  SemanticUnavailableError,
  readSemanticRow,
  semanticHits,
} from './semantic-search.server'

export const SEMANTIC_SEARCH_TOOL = 'sheetbase.search.semantic'
export const LITERATURE_SEARCH_TOOL = 'sheetbase.literature.search'

export const SEMANTIC_READ_TOOL_NAMES = [
  SEMANTIC_SEARCH_TOOL,
  LITERATURE_SEARCH_TOOL,
] as const

export const semanticSearchSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'What to look for, in plain words: a question or a description of the work, not keywords.',
    ),
  limit: z.number().int().min(1).max(20).nullish(),
})

export const literatureSearchSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .max(300)
    .describe(
      'A short search phrase for the published literature. Only these words are sent outside the workspace, so never include sample names, unpublished results or anything private.',
    ),
  source: z.enum(LITERATURE_SOURCES).nullish(),
  limit: z.number().int().min(1).max(15).nullish(),
})

export const SEMANTIC_SEARCH_DESCRIPTION =
  'Find work in the lab by meaning rather than by exact words: experiments, notebook text, files, datasets, templates and comments that read like the question, even when they use different terms. Use it for "have we done this before", "who has worked on X" and "what do we know about Y". Each result has an identifier, a title, a link and the passage that matched. Answer only from the results and give each as a link.'

export const LITERATURE_SEARCH_DESCRIPTION =
  'Search published papers (Europe PMC, PubMed or OpenAlex). Available only when the workspace has turned literature search on. Each paper has authors, journal, year, DOI, a link and often an abstract. Cite papers only from these results, never from memory. To keep one, propose adding it to the Reference registry.'

function toolDef(
  name: string,
  description: string,
  schema: z.ZodType,
): ProviderToolDef {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(schema, {
    io: 'input',
  })

  return { name: name.replaceAll('.', '__'), description, parameters }
}

export function semanticToolDefs(literature: boolean): ProviderToolDef[] {
  return [
    toolDef(
      SEMANTIC_SEARCH_TOOL,
      SEMANTIC_SEARCH_DESCRIPTION,
      semanticSearchSchema,
    ),
    ...(literature
      ? [
          toolDef(
            LITERATURE_SEARCH_TOOL,
            LITERATURE_SEARCH_DESCRIPTION,
            literatureSearchSchema,
          ),
        ]
      : []),
  ]
}

const SEMANTIC_READ_TOOLS: ReadonlySet<string> = new Set(
  SEMANTIC_READ_TOOL_NAMES,
)

export function isSemanticReadTool(name: string): boolean {
  return SEMANTIC_READ_TOOLS.has(name)
}

interface Result {
  text: string
  isError: boolean
}

function invalid(error: z.ZodError): string {
  const [first] = error.issues

  return `That request was not valid: ${first.path.join('.') || 'arguments'}: ${first.message}.`
}

/** What search providers from plugins find, in the shape the tool answers with. */
async function pluginResults(
  query: string,
  context: { client: DataClient; workspaceId: string; actorUserId?: string },
) {
  if (!context.actorUserId) return []

  try {
    const { searchWithPlugins } =
      await import('./extensions/plugin-search.server')

    const found = await searchWithPlugins(context.client, {
      workspaceId: context.workspaceId,
      actorUserId: context.actorUserId,
      query,
    })

    return found.hits.slice(0, 8).map((hit) => ({
      identifier: hit.identifier,
      title: hit.title,
      type: hit.type,
      status: hit.status,
      foundBy: hit.providerTitle,
      passage: hit.snippet.slice(0, 400),
      open: hit.deepLink,
    }))
  } catch {
    return []
  }
}

export async function runSemanticSearch(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool arguments arrive from the model as raw JSON and are parsed by semanticSearchSchema before any field is read.
  args: unknown,
  context: { client: DataClient; workspaceId: string; actorUserId?: string },
): Promise<Result> {
  const parsed = semanticSearchSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const plugins = await pluginResults(parsed.data.query, context)

  try {
    const hits = await semanticHits(
      context.client,
      context.workspaceId,
      parsed.data.query,
      { limit: parsed.data.limit ?? 8 },
    )

    if (hits.length === 0 && plugins.length === 0) {
      return {
        text: 'Nothing in the lab reads close to that. Say so; do not guess. You can offer to search by words instead.',
        isError: false,
      }
    }

    const note =
      'Results are ordered closest first. Give each as a link to its page. `fromPlugins` are extra results from search tools the lab added.'

    const results = hits.map((hit) => ({
      identifier: hit.identifier,
      title: hit.title,
      type: hit.type,
      status: hit.status,
      closeness: Math.round(hit.similarity * 100) / 100,
      passage: hit.passage.slice(0, 400),
      open: hit.deepLink,
    }))

    return {
      text: JSON.stringify(
        plugins.length > 0
          ? { note, fromPlugins: plugins, results }
          : { note, results },
      ),
      isError: false,
    }
  } catch (error) {
    if (error instanceof SemanticUnavailableError) {
      // The lab's own search tools still answer when search by meaning is off.
      if (plugins.length > 0)
        return {
          text: JSON.stringify({
            note: `${error.message} These are results from search tools the lab added. Give each as a link to its page.`,
            fromPlugins: plugins,
          }),
          isError: false,
        }

      return { text: error.message, isError: true }
    }

    logger.warn(
      'ai.semantic_tool_failed',
      redact({ workspaceId: context.workspaceId }),
    )

    return { text: 'The search by meaning failed. Try again.', isError: true }
  }
}

export async function literatureAllowed(
  client: DataClient,
  workspaceId: string,
): Promise<boolean> {
  const row = await readSemanticRow(client, workspaceId).catch(() => null)

  return Boolean(row?.ai_enabled && row.literature_search_enabled)
}

export async function runLiteratureSearch(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool arguments arrive from the model as raw JSON and are parsed by literatureSearchSchema before any field is read.
  args: unknown,
  context: {
    client: DataClient
    workspaceId: string
    fetch?: FetchLike
  },
): Promise<Result> {
  const parsed = literatureSearchSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  if (!(await literatureAllowed(context.client, context.workspaceId))) {
    return {
      text: 'Literature search is not turned on. A workspace owner can turn it on in Settings, AI.',
      isError: true,
    }
  }

  try {
    const options: LiteratureOptions = {
      source: parsed.data.source ?? 'europepmc',
      limit: parsed.data.limit ?? 6,
      openAlexKey: process.env.OPENALEX_API_KEY,
      contact: process.env.OPENALEX_MAILTO,
    }

    if (context.fetch) options.fetch = context.fetch
    const papers = await searchLiterature(parsed.data.query, options)

    if (papers.length === 0) {
      return {
        text: 'No papers matched. Say so, and offer a different phrase or source.',
        isError: false,
      }
    }

    return {
      text: JSON.stringify({
        note: 'Cite only these papers. Give the title as a link to its page.',
        papers: papers.map(describePaper),
      }),
      isError: false,
    }
  } catch (error) {
    return {
      text:
        error instanceof LiteratureError
          ? error.message
          : 'The literature search failed. Try again.',
      isError: true,
    }
  }
}
