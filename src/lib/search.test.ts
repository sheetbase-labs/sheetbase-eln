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
import { describe, expect, it } from 'vitest'

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
} from './search'
import type { SearchResultWire, SearchFilters } from './search'
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
  it('maps a record result', () => {
    const result = toSearchResult(wireRow())
    expect(result.resultType).toBe('record')
    expect(result.kind).toBe('experiment')
    expect(result.identifier).toBe('EXP-2025-0001')
    expect(result.archived).toBe(false)
    expect(result.rank).toBeCloseTo(0.06079271)
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
})

// ---------------------------------------------------------------------------
// Deep-link generation.
// ---------------------------------------------------------------------------

describe('searchResultDeepLink', () => {
  it('links notebook templates to /templates', () => {
    expect(searchResultDeepLink('notebook_template', 'proj-1', 'rec-1')).toBe(
      '/templates',
    )
  })

  it('links records through the notebook route', () => {
    expect(searchResultDeepLink('experiment', 'proj-1', 'rec-1')).toBe(
      '/projects/proj-1/experiments/rec-1',
    )
    expect(searchResultDeepLink('sample', 'proj-1', 'rec-2')).toBe(
      '/projects/proj-1/experiments/rec-2',
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
    expect(key1[0]).toBe('sci-008')
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
      'reagent',
      'file',
      'notebook_template',
    ])
  })
})
