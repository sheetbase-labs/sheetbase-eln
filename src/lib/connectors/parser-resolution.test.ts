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

describe('kinds of parser', () => {
  it('knows built-in, webhook and columns parsers apart', () => {
    expect(
      parserKindOf('sheetbase.delimited', { engine: 'sheetbase.delimited@1' }),
    ).toBe('builtin')
    expect(
      parserKindOf('sheetbase.plate-reader-csv', { requiredHeaders: ['a'] }),
    ).toBe('builtin')
    expect(parserKindOf('mine', { webhook: { url: 'https://x.test' } })).toBe(
      'webhook',
    )
    expect(parserKindOf('mine', { requiredHeaders: ['a'] })).toBe('columns')
  })

  it('lists each built-in once, at a positive version', () => {
    const keys = BUILTIN_PARSERS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(BUILTIN_PARSERS.every((p) => p.version >= 1)).toBe(true)
  })

  it('has a reader for every built-in that names an engine', () => {
    for (const entry of BUILTIN_PARSERS.filter((p) => p.signature['engine'])) {
      const reader = builtinReader(
        parser({
          key: entry.key,
          version: entry.version,
          signature: entry.signature,
          kind: 'builtin',
        }),
      )
      expect(reader, entry.key).not.toBeNull()
    }
  })

  it('never runs a reader that has moved past the approved version', () => {
    expect(
      builtinReader(
        parser({
          key: 'sheetbase.delimited',
          signature: { engine: 'sheetbase.delimited@0' },
          kind: 'builtin',
        }),
      ),
    ).toBeNull()
  })
})

describe('a parser that lists the columns a file must have', () => {
  it('reads a file that has them', () => {
    const parsed = readWithColumns(parser(), 'Sample,Value\nA1,3\n')
    expect(parsed.rows).toEqual([{ Sample: 'A1', Value: '3' }])
  })

  it('says why a file that lacks them isn’t read', () => {
    expect(() => readWithColumns(parser(), 'Well,OD\nA1,3\n')).toThrow(
      ParserResolutionError,
    )
    try {
      readWithColumns(parser(), 'Well,OD\nA1,3\n')
    } catch (error) {
      expect((error as ParserResolutionError).code).toBe('parser_unrecognised')
    }
  })

  it('follows the parser’s layout: details, a later header, units', () => {
    const layout = parser({
      signature: {
        requiredHeaders: ['sample', 'conc'],
        layout: {
          readDetails: true,
          headerStartsWith: 'sample',
          units: 'header',
        },
      },
    })
    const parsed = readWithColumns(
      layout,
      'Serial: SP9-1\nSample;Conc (mg/mL)\nS1;1\n',
    )
    expect(parsed.rows).toEqual([{ Sample: 'S1', Conc: '1' }])
    expect(parsed.metadata).toMatchObject({
      Serial: 'SP9-1',
      'Conc unit': 'mg/mL',
    })
  })

  it('says why a layout can’t read the file', () => {
    const layout = parser({
      signature: {
        requiredHeaders: ['sample'],
        layout: { headerStartsWith: 'Sample' },
      },
    })
    expect(() => readWithColumns(layout, 'a,b\n1,2\n')).toThrow(
      /header line starting with/,
    )
  })
})
