import { describe, expect, it } from 'vitest'

import type { DataClient } from './data-client'
import type { FetchLike } from './literature'
import {
  isSemanticReadTool,
  runLiteratureSearch,
  runSemanticSearch,
  semanticToolDefs,
} from './semantic-tools.server'

const baseSettings = {
  ai_enabled: true,
  ai_cloud_egress_enabled: false,
  semantic_search_enabled: false,
  embeddings_profile: null,
  literature_search_enabled: false,
}

/** The workspace settings row these tools read, with the flags a case overrides. */
const settings = (extra: Partial<typeof baseSettings>) => ({
  ...baseSettings,
  ...extra,
})

type SettingsRow = ReturnType<typeof settings>

function clientWith(row: SettingsRow | null): DataClient {
  const rows: SettingsRow[] = row ? [row] : []

  const methods: Partial<DataClient> = {
    // SAFETY: the tools list only the settings row this double holds, so the
    // list contract's `T` is that row.
    list: async <T>(): Promise<T[]> => rows as T[],
    // SAFETY: these tools read no RPC result; the double answers an empty list
    // exactly as the suite's original stub did.
    rpc: async <T>(): Promise<T> => [] as T,
  }

  // SAFETY: the semantic search tools call only `list` and `rpc`, which this
  // double supplies; no other DataClient member is reached.
  return methods as DataClient
}

describe('search tools for the assistant and MCP', () => {
  it('offers the literature tool only when it is allowed', () => {
    expect(semanticToolDefs(false).map((d) => d.name)).toEqual([
      'sheetbase__search__semantic',
    ])
    expect(semanticToolDefs(true)).toHaveLength(2)
    expect(isSemanticReadTool('sheetbase.literature.search')).toBe(true)
    expect(isSemanticReadTool('sheetbase.search')).toBe(false)
  })

  it('tells the person how to turn meaning search on', async () => {
    const result = await runSemanticSearch(
      { query: 'base editing' },
      { client: clientWith(settings({})), workspaceId: 'w' },
    )

    expect(result.isError).toBe(true)
    expect(result.text).toContain('Settings, AI')
  })

  it('refuses literature search until an owner turns it on', async () => {
    let called = false

    const fetch: FetchLike = async () => {
      called = true

      return { ok: true, status: 200, json: async () => ({}) }
    }

    const off = await runLiteratureSearch(
      { query: 'crispr' },
      { client: clientWith(settings({})), workspaceId: 'w', fetch },
    )

    expect(off.isError).toBe(true)
    expect(called).toBe(false)

    const on = await runLiteratureSearch(
      { query: 'crispr' },
      {
        client: clientWith(settings({ literature_search_enabled: true })),
        workspaceId: 'w',
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            resultList: {
              result: [{ title: 'A paper', doi: '10.1/x', pubYear: '2020' }],
            },
          }),
        }),
      },
    )

    expect(on.isError).toBe(false)
    expect(on.text).toContain('https://doi.org/10.1/x')
  })

  it('refuses literature search when AI is off', async () => {
    const result = await runLiteratureSearch(
      { query: 'crispr' },
      {
        client: clientWith(
          settings({ ai_enabled: false, literature_search_enabled: true }),
        ),
        workspaceId: 'w',
      },
    )

    expect(result.isError).toBe(true)
  })
})
