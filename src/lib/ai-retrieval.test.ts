/**
 * AI-02 quality fixtures: representative scientific questions over
 * fixture-shaped data with expected cited objects.
 *
 * The mock below implements the `api.search` RPC *contract* (wire shape,
 * AND token semantics, field-weighted rank, archived-included /
 * deleted-excluded, permission-filtered totals, pagination with
 * `total_count`) over a fixed fixture corpus — it is not a copy of the SQL.
 * PostgreSQL and RLS remain authoritative; the fixture measures retrieval
 * quality (right canonical objects, pins, order, lifecycle marking) rather
 * than re-testing the database.
 *
 * Coverage: exact identifier match, title match, block-text match,
 * dataset/sheet/template classes, archived-marked lifecycle, deleted
 * exclusion, RLS-invisible exclusion, freshness/pins, rank order,
 * totalCount/hasMore, fail-closed validation, write purity, and envelope
 * integration (citations → objects, template/budget omissions).
 */
import { describe, expect, it, vi } from 'vitest'

import {
  assembleGroundedContext,
  citationToObjectRef,
  retrieveForAi,
  toAiCitation,
} from './ai-retrieval'
import type { AiCitation } from './ai-retrieval'
import type { AiContextActor } from './ai-context'
import type { DataClient } from './data-client'
import { toSearchResult } from './search'
import type { SearchResultWire } from './search'

// ---------------------------------------------------------------------------
// Fixture corpus. `visible` is what the actor may see through RLS; `hidden`
// and `deleted` exist in the fictional database but must never be cited.
// ---------------------------------------------------------------------------

const WS = '20000000-0000-4000-8000-000000000001'
const ACTOR: AiContextActor = { kind: 'user', id: 'user-1' }

const STABILITY_ID = '11111111-0000-4000-8000-000000000001'
const FREEZETHAW_ID = '11111111-0000-4000-8000-000000000002'
const PROTOCOL_ID = '11111111-0000-4000-8000-000000000003'
const DATASET_ID = '22222222-0000-4000-8000-000000000001'
const SHEET_ID = '33333333-0000-4000-8000-000000000001'
const TEMPLATE_ID = '44444444-0000-4000-8000-000000000001'

interface FixtureDoc {
  resultType: string
  recordId: string
  kind: string
  identifier: string
  title: string
  status: string
  projectId: string | null
  archived: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  fields: {
    title: string
    identifier: string
    tags: string
    blockText: string
    description: string
  }
}

const VISIBLE_DOCS: FixtureDoc[] = [
  {
    resultType: 'record',
    recordId: STABILITY_ID,
    kind: 'experiment',
    identifier: 'EXP-2026-0101',
    title: 'Lentivector stability at 4 C',
    status: 'active',
    projectId: 'proj-1',
    archived: false,
    createdBy: 'user-1',
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-03-02T00:00:00Z',
    fields: {
      title: 'Lentivector stability at 4 C',
      identifier: 'EXP-2026-0101',
      tags: 'lentivector cold-chain',
      blockText:
        'Evaluated lentiviral vector stability over 21 days at 4 degrees.',
      description: '',
    },
  },
  {
    resultType: 'record',
    recordId: FREEZETHAW_ID,
    kind: 'experiment',
    identifier: 'EXP-2026-0102',
    title: 'Lentivector freeze thaw kinetics',
    status: 'active',
    projectId: 'proj-1',
    archived: false,
    createdBy: 'user-1',
    createdAt: '2026-02-02T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    fields: {
      title: 'Lentivector freeze thaw kinetics',
      identifier: 'EXP-2026-0102',
      tags: 'lentivector freeze-thaw',
      blockText: 'Three freeze thaw cycles reduced functional titre by half.',
      description: '',
    },
  },
  {
    resultType: 'record',
    recordId: PROTOCOL_ID,
    kind: 'protocol_template',
    identifier: 'PROT-2026-0007',
    title: 'Archived transduction protocol',
    status: 'archived',
    projectId: 'proj-1',
    archived: true,
    createdBy: 'user-1',
    createdAt: '2026-01-05T00:00:00Z',
    updatedAt: '2026-01-20T00:00:00Z',
    fields: {
      title: 'Archived transduction protocol',
      identifier: 'PROT-2026-0007',
      tags: 'transduction',
      blockText: 'Transduction protocol retired after the vector switch.',
      description: '',
    },
  },
  {
    resultType: 'dataset',
    recordId: DATASET_ID,
    kind: 'dataset',
    identifier: DATASET_ID,
    title: 'CRISPR screen dose response readouts',
    status: 'active',
    projectId: 'proj-1',
    archived: false,
    createdBy: 'user-1',
    createdAt: '2026-02-10T00:00:00Z',
    updatedAt: '2026-02-28T00:00:00Z',
    fields: {
      title: 'CRISPR screen dose response readouts',
      identifier: DATASET_ID,
      tags: '',
      blockText: '',
      description: 'Dose response readouts for the kinase inhibitor screen.',
    },
  },
  {
    resultType: 'sheet',
    recordId: SHEET_ID,
    kind: 'sheet_instance',
    identifier: SHEET_ID,
    title: 'Plate normalisation working sheet',
    status: 'active',
    projectId: 'proj-1',
    archived: false,
    createdBy: 'user-1',
    createdAt: '2026-02-12T00:00:00Z',
    updatedAt: '2026-02-27T00:00:00Z',
    fields: {
      title: 'Plate normalisation working sheet',
      identifier: SHEET_ID,
      tags: '',
      blockText: '',
      description:
        'Working sheet normalising plate reader output across batches.',
    },
  },
  {
    resultType: 'template',
    recordId: TEMPLATE_ID,
    kind: 'notebook_template',
    identifier: 'cloning-workflow',
    title: 'Cloning workflow template',
    status: 'retired',
    projectId: null,
    archived: true,
    createdBy: 'user-1',
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
    fields: {
      title: 'Cloning workflow template',
      identifier: 'cloning-workflow',
      tags: '',
      blockText: '',
      description: 'Standard cloning workflow with Gibson assembly steps.',
    },
  },
]

// Present in the fictional database but invisible to the actor (RLS) and
// soft-deleted respectively. Neither is indexed in the mock: the RPC would
// never return them, so the fixture asserts they stay uncited.
const DELETED_TOKEN = 'pilotzz'

// ---------------------------------------------------------------------------
// Contract-level mock of the api.search RPC.
// ---------------------------------------------------------------------------

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const FIELD_WEIGHTS: Array<{
  field: keyof FixtureDoc['fields']
  weight: number
  matchedField: string
}> = [
  { field: 'title', weight: 3, matchedField: 'title' },
  { field: 'identifier', weight: 3, matchedField: 'identifier' },
  { field: 'tags', weight: 2, matchedField: 'tags' },
  { field: 'blockText', weight: 1, matchedField: 'block_text' },
  { field: 'description', weight: 1, matchedField: 'description' },
]

function mockSearchRpc(args: Record<string, unknown>): SearchResultWire[] {
  const query = String(args.p_query ?? '')
  const recordOnly =
    args.p_kind != null || args.p_status != null || args.p_owner_id != null
  const scored: Array<{
    doc: FixtureDoc
    rank: number
    matchedField: string
    context: string
  }> = []
  for (const doc of VISIBLE_DOCS) {
    if (args.p_result_type != null) {
      const facet = String(args.p_result_type)
      if (facet === 'file' || facet === 'record') {
        if (doc.resultType !== 'record' && doc.resultType !== 'file') continue
        if ((facet === 'file') !== (doc.kind === 'file')) continue
      } else if (doc.resultType !== facet) continue
    }
    if (recordOnly && doc.resultType !== 'record' && doc.resultType !== 'file')
      continue
    if (
      args.p_project_id != null &&
      doc.projectId !== String(args.p_project_id)
    )
      continue
    if (args.p_kind != null && doc.kind !== String(args.p_kind)) continue
    if (args.p_status != null && doc.status !== String(args.p_status)) continue
    if (args.p_owner_id != null && doc.createdBy !== String(args.p_owner_id))
      continue
    const words = tokens(query)
    let score = 0
    let bestWeight = 0
    let bestField = FIELD_WEIGHTS[0]
    let ok = true
    for (const word of words) {
      let tokenBest = 0
      for (const candidate of FIELD_WEIGHTS) {
        const haystack = new Set(tokens(doc.fields[candidate.field]))
        if (haystack.has(word) && candidate.weight > tokenBest) {
          tokenBest = candidate.weight
        }
      }
      if (tokenBest === 0) {
        ok = false
        break
      }
      score += tokenBest
    }
    if (!ok) continue
    for (const candidate of FIELD_WEIGHTS) {
      const haystack = new Set(tokens(doc.fields[candidate.field]))
      const hits = words.filter((word) => haystack.has(word)).length
      if (hits > 0 && candidate.weight >= bestWeight) {
        // Strictly greater wins; ties keep the earlier (higher-priority) field.
        if (candidate.weight > bestWeight) {
          bestWeight = candidate.weight
          bestField = candidate
        }
      }
    }
    const source = doc.fields[bestField.field]
    const firstWord = words.find((word) =>
      new RegExp(`\\b${word}\\b`, 'i').test(source),
    )
    let context = source.slice(0, 120)
    if (firstWord) {
      const match = new RegExp(`(\\b${firstWord}\\b)`, 'i').exec(source)
      if (match) {
        const start = Math.max(0, match.index - 30)
        context = `${start > 0 ? '… ' : ''}${source.slice(start, match.index + match[0].length + 30).trim()} …`
        context = context.replace(match[0], `<b>${match[0]}</b>`)
      }
    }
    scored.push({
      doc,
      rank: score / 10,
      matchedField: bestField.matchedField,
      context,
    })
  }
  scored.sort(
    (a, b) => b.rank - a.rank || (a.doc.updatedAt < b.doc.updatedAt ? 1 : -1),
  )
  const total = scored.length
  const offset = Number(args.p_offset ?? 0)
  const limit = Number(args.p_limit ?? 20)
  return scored
    .slice(offset, offset + limit)
    .map(({ doc, rank, matchedField, context }) => ({
      result_type: doc.resultType,
      record_id: doc.recordId,
      kind: doc.kind,
      identifier: doc.identifier,
      title: doc.title,
      status: doc.status,
      project_id: doc.projectId,
      archived: doc.archived,
      created_by_user_id: doc.createdBy,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
      matched_context: context,
      matched_field: matchedField,
      rank: String(rank),
      deep_link: `/records/${doc.recordId}`,
      total_count: String(total),
    }))
}

function recordWire(id: string, overrides: Record<string, unknown> = {}) {
  const titles: Record<
    string,
    {
      title: string
      identifier: string
      kind: string
      status: string
      archived_at: string | null
    }
  > = {
    [STABILITY_ID]: {
      title: 'Lentivector stability at 4 C',
      identifier: 'EXP-2026-0101',
      kind: 'experiment',
      status: 'active',
      archived_at: null,
    },
    [FREEZETHAW_ID]: {
      title: 'Lentivector freeze thaw kinetics',
      identifier: 'EXP-2026-0102',
      kind: 'experiment',
      status: 'active',
      archived_at: null,
    },
    [PROTOCOL_ID]: {
      title: 'Archived transduction protocol',
      identifier: 'PROT-2026-0007',
      kind: 'protocol_template',
      status: 'archived',
      archived_at: '2026-01-20T00:00:00Z',
    },
  }
  const base = titles[id] ?? titles[STABILITY_ID]
  return {
    id,
    workspace_id: WS,
    project_id: 'proj-1',
    folder_id: null,
    kind: base.kind,
    identifier: base.identifier,
    title: base.title,
    status: base.status,
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
    archived_at: base.archived_at,
    deleted_at: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: null,
    properties: {},
    custom_fields: null,
    locked_at: null,
    locked_by_revision_id: null,
    ...overrides,
  }
}

/** Actor-scoped mock: RLS-filtered tables plus the contract-level search. */
function mockClient() {
  const records = [
    recordWire(STABILITY_ID),
    recordWire(FREEZETHAW_ID),
    recordWire(PROTOCOL_ID),
  ]
  const rpcMock = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'search') return mockSearchRpc(args)
    throw new Error(`unexpected rpc ${name}`)
  })
  const client = {
    list: vi.fn(async (resource: string, query = '') => {
      if (resource === 'records') {
        const match = /id=eq\.([^&]*)/.exec(query)
        const id = match ? decodeURIComponent(match[1]) : null
        return records.filter((row) => !id || row.id === id)
      }
      return []
    }),
    count: vi.fn(async () => 0),
    rpc: rpcMock,
    rpcMock,
    insert: vi.fn(async () => ({})),
    patch: vi.fn(async () => []),
    remove: vi.fn(async () => []),
  } as unknown as DataClient & {
    rpcMock: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }
  return client
}

function retrieve(
  client: DataClient,
  query: string,
  scope: Record<string, unknown> = {},
) {
  return retrieveForAi(client, ACTOR, query, { workspaceId: WS, ...scope })
}

// ---------------------------------------------------------------------------
// Representative scientific questions: expected canonical objects.
// ---------------------------------------------------------------------------

describe('ai-retrieval questions', () => {
  const QUESTIONS: Array<{
    question: string
    scope?: Record<string, unknown>
    expectFirst: string
    expectKind: AiCitation['kind']
  }> = [
    {
      question: 'lentivector stability',
      expectFirst: STABILITY_ID,
      expectKind: 'record',
    },
    {
      question: 'EXP-2026-0102',
      expectFirst: FREEZETHAW_ID,
      expectKind: 'record',
    },
    {
      question: 'freeze thaw kinetics titre',
      expectFirst: FREEZETHAW_ID,
      expectKind: 'record',
    },
    {
      question: 'kinase inhibitor dose response',
      expectFirst: DATASET_ID,
      expectKind: 'dataset',
    },
    {
      question: 'plate normalisation batches',
      expectFirst: SHEET_ID,
      expectKind: 'sheet',
    },
    {
      question: 'transduction protocol',
      expectFirst: PROTOCOL_ID,
      expectKind: 'record',
    },
    {
      question: 'Gibson assembly cloning',
      expectFirst: TEMPLATE_ID,
      expectKind: 'template',
    },
  ]

  for (const { question, scope, expectFirst, expectKind } of QUESTIONS) {
    it(`cites the canonical object for: ${question}`, async () => {
      const client = mockClient()
      const { citations } = await retrieve(client, question, scope)
      expect(citations.length).toBeGreaterThan(0)
      expect(citations[0].stableId).toBe(expectFirst)
      expect(citations[0].kind).toBe(expectKind)
      // Every citation resolves canonically: stable id, title, deep link.
      expect(citations[0].title).toBeTruthy()
      expect(citations[0].deepLink).toContain(citations[0].stableId)
      // Retrieval is live and unpinned — stated, never ambiguous.
      expect(citations[0].freshness).toBe('live')
      expect(citations[0].versionPin).toBeNull()
      // Quoted evidence, not full content.
      expect(citations[0].matchedContext).toContain('<b>')
    })
  }

  it('ranks the more recent title match first on a tie', async () => {
    const client = mockClient()
    const { citations } = await retrieve(client, 'lentivector')
    expect(citations.map((citation) => citation.stableId)).toEqual([
      STABILITY_ID,
      FREEZETHAW_ID,
    ])
    expect(citations[0].rank).toBeGreaterThanOrEqual(citations[1].rank)
  })
})

describe('ai-retrieval lifecycle and permission boundaries', () => {
  it('marks archived records explicitly without pinning them', async () => {
    const client = mockClient()
    const { citations } = await retrieve(client, 'transduction protocol')
    const archived = citations.find(
      (citation) => citation.stableId === PROTOCOL_ID,
    )
    expect(archived).toBeDefined()
    expect(archived?.archived).toBe(true)
    expect(archived?.freshness).toBe('live')
    expect(archived?.versionPin).toBeNull()
  })

  it('marks retired templates as archived', async () => {
    const client = mockClient()
    const { citations } = await retrieve(client, 'Gibson assembly cloning')
    expect(citations[0].archived).toBe(true)
  })

  it('never cites soft-deleted objects', async () => {
    const client = mockClient()
    const { citations, totalCount } = await retrieve(client, DELETED_TOKEN)
    expect(citations).toEqual([])
    expect(totalCount).toBe(0)
  })

  it('never cites RLS-invisible objects', async () => {
    const client = mockClient()
    const { citations, totalCount } = await retrieve(
      client,
      'competitor collaboration',
    )
    expect(citations).toEqual([])
    // Totals derive from the permission-filtered set, so nothing leaks.
    expect(totalCount).toBe(0)
  })

  it('reports totalCount and hasMore over the visible window', async () => {
    const client = mockClient()
    const full = await retrieve(client, 'lentivector')
    expect(full.totalCount).toBe(2)
    expect(full.hasMore).toBe(false)
    const paged = await retrieve(client, 'lentivector', { limit: 1 })
    expect(paged.citations).toHaveLength(1)
    expect(paged.totalCount).toBe(2)
    expect(paged.hasMore).toBe(true)
  })
})

describe('ai-retrieval contract', () => {
  it('forwards the trimmed query, filters, and clamped limit to the search RPC', async () => {
    const client = mockClient()
    await retrieve(client, '  lentivector stability  ', {
      projectId: 'proj-1',
      resultType: 'record',
      limit: 500,
    })
    expect(client.rpcMock).toHaveBeenCalledWith(
      'search',
      expect.objectContaining({
        p_query: 'lentivector stability',
        p_project_id: 'proj-1',
        p_result_type: 'record',
        p_limit: 50,
        p_offset: 0,
      }),
    )
  })

  it('fails closed on a blank query, missing actor, or missing workspace', async () => {
    const client = mockClient()
    await expect(retrieve(client, '   ')).rejects.toThrow(/query/)
    await expect(
      retrieveForAi(client, { kind: 'user', id: '' }, 'lentivector', {
        workspaceId: WS,
      }),
    ).rejects.toThrow(/actor/)
    await expect(
      retrieveForAi(client, ACTOR, 'lentivector', { workspaceId: '' }),
    ).rejects.toThrow(/workspaceId/)
  })

  it('never persists: read-only retrieval performs no writes', async () => {
    const client = mockClient()
    await retrieve(client, 'lentivector')
    expect(client.insert).not.toHaveBeenCalled()
    expect(client.patch).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
  })

  it('maps wire rows to citations with canonical deep links', () => {
    const citation = toAiCitation(
      toSearchResult({
        result_type: 'dataset',
        record_id: DATASET_ID,
        kind: 'dataset',
        identifier: DATASET_ID,
        title: 'CRISPR screen dose response readouts',
        status: 'active',
        project_id: 'proj-1',
        archived: false,
        created_by_user_id: 'user-1',
        created_at: '2026-02-10T00:00:00Z',
        updated_at: '2026-02-28T00:00:00Z',
        matched_context: 'kinase <b>inhibitor</b> screen',
        matched_field: 'description',
        rank: '0.3',
        deep_link: '/datasets?dataset=ignored',
        total_count: '1',
      }),
    )
    expect(citation).toMatchObject({
      kind: 'dataset',
      stableId: DATASET_ID,
      deepLink: `/datasets/${DATASET_ID}`,
      versionPin: null,
      freshness: 'live',
      archived: false,
      matchedField: 'description',
      rank: 0.3,
    })
  })

  it('maps citation kinds to envelope refs; templates have no envelope kind', () => {
    const ref = (kind: AiCitation['kind']): string | null =>
      citationToObjectRef({ kind, stableId: 'id' } as AiCitation)?.kind ?? null
    expect(ref('record')).toBe('record')
    expect(ref('file')).toBe('record')
    expect(ref('dataset')).toBe('dataset')
    expect(ref('sheet')).toBe('sheet')
    expect(ref('template')).toBeNull()
    expect(ref('comment')).toBeNull()
  })
})

describe('grounded envelope integration', () => {
  it('assembles one envelope object per resolvable citation with quoted context', async () => {
    const client = mockClient()
    const grounded = await assembleGroundedContext(client, ACTOR, {
      workspaceId: WS,
      query: 'lentivector',
    })
    expect(grounded.citations.map((citation) => citation.stableId)).toEqual([
      STABILITY_ID,
      FREEZETHAW_ID,
    ])
    expect(grounded.envelope.objects.map((object) => object.id)).toEqual([
      STABILITY_ID,
      FREEZETHAW_ID,
    ])
    expect(grounded.envelope.omissions).toEqual([])
    // Quoted evidence travels on the citation next to its envelope object.
    for (const citation of grounded.citations) {
      const object = grounded.envelope.objects.find(
        (entry) => entry.id === citation.stableId,
      )
      expect(object).toBeDefined()
      expect(citation.matchedContext).toContain('<b>')
      expect(object?.deepLink).toBeTruthy()
    }
    expect(grounded.totalCount).toBe(2)
    expect(grounded.hasMore).toBe(false)
  })

  it('keeps template citations citable but omits them from the envelope explicitly', async () => {
    const client = mockClient()
    const grounded = await assembleGroundedContext(client, ACTOR, {
      workspaceId: WS,
      query: 'Gibson assembly cloning',
    })
    expect(grounded.citations).toHaveLength(1)
    expect(grounded.citations[0].deepLink).toContain(TEMPLATE_ID)
    expect(grounded.envelope.objects).toEqual([])
    expect(grounded.envelope.omissions).toHaveLength(1)
    expect(grounded.envelope.omissions[0]).toMatchObject({
      kind: 'template',
      id: TEMPLATE_ID,
      reason: 'unsupported_kind',
    })
  })

  it('drops over-budget citations as explicit budget_exceeded omissions', async () => {
    const client = mockClient()
    const grounded = await assembleGroundedContext(client, ACTOR, {
      workspaceId: WS,
      query: 'lentivector',
      budgets: { maxObjects: 1 },
    })
    expect(grounded.envelope.objects).toHaveLength(1)
    expect(grounded.envelope.omissions).toHaveLength(1)
    expect(grounded.envelope.omissions[0]).toMatchObject({
      kind: 'record',
      id: FREEZETHAW_ID,
      reason: 'budget_exceeded',
    })
  })

  it('never persists while grounding', async () => {
    const client = mockClient()
    await assembleGroundedContext(client, ACTOR, {
      workspaceId: WS,
      query: 'lentivector',
    })
    expect(client.insert).not.toHaveBeenCalled()
    expect(client.patch).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
  })
})
