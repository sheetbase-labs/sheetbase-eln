/**
 * SCI-008 unit tests for the scientific search application library.
 *
 * Covers the pure helpers that sit on top of the `api.search` RPC:
 * - canonical Tiptap JSON text extraction (paragraphs, H2/H3, prose lists);
 * - block text extraction for non-rich-text block types;
 * - search filter validation and RPC argument building;
 * - wire → domain result mapping and result-type discrimination;
 * - matched-context parsing and field labels;
 * - deep-link generation;
 * - archived-result handling.
 *
 * PostgreSQL and RLS remain authoritative; these helpers improve the UI and
 * drive validation.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildSearchRpcArgs,
  executeSearch,
  extractAllStrings,
  extractBlockText,
  matchedFieldLabel,
  MATCHED_FIELD_LABELS,
  parseMatchedContext,
  searchQueryKeys,
  searchResultDeepLink,
  SEARCHABLE_KINDS,
  toSearchResult,
  matchTierForField,
  rankByTier,
  deriveSuggestions,
  loadSavedQueries,
  saveQuery,
  deleteSavedQuery,
  savedQueriesKey,
  saveCurrentSearch,
  savedQueryToSearch,
  parseSearchUrl,
  serializeSearchUrl,
  SEARCH_URL_DEFAULTS,
  searchResultGroup,
  groupSearchResults,
  filterBySearchScope,
  searchResultNewTabUrl,
  contextualSearchActions,
  searchActionHref,
  parseSearchDay,
  urlFiltersToSearchFilters,
  filterSearchResults,
  SEARCH_PAGE_SIZE,
} from './search'
import type { SearchResultWire, SearchFilters, SearchResult } from './search'
import type { DataClient } from './data-client'

// ---------------------------------------------------------------------------
// Canonical Tiptap JSON fixtures (ADR 0025).
// ---------------------------------------------------------------------------

const tiptapParagraph = {
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Evaluated lentiviral vector stability.' },
        ],
      },
    ],
  },
}

const tiptapHeadingsAndList = {
  doc: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Method' }],
      },
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Reagents' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Thawed on ice.' }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'TaqMan kit' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'PCR buffer' }],
              },
            ],
          },
        ],
      },
    ],
  },
}

// H1 is the record title outside prose (ADR 0025); it is NOT present in
// block content. The canonical validator isRichTextPayload rejects level-1
// headings (only 2/3 are allowed). The text extractor itself does not
// re-validate — it trusts the canonical model — so the contract relies on
// H1 never being stored in a block payload.
const tiptapWithH1 = {
  doc: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Record Title' }],
      },
    ],
  },
}

describe('extractBlockText — rich_text canonical Tiptap', () => {
  it('extracts paragraph text', () => {
    expect(extractBlockText('rich_text', tiptapParagraph)).toBe(
      'Evaluated lentiviral vector stability.',
    )
  })

  it('extracts H2, H3, paragraphs and prose list items', () => {
    const text = extractBlockText('rich_text', tiptapHeadingsAndList)
    expect(text).toContain('Method')
    expect(text).toContain('Reagents')
    expect(text).toContain('Thawed on ice.')
    expect(text).toContain('TaqMan kit')
    expect(text).toContain('PCR buffer')
  })

  it('does not re-validate H1 — the canonical model guarantees H1 is never in blocks', () => {
    // The extractor trusts the canonical Tiptap model (ADR 0025): H1 is the
    // record title outside prose and is never stored in a block payload.
    // isRichTextPayload is the guard that rejects level-1 headings at the
    // boundary. extractBlockText does not duplicate that check; if an H1
    // were somehow present, its text would be extracted. This test documents
    // that the contract relies on the canonical model, not on the extractor
    // filtering H1.
    const text = extractBlockText('rich_text', tiptapWithH1)
    expect(text).toBe('Record Title')
  })

  it('returns empty string for malformed rich_text payload', () => {
    expect(extractBlockText('rich_text', { foo: 'bar' })).toBe('')
    expect(
      extractBlockText('rich_text', null as unknown as Record<string, unknown>),
    ).toBe('')
  })
})

describe('extractBlockText — other block types', () => {
  it('extracts checklist item text', () => {
    const text = extractBlockText('checklist', {
      items: [
        { text: 'Thaw reagents', checked: true },
        { text: 'Run qPCR', checked: false },
      ],
    })
    expect(text).toContain('Thaw reagents')
    expect(text).toContain('Run qPCR')
  })

  it('extracts callout text', () => {
    expect(extractBlockText('callout', { text: 'Important safety note' })).toBe(
      'Important safety note',
    )
  })

  it('extracts procedure step text and notes', () => {
    const text = extractBlockText('procedure_step', {
      text: 'Centrifuge at 4000 g',
      note: 'for 10 min',
    })
    expect(text).toContain('Centrifuge at 4000 g')
    expect(text).toContain('for 10 min')
  })

  it('extracts materials item identifiers, titles and notes', () => {
    const text = extractBlockText('materials', {
      items: [
        {
          identifier: 'RGT-2025-0001',
          title: 'TaqMan kit',
          note: 'store at -20 °C',
        },
      ],
    })
    expect(text).toContain('RGT-2025-0001')
    expect(text).toContain('TaqMan kit')
    expect(text).toContain('store at -20 °C')
  })

  it('extracts metric labels', () => {
    expect(extractBlockText('metric', { label: 'Ct value' })).toBe('Ct value')
  })

  it('extracts linked record target identifier and label', () => {
    const text = extractBlockText('linked_record', {
      targetIdentifier: 'SMP-2025-0001',
      label: 'Patient sample',
    })
    expect(text).toContain('SMP-2025-0001')
    expect(text).toContain('Patient sample')
  })

  it('extracts protocol reference identifiers and titles', () => {
    const text = extractBlockText('protocol_reference', {
      protocolIdentifier: 'PRT-2025-0001',
      protocolTitle: 'qPCR protocol',
    })
    expect(text).toContain('PRT-2025-0001')
    expect(text).toContain('qPCR protocol')
  })

  it('extracts file display names', () => {
    const text = extractBlockText('file', {
      displayName: 'raw_data.csv',
      fileIdentifier: 'FILE-2025-0001',
    })
    expect(text).toContain('raw_data.csv')
    expect(text).toContain('FILE-2025-0001')
  })

  it('extracts table cell text', () => {
    const text = extractBlockText('table', {
      rows: [
        ['Sample', 'Ct'],
        ['S1', '28.4'],
      ],
    })
    expect(text).toContain('Sample')
    expect(text).toContain('28.4')
  })

  it('falls back to extractAllStrings for unknown block types', () => {
    const text = extractBlockText('chart', {
      title: 'Growth curve',
      xAxis: 'Time',
    })
    expect(text).toContain('Growth curve')
    expect(text).toContain('Time')
  })
})

describe('extractAllStrings', () => {
  it('recursively extracts all string leaves from nested JSON', () => {
    expect(
      extractAllStrings({
        a: 'hello',
        b: { c: 'world', d: 42 },
        e: ['foo', { f: 'bar' }],
      }),
    ).toBe('hello world foo bar')
  })

  it('ignores numbers, booleans and nulls', () => {
    expect(extractAllStrings({ n: 1, b: true, z: null })).toBe('')
  })

  it('returns empty string for null/undefined', () => {
    expect(extractAllStrings(null)).toBe('')
    expect(extractAllStrings(undefined)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// RPC argument builder.
// ---------------------------------------------------------------------------

describe('buildSearchRpcArgs', () => {
  it('builds args with defaults for limit and offset', () => {
    const args = buildSearchRpcArgs({ query: 'virus stability' })
    expect(args.p_query).toBe('virus stability')
    expect(args.p_limit).toBe(20)
    expect(args.p_offset).toBe(0)
    expect(args).not.toHaveProperty('p_project_id')
  })

  it('includes provided filters', () => {
    const args = buildSearchRpcArgs({
      query: '  TaqMan  ',
      projectId: 'proj-1',
      kind: 'experiment',
      status: 'in-progress',
      ownerId: 'user-1',
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      limit: 50,
      offset: 10,
    })
    expect(args.p_query).toBe('TaqMan')
    expect(args.p_project_id).toBe('proj-1')
    expect(args.p_kind).toBe('experiment')
    expect(args.p_status).toBe('in-progress')
    expect(args.p_owner_id).toBe('user-1')
    expect(args.p_date_from).toBe('2025-01-01')
    expect(args.p_date_to).toBe('2025-12-31')
    expect(args.p_limit).toBe(50)
    expect(args.p_offset).toBe(10)
  })

  it('omits empty-string filters', () => {
    const args = buildSearchRpcArgs({
      query: 'test',
      kind: '',
      status: '',
    })
    expect(args).not.toHaveProperty('p_kind')
    expect(args).not.toHaveProperty('p_status')
  })
})

// ---------------------------------------------------------------------------
// Wire → domain mapping and result-type discrimination.
// ---------------------------------------------------------------------------

function wireRow(overrides: Partial<SearchResultWire> = {}): SearchResultWire {
  return {
    result_type: 'record',
    record_id: '00000000-0000-4000-8000-000000000101',
    kind: 'experiment',
    identifier: 'EXP-2025-0001',
    title: 'Virus Stability at 4 °C',
    status: 'in-progress',
    project_id: '00000000-0000-4000-8000-000000000100',
    archived: false,
    created_by_user_id: 'user-1',
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-20T14:30:00Z',
    matched_context: 'Virus <b>Stability</b> at 4 °C',
    matched_field: 'title',
    rank: '0.06079271',
    deep_link:
      '/projects/00000000-0000-4000-8000-000000000100/experiments/00000000-0000-4000-8000-000000000101',
    total_count: '42',
    ...overrides,
  }
}

describe('toSearchResult', () => {
  it('keeps the project, pipeline and analysis classes the RPC now returns', () => {
    for (const resultType of ['project', 'pipeline', 'analysis'] as const) {
      const result = toSearchResult(
        wireRow({ result_type: resultType, record_id: 'x-1' }),
      )
      expect(result.resultType).toBe(resultType)
    }
    expect(
      toSearchResult(wireRow({ result_type: 'project', record_id: 'p-1' }))
        .deepLink,
    ).toBe('/projects/p-1')
  })

  it('maps a record result', () => {
    const result = toSearchResult(wireRow())
    expect(result.resultType).toBe('record')
    expect(result.kind).toBe('experiment')
    expect(result.identifier).toBe('EXP-2025-0001')
    expect(result.archived).toBe(false)
    expect(result.rank).toBeCloseTo(0.06079271)
    expect(result.deepLink).toBe(
      '/records/00000000-0000-4000-8000-000000000101',
    )
    expect(result.totalCount).toBe(42)
  })

  it('discriminates file result type', () => {
    const result = toSearchResult(
      wireRow({ result_type: 'file', kind: 'file' }),
    )
    expect(result.resultType).toBe('file')
    expect(result.kind).toBe('file')
  })

  it('maps archived flag honestly', () => {
    const result = toSearchResult(wireRow({ archived: true }))
    expect(result.archived).toBe(true)
  })

  it('handles unknown matched_field gracefully', () => {
    const result = toSearchResult(wireRow({ matched_field: 'unknown_source' }))
    expect(result.matchedField).toBe('unknown_source')
  })

  it('maps a persisted comment hit to its own identity and visible owner destination', () => {
    const comment = '56000000-0000-4000-8000-000000000041'
    const owner = '56000000-0000-4000-8000-000000000042'
    const deepLink = `/sheets/${owner}?commentId=${comment}`
    const result = toSearchResult(
      wireRow({
        result_type: 'comment',
        record_id: comment,
        kind: 'comment',
        matched_field: 'comment_body',
        deep_link: deepLink,
      }),
    )
    expect(result).toMatchObject({
      resultType: 'comment',
      recordId: comment,
      deepLink,
    })
    expect(searchResultGroup(result)).toBe('Notebook text and comments')
    expect(matchedFieldLabel(result.matchedField)).toBe('Matched in comment')
    expect(contextualSearchActions([result])).toEqual([])
    expect(contextualSearchActions([{ ...result, kind: 'sample' }])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Deep-link generation.
// ---------------------------------------------------------------------------

describe('searchResultDeepLink', () => {
  it('opens a record result at the record itself', () => {
    expect(searchResultDeepLink('record', 'rec-1')).toBe('/records/rec-1')
    expect(searchResultDeepLink('record', 'rec-2')).toBe('/records/rec-2')
  })

  it('links datasets, sheets and templates to their surfaces', () => {
    expect(searchResultDeepLink('dataset', 'ds-1')).toBe(
      '/datasets?dataset=ds-1',
    )
    expect(searchResultDeepLink('sheet', 'sh-1')).toBe('/sheets/sh-1')
    expect(searchResultDeepLink('template', 't-1')).toBe(
      '/templates?template=t-1',
    )
  })
})

// ---------------------------------------------------------------------------
// Matched context parsing.
// ---------------------------------------------------------------------------

describe('parseMatchedContext', () => {
  it('returns empty array for empty context', () => {
    expect(parseMatchedContext('')).toEqual([])
  })

  it('parses highlighted segments from ts_headline output', () => {
    const segments = parseMatchedContext('Virus <b>Stability</b> at 4 °C')
    expect(segments).toEqual([
      { text: 'Virus ', highlighted: false },
      { text: 'Stability', highlighted: true },
      { text: ' at 4 °C', highlighted: false },
    ])
  })

  it('handles multiple highlights', () => {
    const segments = parseMatchedContext('<b>virus</b> and <b>stability</b>')
    expect(segments).toEqual([
      { text: 'virus', highlighted: true },
      { text: ' and ', highlighted: false },
      { text: 'stability', highlighted: true },
    ])
  })

  it('returns a single non-highlighted segment when no tags present', () => {
    expect(parseMatchedContext('No matches here')).toEqual([
      { text: 'No matches here', highlighted: false },
    ])
  })
})

describe('matchedFieldLabel', () => {
  it('returns human-readable labels for known fields', () => {
    expect(matchedFieldLabel('title')).toBe('Matched in title')
    expect(matchedFieldLabel('block_text')).toBe('Matched in notebook text')
    expect(matchedFieldLabel('file_metadata')).toBe('Matched in file metadata')
    expect(matchedFieldLabel('relationship')).toBe('Matched in relationship')
  })

  it('falls back to "Matched" for unknown fields', () => {
    expect(matchedFieldLabel('unknown')).toBe('Matched')
  })

  it('MATCHED_FIELD_LABELS covers all named fields', () => {
    for (const [, label] of Object.entries(MATCHED_FIELD_LABELS)) {
      expect(label).toMatch(/^Matched in /)
    }
  })
})

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

describe('searchQueryKeys', () => {
  it('produces stable keys that differ by filter values', () => {
    const base: SearchFilters = { query: 'virus' }
    const key1 = searchQueryKeys.search(base)
    const key2 = searchQueryKeys.search({ ...base, kind: 'experiment' })
    expect(key1).not.toEqual(key2)
    expect(key1[0]).toBe('search-001')
  })

  it('produces distinct keys for distinct object-class filters', () => {
    const base: SearchFilters = { query: 'virus' }
    const recordsKey = searchQueryKeys.search({ ...base, resultType: 'record' })
    const datasetsKey = searchQueryKeys.search({
      ...base,
      resultType: 'dataset',
    })
    const allKey = searchQueryKeys.search(base)
    expect(recordsKey).not.toEqual(datasetsKey)
    expect(recordsKey).not.toEqual(allKey)
    expect(datasetsKey).not.toEqual(allKey)
    expect(recordsKey).toContain('resultType=record')
    expect(datasetsKey).toContain('resultType=dataset')
  })

  it('produces distinct keys for the archived scope', () => {
    const base: SearchFilters = { query: 'virus' }
    expect(
      searchQueryKeys.search({ ...base, includeArchived: true }),
    ).not.toEqual(searchQueryKeys.search({ ...base, includeArchived: false }))
  })
})

// ---------------------------------------------------------------------------
// executeSearch — verifies the client RPC call and array normalisation.
// ---------------------------------------------------------------------------

describe('executeSearch', () => {
  function mockClient(rows: SearchResultWire | SearchResultWire[]): DataClient {
    return {
      list: async () => [],
      insert: async () => ({}),
      patch: async () => [],
      rpc: async () => rows,
    } as unknown as DataClient
  }

  it('maps an array of wire rows to domain results', async () => {
    const results = await executeSearch(mockClient([wireRow()]), {
      query: 'virus',
    })
    expect(results).toHaveLength(1)
    expect(results[0].identifier).toBe('EXP-2025-0001')
  })

  it('normalises a single-object RPC response into an array', async () => {
    const results = await executeSearch(mockClient(wireRow()), {
      query: 'virus',
    })
    expect(results).toHaveLength(1)
  })
})

describe('search cache behaviour (filters in query key)', () => {
  function countingClient(): { client: DataClient; calls: string[] } {
    const calls: string[] = []
    return {
      calls,
      client: {
        list: async () => [],
        insert: async () => ({}),
        patch: async () => [],
        rpc: async (_name: string, args: Record<string, unknown>) => {
          const resultType =
            (args as { p_result_type?: string }).p_result_type ?? 'all'
          calls.push(resultType)
          return [
            wireRow({
              result_type: resultType === 'all' ? 'record' : resultType,
            }),
          ]
        },
      } as unknown as DataClient,
    }
  }

  it('refetches instead of serving the previous cache when resultType changes', async () => {
    const { client, calls } = countingClient()
    const queryClient = new QueryClient()

    // Mirror the search route: staleTime keeps entries cached between renders.
    const fetch = async (filters: SearchFilters) =>
      queryClient.fetchQuery({
        queryKey: searchQueryKeys.search(filters),
        queryFn: () => executeSearch(client, filters),
        staleTime: 10_000,
      })

    const recordResults = await fetch({ query: 'virus', resultType: 'record' })
    const datasetResults = await fetch({
      query: 'virus',
      resultType: 'dataset',
    })

    // Two distinct object-class filters must fire two distinct requests.
    expect(calls).toEqual(['record', 'dataset'])
    expect(recordResults[0].resultType).toBe('record')
    expect(datasetResults[0].resultType).toBe('dataset')
    // The pre-fix bug: the dataset fetch was served from the record cache.
    expect(datasetResults).not.toEqual(recordResults)
  })

  it('refetches instead of serving the previous cache when the archived scope changes', async () => {
    const calls: Array<string> = []
    const client = {
      list: async () => [],
      insert: async () => ({}),
      patch: async () => [],
      rpc: async (_name: string, args: Record<string, unknown>) => {
        const archived =
          args.p_include_archived === undefined
            ? true
            : Boolean(args.p_include_archived)
        calls.push(String(archived))
        return [wireRow({ archived })]
      },
    } as unknown as DataClient
    const queryClient = new QueryClient()

    const fetch = async (filters: SearchFilters) =>
      queryClient.fetchQuery({
        queryKey: searchQueryKeys.search(filters),
        queryFn: () => executeSearch(client, filters),
        staleTime: 10_000,
      })

    await fetch({ query: 'virus', includeArchived: false })
    await fetch({ query: 'virus', includeArchived: true })

    // Toggling the facet must reach the boundary rather than replay the cache.
    expect(calls).toEqual(['false', 'true'])
  })
})

// ---------------------------------------------------------------------------
// SEARCHABLE_KINDS — sanity check the kind list matches the DB constraint.
// ---------------------------------------------------------------------------

describe('SEARCHABLE_KINDS', () => {
  it('contains all record kinds from the chk_records_kind constraint', () => {
    expect(SEARCHABLE_KINDS).toEqual([
      'experiment',
      'protocol_template',
      'report',
      'sample',
      'material',
      'file',
      'notebook_template',
      'study',
    ])
  })
})

// ---------------------------------------------------------------------------
// SEARCH-001 — Relevance ranking tiers.
// ---------------------------------------------------------------------------

describe('matchTierForField', () => {
  it('assigns tier 0 for exact identifier substring match', () => {
    expect(matchTierForField('identifier', 'EXP-2025', 'EXP-2025-0014')).toBe(0)
  })

  it('assigns tier 1 for identifier field match that is not a substring', () => {
    // The FTS might match on a stemmed token, but the raw identifier doesn't
    // contain the query as a substring.
    expect(matchTierForField('identifier', 'experiment', 'EXP-2025-0014')).toBe(
      1,
    )
  })

  it('assigns tier 2 for title field match', () => {
    expect(matchTierForField('title', 'virus', 'EXP-2025-0014')).toBe(2)
  })

  it('assigns tier 3 for structured matches (tags, status, kind)', () => {
    expect(matchTierForField('tags', 'lentivirus', 'EXP-2025-0014')).toBe(3)
    expect(matchTierForField('status', 'progress', 'EXP-2025-0014')).toBe(3)
    expect(matchTierForField('kind', 'experiment', 'EXP-2025-0014')).toBe(3)
  })

  it('assigns tier 4 for fuzzy text matches', () => {
    expect(matchTierForField('block_text', 'stability', 'EXP-2025-0014')).toBe(
      4,
    )
    expect(
      matchTierForField('file_metadata', 'amplification', 'EXP-2025-0014'),
    ).toBe(4)
    expect(
      matchTierForField('properties', 'concentration', 'EXP-2025-0014'),
    ).toBe(4)
    expect(
      matchTierForField('relationship', 'SMP-2025-0001', 'EXP-2025-0014'),
    ).toBe(4)
  })

  it('handles empty query (browse mode) with tier 4 for fuzzy fields', () => {
    expect(matchTierForField('block_text', '', 'EXP-2025-0014')).toBe(4)
  })
})

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    resultType: 'record',
    recordId: 'rec-1',
    kind: 'experiment',
    identifier: 'EXP-2025-0001',
    title: 'Virus Stability at 4 °C',
    status: 'in-progress',
    projectId: 'proj-1',
    archived: false,
    createdByUserId: 'user-1',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-20T14:30:00Z',
    matchedContext: 'Virus <b>Stability</b> at 4 °C',
    matchedField: 'title',
    rank: 0.06,
    deepLink: '/records/rec-1',
    totalCount: 1,
    ...overrides,
  }
}

describe('rankByTier', () => {
  it('ranks exact identifier matches (tier 0) before title matches (tier 2)', () => {
    const titleMatch = searchResult({
      recordId: 'rec-a',
      matchedField: 'title',
      rank: 0.08,
    })
    const idMatch = searchResult({
      recordId: 'rec-b',
      identifier: 'EXP-2025-0001',
      matchedField: 'identifier',
      rank: 0.02,
    })
    const ranked = rankByTier([titleMatch, idMatch], 'EXP-2025-0001')
    expect(ranked[0].recordId).toBe('rec-b') // identifier match first
    expect(ranked[1].recordId).toBe('rec-a')
  })

  it('ranks structured matches (tier 3) before fuzzy text (tier 4)', () => {
    const fuzzy = searchResult({
      recordId: 'rec-a',
      matchedField: 'block_text',
      rank: 0.09,
    })
    const structured = searchResult({
      recordId: 'rec-b',
      matchedField: 'tags',
      rank: 0.01,
    })
    const ranked = rankByTier([fuzzy, structured], 'lentivirus')
    expect(ranked[0].recordId).toBe('rec-b')
    expect(ranked[1].recordId).toBe('rec-a')
  })

  it('preserves ts_rank order within the same tier', () => {
    const low = searchResult({
      recordId: 'rec-a',
      matchedField: 'title',
      rank: 0.01,
    })
    const high = searchResult({
      recordId: 'rec-b',
      matchedField: 'title',
      rank: 0.09,
    })
    const ranked = rankByTier([low, high], 'virus')
    expect(ranked[0].recordId).toBe('rec-b') // higher rank first
  })

  it('falls back to updated_at order in browse mode (empty query)', () => {
    const older = searchResult({
      recordId: 'rec-a',
      updatedAt: '2025-01-01T00:00:00Z',
    })
    const newer = searchResult({
      recordId: 'rec-b',
      updatedAt: '2025-06-01T00:00:00Z',
    })
    const ranked = rankByTier([older, newer], '')
    expect(ranked[0].recordId).toBe('rec-b') // newer first
  })
})

// ---------------------------------------------------------------------------
// SEARCH-001 — Semantic suggestions.
// ---------------------------------------------------------------------------

describe('deriveSuggestions', () => {
  it('returns no suggestions for empty query', () => {
    expect(deriveSuggestions([searchResult()], '')).toEqual([])
  })

  it('returns no suggestions for empty results', () => {
    expect(deriveSuggestions([], 'virus')).toEqual([])
  })

  it('offers identifier suggestions when query matches an identifier', () => {
    const results = [
      searchResult({
        recordId: 'rec-a',
        identifier: 'EXP-2025-0014',
        matchedField: 'identifier',
        title: 'Virus Stability at 4 °C',
      }),
    ]
    const suggestions = deriveSuggestions(results, 'EXP-2025')
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].kind).toBe('identifier')
    expect(suggestions[0].label).toBe('EXP-2025-0014')
    expect(suggestions[0].applyQuery).toBe('EXP-2025-0014')
    expect(suggestions[0].provenance).toContain('Identifier match')
  })

  it('offers type filter suggestions when results span multiple kinds', () => {
    const results = [
      searchResult({ recordId: 'rec-a', kind: 'experiment' }),
      searchResult({ recordId: 'rec-b', kind: 'sample' }),
    ]
    const suggestions = deriveSuggestions(results, 'test')
    const typeSuggestions = suggestions.filter((s) => s.kind === 'type')
    expect(typeSuggestions.length).toBe(2) // one per kind
    expect(typeSuggestions[0].provenance).toContain('in current results')
  })

  it('does not offer type suggestions when all results are the same kind', () => {
    const results = [
      searchResult({ recordId: 'rec-a', kind: 'experiment' }),
      searchResult({ recordId: 'rec-b', kind: 'experiment' }),
    ]
    const suggestions = deriveSuggestions(results, 'test')
    expect(suggestions.filter((s) => s.kind === 'type')).toHaveLength(0)
  })

  it('does not offer a Record-kind filter for comment hits', () => {
    const suggestions = deriveSuggestions(
      [
        searchResult({ resultType: 'record', kind: 'sample' }),
        searchResult({
          resultType: 'comment',
          kind: 'comment',
          matchedField: 'comment_body',
        }),
      ],
      'recovery',
    )
    expect(
      suggestions.filter((suggestion) => suggestion.kind === 'type'),
    ).toEqual([])
  })

  it('limits to 6 suggestions', () => {
    const results = SEARCHABLE_KINDS.map((kind, i) =>
      searchResult({
        recordId: `rec-${i}`,
        kind,
        identifier: `ID-${kind}-${i}`,
        matchedField: 'identifier',
        title: `Result ${kind}`,
      }),
    )
    const suggestions = deriveSuggestions(results, 'ID')
    // 7 identifier matches (all kinds have identifier matching 'ID')
    // + 7 type suggestions (7 kinds). But limited to 6 total.
    expect(suggestions.length).toBeLessThanOrEqual(6)
  })
})

// ---------------------------------------------------------------------------
// SEARCH-001 — Saved queries (localStorage).
// ---------------------------------------------------------------------------

describe('saved queries', () => {
  const wsId = 'test-workspace-saved-queries'

  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty array when no saved queries exist', () => {
    expect(loadSavedQueries(wsId)).toEqual([])
  })

  it('saves and loads a query', () => {
    const next = saveQuery(wsId, {
      name: 'My search',
      query: 'virus stability',
      kind: 'experiment',
      projectId: '',
      status: '',
      ownerId: '',
      dateRange: 'all',
    })
    expect(next).toHaveLength(1)
    expect(next[0].name).toBe('My search')
    expect(next[0].query).toBe('virus stability')

    const loaded = loadSavedQueries(wsId)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].name).toBe('My search')
  })

  it('deduplicates by name + query + filters', () => {
    saveQuery(wsId, {
      name: 'My search',
      query: 'virus',
      kind: '',
      projectId: '',
      status: '',
      ownerId: '',
      dateRange: 'all',
    })
    const next = saveQuery(wsId, {
      name: 'My search',
      query: 'virus',
      kind: '',
      projectId: '',
      status: '',
      ownerId: '',
      dateRange: 'all',
    })
    expect(next).toHaveLength(1)
  })

  it('deletes a saved query by id', () => {
    const next = saveQuery(wsId, {
      name: 'To delete',
      query: 'test',
      kind: '',
      projectId: '',
      status: '',
      ownerId: '',
      dateRange: 'all',
    })
    const id = next[0].id
    const afterDelete = deleteSavedQuery(wsId, id)
    expect(afterDelete).toEqual([])
  })

  it('scopes saved queries by workspace id', () => {
    saveQuery('ws-a', {
      name: 'WS A search',
      query: 'alpha',
      kind: '',
      projectId: '',
      status: '',
      ownerId: '',
      dateRange: 'all',
    })
    saveQuery('ws-b', {
      name: 'WS B search',
      query: 'beta',
      kind: '',
      projectId: '',
      status: '',
      ownerId: '',
      dateRange: 'all',
    })
    expect(loadSavedQueries('ws-a')).toHaveLength(1)
    expect(loadSavedQueries('ws-b')).toHaveLength(1)
    expect(loadSavedQueries('ws-a')[0].name).toBe('WS A search')
    expect(loadSavedQueries('ws-b')[0].name).toBe('WS B search')
  })

  it('generates a stable localStorage key', () => {
    expect(savedQueriesKey('ws-1')).toBe('sheetbase-saved-searches-ws-1')
  })
})

// ---------------------------------------------------------------------------
// SEARCH-001 — URL search parameter helpers.
// ---------------------------------------------------------------------------

describe('parseSearchUrl', () => {
  it('applies defaults for missing values', () => {
    expect(parseSearchUrl({})).toEqual(SEARCH_URL_DEFAULTS)
  })

  it('parses provided values', () => {
    const parsed = parseSearchUrl({
      q: 'virus stability',
      type: 'dataset',
      kind: 'experiment',
      project: 'proj-1',
      status: 'in-progress',
      owner: 'user-1',
      date: '30d',
      sort: 'updated',
      selected: 'rec-1',
    })
    expect(parsed).toEqual({
      q: 'virus stability',
      type: 'dataset',
      kind: 'experiment',
      project: 'proj-1',
      status: 'in-progress',
      owner: 'user-1',
      date: '30d',
      sort: 'updated',
      selected: 'rec-1',
    })
  })

  it('defaults an unknown object class to all classes', () => {
    expect(parseSearchUrl({ type: 'widgets' }).type).toBe('')
  })

  it('defaults invalid sort to relevance', () => {
    expect(parseSearchUrl({ sort: 'invalid' }).sort).toBe('relevance')
  })

  it('defaults non-string values to empty/default', () => {
    const parsed = parseSearchUrl({ q: 123, kind: null })
    expect(parsed.q).toBe('')
    expect(parsed.kind).toBe('')
  })
})

describe('serializeSearchUrl', () => {
  it('merges partial params with defaults', () => {
    const serialized = serializeSearchUrl({ q: 'test' })
    expect(serialized.q).toBe('test')
    expect(serialized.kind).toBe('')
    expect(serialized.date).toBe('all')
    expect(serialized.sort).toBe('relevance')
  })

  it('preserves all provided values', () => {
    const serialized = serializeSearchUrl({
      q: 'test',
      kind: 'experiment',
      project: 'proj-1',
    })
    expect(serialized.q).toBe('test')
    expect(serialized.kind).toBe('experiment')
    expect(serialized.project).toBe('proj-1')
  })
})

// ---------------------------------------------------------------------------
// SRCH-02 — result grouping shared by the results page and the palette.
// ---------------------------------------------------------------------------

describe('searchResultGroup', () => {
  it('maps files and templates to their own sections', () => {
    expect(searchResultGroup(searchResult({ resultType: 'file' }))).toBe(
      'Files',
    )
    expect(searchResultGroup(searchResult({ resultType: 'template' }))).toBe(
      'Templates',
    )
  })

  it('groups datasets and sheets together', () => {
    expect(
      searchResultGroup(
        searchResult({ resultType: 'dataset', kind: 'dataset' }),
      ),
    ).toBe('Sheet and dataset rows')
    expect(
      searchResultGroup(
        searchResult({ resultType: 'sheet', kind: 'sheet_instance' }),
      ),
    ).toBe('Sheet and dataset rows')
  })

  it('prefers notebook text over the owning record', () => {
    expect(
      searchResultGroup(searchResult({ matchedField: 'block_text' })),
    ).toBe('Notebook text and comments')
  })

  it('maps sample kind before the generic Records bucket', () => {
    expect(searchResultGroup(searchResult({ kind: 'sample' }))).toBe('Samples')
    expect(searchResultGroup(searchResult({ kind: 'experiment' }))).toBe(
      'Records',
    )
  })

  it('prefers an explicit object class over a matched field', () => {
    expect(
      searchResultGroup(
        searchResult({
          resultType: 'dataset',
          kind: 'dataset',
          matchedField: 'block_text',
        }),
      ),
    ).toBe('Sheet and dataset rows')
  })
})

describe('groupSearchResults', () => {
  const dataset = searchResult({
    recordId: 'ds-1',
    resultType: 'dataset',
    kind: 'dataset',
  })
  const sheet = searchResult({
    recordId: 'sh-1',
    resultType: 'sheet',
    kind: 'sheet_instance',
  })
  const sampleA = searchResult({ recordId: 'sa', kind: 'sample' })
  const sampleB = searchResult({ recordId: 'sb', kind: 'sample' })
  const sampleC = searchResult({ recordId: 'sc', kind: 'sample' })

  it('preserves canonical section order regardless of input order', () => {
    const buckets = groupSearchResults([dataset, sampleA, sheet])
    expect(buckets.map((b) => b.group)).toEqual([
      'Samples',
      'Sheet and dataset rows',
    ])
  })

  it('keeps input order within a group', () => {
    const buckets = groupSearchResults([sampleA, sampleB, sampleC])
    expect(buckets[0].results.map((r) => r.recordId)).toEqual([
      'sa',
      'sb',
      'sc',
    ])
  })

  it('truncates displayed results but keeps an honest total', () => {
    const buckets = groupSearchResults([sampleA, sampleB, sampleC], 2)
    expect(buckets[0].results).toHaveLength(2)
    expect(buckets[0].total).toBe(3)
  })

  it('returns an empty array when there are no results', () => {
    expect(groupSearchResults([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SRCH-02 — scope filtering.
// ---------------------------------------------------------------------------

describe('filterBySearchScope', () => {
  const projectA = searchResult({ recordId: 'a', projectId: 'p-a' })
  const projectB = searchResult({ recordId: 'b', projectId: 'p-b' })
  const workspaceTemplate = searchResult({
    recordId: 't',
    resultType: 'template',
    kind: 'notebook_template',
    projectId: null,
  })

  it('returns every result when no scope is set', () => {
    expect(
      filterBySearchScope([projectA, projectB, workspaceTemplate]),
    ).toHaveLength(3)
  })

  it('keeps only results owned by the scoped project', () => {
    expect(
      filterBySearchScope([projectA, projectB, workspaceTemplate], 'p-a').map(
        (r) => r.recordId,
      ),
    ).toEqual(['a'])
  })

  it('drops workspace-level templates that carry no project', () => {
    expect(filterBySearchScope([workspaceTemplate], 'p-a')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SRCH-02 — URL facets → RPC arguments.
// ---------------------------------------------------------------------------

describe('urlFiltersToSearchFilters', () => {
  it('carries the query and pagination defaults', () => {
    const filters = urlFiltersToSearchFilters({ q: ' C-150 ' }, 0)
    expect(filters.query).toBe(' C-150 ')
    expect(filters.limit).toBe(SEARCH_PAGE_SIZE)
    expect(filters.offset).toBe(0)
  })

  it('pushes a single project facet through as p_project_id', () => {
    const filters = urlFiltersToSearchFilters({ q: 'x', project: ['p-1'] }, 40)
    expect(filters.projectId).toBe('p-1')
    expect(filters.offset).toBe(40)
  })

  it('does not push an ambiguous multi-project facet', () => {
    const filters = urlFiltersToSearchFilters(
      { q: 'x', project: ['p-1', 'p-2'] },
      0,
    )
    expect(filters.projectId).toBeUndefined()
  })

  it('maps single object-class facets onto the RPC result type', () => {
    expect(
      urlFiltersToSearchFilters({ q: 'x', type: ['Files'] }, 0).resultType,
    ).toBe('file')
    expect(
      urlFiltersToSearchFilters({ q: 'x', type: ['Templates'] }, 0).resultType,
    ).toBe('template')
    expect(
      urlFiltersToSearchFilters({ q: 'x', type: ['Records'] }, 0).resultType,
    ).toBe('record')
  })

  it('maps the Samples facet onto the record kind', () => {
    const filters = urlFiltersToSearchFilters({ q: 'x', type: ['Samples'] }, 0)
    expect(filters.kind).toBe('sample')
    expect(filters.resultType).toBeUndefined()
  })

  it('leaves facets with no single RPC equivalent unfiltered server-side', () => {
    const filters = urlFiltersToSearchFilters(
      { q: 'x', type: ['Notebook text and comments'] },
      0,
    )
    expect(filters.resultType).toBeUndefined()
    expect(filters.kind).toBeUndefined()
  })

  it('converts the 7-day facet into a stable p_date_from', () => {
    const filters = urlFiltersToSearchFilters({ q: 'x', updated: '7d' }, 0)
    expect(filters.dateFrom).toBeDefined()
    const from = Date.parse(filters.dateFrom as string)
    expect(Number.isNaN(from)).toBe(false)
    // Anchored to start-of-day, so always at or before "now - 7 days".
    expect(from).toBeLessThanOrEqual(Date.now() - 7 * 86_400_000)
  })

  it('chains into buildSearchRpcArgs as the RPC p_* arguments', () => {
    const filters = urlFiltersToSearchFilters(
      {
        q: 'C-150',
        type: ['Samples'],
        project: ['p-1'],
        updated: '7d',
      },
      40,
    )
    const args = buildSearchRpcArgs(filters)
    expect(args.p_query).toBe('C-150')
    expect(args.p_kind).toBe('sample')
    expect(args.p_project_id).toBe('p-1')
    expect(args.p_limit).toBe(SEARCH_PAGE_SIZE)
    expect(args.p_offset).toBe(40)
    expect(args.p_date_from).toBe(filters.dateFrom)
  })

  it('expresses the archived scope as the RPC p_include_archived argument', () => {
    // Default URL (no archived facet) asks the boundary for live work only.
    const live = urlFiltersToSearchFilters({ q: 'x' }, 0)
    expect(live.includeArchived).toBe(false)
    expect(buildSearchRpcArgs(live).p_include_archived).toBe(false)
    // "Include archived" flips the same scope on.
    const all = urlFiltersToSearchFilters({ q: 'x', archived: true }, 0)
    expect(all.includeArchived).toBe(true)
    expect(buildSearchRpcArgs(all).p_include_archived).toBe(true)
  })
})

describe('filterSearchResults', () => {
  const sample = searchResult({
    recordId: 's',
    kind: 'sample',
    projectId: 'p-a',
  })
  const file = searchResult({
    recordId: 'f',
    resultType: 'file',
    kind: 'file',
    projectId: 'p-a',
  })
  const archived = searchResult({
    recordId: 'arch',
    kind: 'sample',
    projectId: 'p-a',
    archived: true,
  })

  it('filters by the selected group facet', () => {
    const filtered = filterSearchResults([sample, file], { type: ['Files'] })
    expect(filtered.map((r) => r.recordId)).toEqual(['f'])
  })

  it('filters by one of several selected projects', () => {
    const other = searchResult({ recordId: 'o', projectId: 'p-b' })
    const filtered = filterSearchResults([sample, other], {
      project: ['p-a', 'p-b'],
    })
    expect(filtered.map((r) => r.recordId)).toEqual(['s', 'o'])
  })

  it('keeps archived rows the boundary returned (no browser filtering)', () => {
    // The archived scope is pushed to the RPC as p_include_archived; by the
    // time results reach this client-side facet filter, the boundary has
    // already decided, so no row is dropped here.
    expect(
      filterSearchResults([sample, archived], { archived: true }),
    ).toHaveLength(2)
  })

  it('drops results older than the 7-day window', () => {
    const recent = searchResult({
      recordId: 'recent',
      updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    })
    const old = searchResult({
      recordId: 'old',
      updatedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    })
    const filtered = filterSearchResults([recent, old], { updated: '7d' })
    expect(filtered.map((r) => r.recordId)).toEqual(['recent'])
  })

  it('keeps only rows created by the chosen owner', () => {
    const mine = searchResult({ recordId: 'm', createdByUserId: 'u-1' })
    const theirs = searchResult({ recordId: 't', createdByUserId: 'u-2' })
    expect(
      filterSearchResults([mine, theirs], { owner: 'u-1' }).map(
        (r) => r.recordId,
      ),
    ).toEqual(['m'])
  })

  it('keeps rows inside an inclusive date range', () => {
    const before = searchResult({
      recordId: 'before',
      updatedAt: '2026-03-31T23:59:59Z',
    })
    const first = searchResult({
      recordId: 'first',
      updatedAt: '2026-04-01T00:00:00Z',
    })
    const last = searchResult({
      recordId: 'last',
      updatedAt: '2026-04-30T23:30:00Z',
    })
    const after = searchResult({
      recordId: 'after',
      updatedAt: '2026-05-01T00:00:00Z',
    })
    const filtered = filterSearchResults([before, first, last, after], {
      from: '2026-04-01',
      to: '2026-04-30',
    })
    expect(filtered.map((r) => r.recordId)).toEqual(['first', 'last'])
  })
})

describe('owner and date-range facets', () => {
  it('pushes the owner and the range to the RPC arguments', () => {
    const args = buildSearchRpcArgs(
      urlFiltersToSearchFilters(
        { q: 'x', owner: 'u-1', from: '2026-04-01', to: '2026-04-30' },
        0,
      ),
    )
    expect(args.p_owner_id).toBe('u-1')
    expect(args.p_date_from).toBe('2026-04-01T00:00:00.000Z')
    expect(args.p_date_to).toBe('2026-04-30T23:59:59.999Z')
  })

  it('lets an explicit range win over the 7-day shortcut', () => {
    const filters = urlFiltersToSearchFilters(
      { q: 'x', updated: '7d', from: '2026-01-02' },
      0,
    )
    expect(filters.dateFrom).toBe('2026-01-02T00:00:00.000Z')
  })

  it('ignores a malformed or impossible day', () => {
    expect(parseSearchDay('2026-02-30')).toBeUndefined()
    expect(parseSearchDay('yesterday')).toBeUndefined()
    expect(parseSearchDay(undefined)).toBeUndefined()
    expect(parseSearchDay('2026-02-28')).toBe('2026-02-28')
    const filters = urlFiltersToSearchFilters({ q: 'x', to: 'soon' }, 0)
    expect(filters.dateTo).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SRCH-02 — contextual actions and new-tab URLs.
// ---------------------------------------------------------------------------

describe('contextualSearchActions', () => {
  it('offers the sample register flow for a sample result', () => {
    const actions = contextualSearchActions([
      searchResult({ kind: 'sample', identifier: 'SMP-2248' }),
    ])
    expect(actions).toHaveLength(1)
    expect(actions[0].label).toBe('Register a sample from SMP-2248…')
    expect(actions[0].to).toBe('/samples')
    expect(actions[0].search).toEqual({ new: true })
  })

  it('deduplicates repeated sample identifiers', () => {
    const actions = contextualSearchActions([
      searchResult({ recordId: 'a', kind: 'sample', identifier: 'SMP-1' }),
      searchResult({ recordId: 'b', kind: 'sample', identifier: 'SMP-1' }),
    ])
    expect(actions).toHaveLength(1)
  })

  it('offers no actions when no registered kind is present', () => {
    expect(
      contextualSearchActions([searchResult({ kind: 'experiment' })]),
    ).toEqual([])
  })
})

describe('searchActionHref', () => {
  it('serialises search params into a shareable href', () => {
    expect(
      searchActionHref({
        id: 'register-sample',
        label: 'Register a sample…',
        to: '/samples',
        search: { new: true },
      }),
    ).toBe('/samples?new=true')
  })

  it('returns the bare path when there are no params', () => {
    expect(
      searchActionHref({
        id: 'x',
        label: 'X',
        to: '/datasets',
      }),
    ).toBe('/datasets')
  })
})

describe('searchResultNewTabUrl', () => {
  it('resolves a relative deep link against the origin', () => {
    expect(
      searchResultNewTabUrl('/records/rec-1', 'https://app.sheetbase.co.uk'),
    ).toBe('https://app.sheetbase.co.uk/records/rec-1')
  })

  it('preserves query strings on a destination', () => {
    expect(
      searchResultNewTabUrl('/samples?new=true', 'https://app.sheetbase.co.uk'),
    ).toBe('https://app.sheetbase.co.uk/samples?new=true')
  })
})

describe('saved searches keep the results-page facets', () => {
  const wsId = 'test-workspace-saved-searches'
  beforeEach(() => localStorage.clear())

  it('round-trips a search with its facets through storage', () => {
    const search = {
      q: 'plate',
      type: ['Files'],
      project: ['p-1'],
      updated: '7d' as const,
      owner: 'u-1',
      archived: true,
    }
    const saved = saveCurrentSearch(wsId, ' Plates ', search)
    expect(saved[0].name).toBe('Plates')
    expect(savedQueryToSearch(loadSavedQueries(wsId)[0])).toEqual(search)
  })

  it('omits empty facets and treats older entries as a bare query', () => {
    saveCurrentSearch(wsId, 'Bare', { q: 'x', type: [], owner: '' })
    expect(savedQueryToSearch(loadSavedQueries(wsId)[0])).toEqual({ q: 'x' })
    expect(
      savedQueryToSearch({
        id: 'old',
        name: 'Old',
        query: 'legacy',
        kind: '',
        projectId: '',
        status: '',
        ownerId: '',
        dateRange: 'all',
        ts: 1,
      }),
    ).toEqual({ q: 'legacy' })
  })

  it('keeps two saves of one query with different facets apart', () => {
    saveCurrentSearch(wsId, 'Same', { q: 'x' })
    const next = saveCurrentSearch(wsId, 'Same', { q: 'x', owner: 'u-1' })
    expect(next).toHaveLength(2)
  })
})
