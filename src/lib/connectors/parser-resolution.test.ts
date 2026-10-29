import { describe, expect, it } from 'vitest'

import type { DataClient } from '../data-client'
import { BUILTIN_PARSERS, parserKindOf } from './builtin-parsers'
import {
  ParserResolutionError,
  builtinReader,
  readWithColumns,
  resolveParserVersion,
} from './parser-resolution'
import type { ResolvedParser } from './parser-resolution'

function clientWith(rows: unknown[]): DataClient {
  return {
    list: async <T>() => rows as T[],
    rpc: async () => ({}) as never,
    count: async () => 0,
    insert: async () => ({}) as never,
    patch: async () => [],
    remove: async () => [],
  }
}

function parser(over: Partial<ResolvedParser> = {}): ResolvedParser {
  return {
    parserId: 'p',
    parserVersionId: 'v',
    key: 'my-columns',
    name: 'My columns',
    format: 'csv',
    version: 1,
    status: 'approved',
    signature: { requiredHeaders: ['sample', 'value'] },
    kind: 'columns',
    ...over,
  }
}

describe('resolving a parser version', () => {
  it('takes the newest approved version, not a newer draft', async () => {
    const resolved = await resolveParserVersion(
      clientWith([
        {
          id: 'p1',
          key: 'k',
          name: 'K',
          format: 'csv',
          parser_versions: [
            { id: 'v3', version: 3, status: 'draft', signature: {} },
            {
              id: 'v2',
              version: 2,
              status: 'approved',
              signature: { engine: 'sheetbase.delimited@1' },
            },
            { id: 'v1', version: 1, status: 'approved', signature: {} },
          ],
        },
      ]),
      'ws',
      'k',
    )
    expect(resolved).toMatchObject({
      parserVersionId: 'v2',
      version: 2,
      kind: 'builtin',
    })
  })

  it('falls back to the newest unretired version when none is approved', async () => {
    const resolved = await resolveParserVersion(
      clientWith([
        {
          id: 'p1',
          key: 'k',
          name: 'K',
          format: 'csv',
          parser_versions: [
            { id: 'v1', version: 1, status: 'validated', signature: {} },
            { id: 'v2', version: 2, status: 'retired', signature: {} },
          ],
        },
      ]),
      'ws',
      'k',
    )
    expect(resolved).toMatchObject({ parserVersionId: 'v1', version: 1 })
  })

  it('tells a parser with nothing usable from a missing one', async () => {
    await expect(
      resolveParserVersion(
        clientWith([
          {
            id: 'p1',
            key: 'k',
            name: 'K',
            format: 'csv',
            parser_versions: [
              { id: 'v1', version: 1, status: 'retired', signature: {} },
            ],
          },
        ]),
        'ws',
        'k',
      ),
    ).rejects.toMatchObject({ code: 'parser_not_approved' })
    await expect(
      resolveParserVersion(clientWith([]), 'ws', 'k'),
    ).rejects.toMatchObject({
      code: 'parser_unknown',
    })
  })
})
