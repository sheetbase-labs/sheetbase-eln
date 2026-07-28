/**
 * LINEAGE-001 — Lineage data layer tests.
 *
 * Tests the pure graph-building functions for cycles, missing records,
 * restricted nodes, large neighbourhoods, filtering, timeline building,
 * table representation and inspector helpers.
 */
import { describe, expect, it } from 'vitest'

import {
  buildLineageGraph,
  buildTableData,
  buildTimeline,
  DEFAULT_FILTERS,
  detectCycles,
  filterLineageGraph,
  getLineageSummary,
  getLinkedRecordsByType,
  getTransformationHistory,
  kindToEntityType,
  linkTypeToEntityType,
  relationshipLabel,
} from './lineage-data'
import type {
  ChangeEventWire,
  LineageGraph,
  RecordLinkWire,
  RecordWire,
  ReviewDecisionWire,
  ReviewSubmissionWire,
  SignatureWire,
} from './lineage-data'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecord(
  id: string,
  kind: string,
  identifier: string,
  title: string,
  overrides: Partial<RecordWire> = {},
): RecordWire {
  return {
    id,
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    kind,
    identifier,
    title,
    status: 'draft',
    properties: {},
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2025-07-14T09:12:00Z',
    updated_at: '2025-07-14T09:12:00Z',
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: null,
    ...overrides,
  }
}

function makeLink(
  id: string,
  sourceId: string,
  targetId: string | null,
  targetKind: string,
  targetIdentifier: string,
  linkType: string,
): RecordLinkWire {
  return {
    id,
    source_record_id: sourceId,
    target_record_id: targetId,
    target_kind: targetKind,
    target_identifier: targetIdentifier,
    link_type: linkType,
    link_metadata: {},
    created_at: '2025-07-14T09:12:00Z',
    created_by_user_id: 'user-1',
  }
}

const NO_REVIEWS: ReviewSubmissionWire[] = []
const NO_DECISIONS: ReviewDecisionWire[] = []
const NO_SIGNATURES: SignatureWire[] = []
const NO_EVENTS: ChangeEventWire[] = []

// A simple experiment → sample → dataset graph
const experiment = makeRecord(
  'exp-1',
  'experiment',
  'EXP-2025-0014',
  'Virus Stability at 4°C',
)
const sample1 = makeRecord(
  'smp-1',
  'sample',
  'SMP-LV-0001',
  'Lentiviral Vector',
)
const sample2 = makeRecord('smp-2', 'sample', 'SMP-PLS-0001', 'Plasmid DNA')
const dataset1 = makeRecord(
  'ds-1',
  'experiment',
  'DS-2025-0004',
  'Raw stability data',
  { kind: 'experiment' },
)
const dataset2 = makeRecord(
  'ds-2',
  'experiment',
  'DS-2025-0011',
  'Processed data',
  { kind: 'experiment' },
)

const simpleRecords = [experiment, sample1, sample2, dataset1, dataset2]
const simpleLinks = [
  makeLink('link-1', 'exp-1', 'smp-1', 'sample', 'SMP-LV-0001', 'sample'),
  makeLink('link-2', 'exp-1', 'smp-2', 'sample', 'SMP-PLS-0001', 'sample'),
  makeLink('link-3', 'exp-1', 'ds-1', 'dataset', 'DS-2025-0004', 'dataset'),
  makeLink('link-4', 'ds-1', 'ds-2', 'dataset', 'DS-2025-0011', 'dataset'),
]

function buildSimpleGraph(): LineageGraph {
  return buildLineageGraph(
    simpleRecords,
    simpleLinks,
    NO_REVIEWS,
    NO_DECISIONS,
    NO_SIGNATURES,
    NO_EVENTS,
    'exp-1',
  )
}

// ---------------------------------------------------------------------------
// Entity type mapping
// ---------------------------------------------------------------------------

describe('entity type mapping', () => {
  it('maps record kinds to entity types', () => {
    expect(kindToEntityType('experiment')).toBe('experiment')
    expect(kindToEntityType('sample')).toBe('sample')
    expect(kindToEntityType('protocol_template')).toBe('protocol')
    expect(kindToEntityType('file')).toBe('file')
    expect(kindToEntityType('unknown_kind')).toBe('unknown')
  })

  it('maps link types to entity types', () => {
    expect(linkTypeToEntityType('sample')).toBe('sample')
    expect(linkTypeToEntityType('dataset')).toBe('dataset')
    expect(linkTypeToEntityType('protocol')).toBe('protocol')
    expect(linkTypeToEntityType('unknown')).toBe('unknown')
  })

  it('maps relationship types to human-readable labels', () => {
    expect(relationshipLabel('sample')).toBe('uses')
    expect(relationshipLabel('dataset')).toBe('generates')
    expect(relationshipLabel('reviewed_by')).toBe('reviewed by')
    expect(relationshipLabel('custom_type')).toBe('custom_type')
  })
})

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

describe('buildLineageGraph', () => {
  it('builds a graph centred on the seed record', () => {
    const graph = buildSimpleGraph()

    expect(graph.seedRecordId).toBe('exp-1')
    expect(graph.nodes.length).toBeGreaterThan(0)

    const seed = graph.nodes.find((n) => n.id === 'exp-1')
    expect(seed).toBeDefined()
    expect(seed!.depth).toBe(0)
    expect(seed!.direction).toBe('seed')
    expect(seed!.entityType).toBe('experiment')
    expect(seed!.accessible).toBe(true)
  })

  it('includes downstream nodes at depth 1', () => {
    const graph = buildSimpleGraph()

    const smp1 = graph.nodes.find((n) => n.id === 'smp-1')
    expect(smp1).toBeDefined()
    expect(smp1!.depth).toBe(1)
    expect(smp1!.direction).toBe('downstream')
  })

  it('includes downstream nodes at depth 2', () => {
    const graph = buildSimpleGraph()

    const ds2 = graph.nodes.find((n) => n.id === 'ds-2')
    expect(ds2).toBeDefined()
    expect(ds2!.depth).toBe(2)
  })

  it('creates edges with correct relationship types', () => {
    const graph = buildSimpleGraph()

    const edge = graph.edges.find(
      (e) => e.sourceId === 'exp-1' && e.targetId === 'smp-1',
    )
    expect(edge).toBeDefined()
    expect(edge!.relationshipType).toBe('sample')
    expect(edge!.label).toBe('uses')
  })

  it('builds a graph without a seed (all records)', () => {
    const graph = buildLineageGraph(
      simpleRecords,
      simpleLinks,
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      null,
    )

    expect(graph.seedRecordId).toBeNull()
    expect(graph.nodes.length).toBe(simpleRecords.length)
  })

  it('respects maxDepth', () => {
    const graph = buildLineageGraph(
      simpleRecords,
      simpleLinks,
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
      1, // maxDepth = 1
    )

    // ds-2 is at depth 2, should not be included
    const ds2 = graph.nodes.find((n) => n.id === 'ds-2')
    expect(ds2).toBeUndefined()
  })

  it('respects maxNodes', () => {
    // Create many records to trigger truncation
    const manyRecords: RecordWire[] = [experiment]
    const manyLinks: RecordLinkWire[] = []
    for (let i = 0; i < 10; i++) {
      const rec = makeRecord(`rec-${i}`, 'sample', `SMP-${i}`, `Sample ${i}`)
      manyRecords.push(rec)
      manyLinks.push(
        makeLink(
          `link-${i}`,
          'exp-1',
          `rec-${i}`,
          'sample',
          `SMP-${i}`,
          'sample',
        ),
      )
    }

    const graph = buildLineageGraph(
      manyRecords,
      manyLinks,
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
      4,
      5, // maxNodes = 5
    )

    expect(graph.truncated).toBe(true)
    expect(graph.nodes.filter((n) => n.accessible).length).toBeLessThanOrEqual(
      5,
    )
  })
})

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

describe('detectCycles', () => {
  it('returns null for an acyclic graph', () => {
    const graph = buildSimpleGraph()
    expect(detectCycles(graph)).toBeNull()
  })

  it('detects a simple cycle', () => {
    // A → B → C → A
    const recA = makeRecord('a', 'experiment', 'A', 'A')
    const recB = makeRecord('b', 'experiment', 'B', 'B')
    const recC = makeRecord('c', 'experiment', 'C', 'C')
    const cyclicLinks = [
      makeLink('l1', 'a', 'b', 'dataset', 'B', 'dataset'),
      makeLink('l2', 'b', 'c', 'dataset', 'C', 'dataset'),
      makeLink('l3', 'c', 'a', 'dataset', 'A', 'dataset'),
    ]

    const graph = buildLineageGraph(
      [recA, recB, recC],
      cyclicLinks,
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'a',
    )

    const cycle = detectCycles(graph)
    expect(cycle).not.toBeNull()
    expect(cycle!.length).toBeGreaterThan(0)
    expect(cycle).toContain('a')
  })

  it('handles a self-referencing node', () => {
    const recA = makeRecord('a', 'experiment', 'A', 'A')
    const selfLink = makeLink('l1', 'a', 'a', 'dataset', 'A', 'dataset')

    const graph = buildLineageGraph(
      [recA],
      [selfLink],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'a',
    )

    const cycle = detectCycles(graph)
    expect(cycle).not.toBeNull()
    expect(cycle).toContain('a')
  })

  it('handles a large acyclic graph without false positives', () => {
    const records: RecordWire[] = [experiment]
    const links: RecordLinkWire[] = []
    // Create a linear chain: exp → r1 → r2 → ... → r50
    for (let i = 0; i < 50; i++) {
      const rec = makeRecord(`chain-${i}`, 'sample', `CH-${i}`, `Chain ${i}`)
      records.push(rec)
      const source = i === 0 ? 'exp-1' : `chain-${i - 1}`
      links.push(
        makeLink(
          `chain-link-${i}`,
          source,
          `chain-${i}`,
          'sample',
          `CH-${i}`,
          'sample',
        ),
      )
    }

    const graph = buildLineageGraph(
      records,
      links,
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
      10,
      200,
    )

    expect(detectCycles(graph)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Missing records
// ---------------------------------------------------------------------------

describe('missing records', () => {
  it('creates a missing node when target_record_id is null', () => {
    const linkWithMissingTarget = makeLink(
      'link-missing',
      'exp-1',
      null,
      'sample',
      'SMP-GONE',
      'sample',
    )
    const graph = buildLineageGraph(
      [experiment],
      [linkWithMissingTarget],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const missingNode = graph.nodes.find((n) => n.identifier === 'SMP-GONE')
    expect(missingNode).toBeDefined()
    expect(missingNode!.accessible).toBe(false)
    expect(missingNode!.status).toBe('missing')
    expect(missingNode!.title).toBe('Missing record')
    expect(missingNode!.recordId).toBeNull()
  })

  it('creates a restricted node when target record is not in the fetched set', () => {
    // Link to a record that exists but was not fetched (permission-restricted)
    const linkToRestricted = makeLink(
      'link-restricted',
      'exp-1',
      'restricted-rec',
      'sample',
      'SMP-RESTRICTED',
      'sample',
    )
    const graph = buildLineageGraph(
      [experiment], // only the experiment is fetched, not the target
      [linkToRestricted],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const restrictedNode = graph.nodes.find(
      (n) => n.id === 'restricted:restricted-rec',
    )
    expect(restrictedNode).toBeDefined()
    expect(restrictedNode!.accessible).toBe(false)
    expect(restrictedNode!.identifier).toBe('SMP-RESTRICTED')
  })

  it('preserves edges to missing and restricted nodes', () => {
    const links = [
      makeLink('link-missing', 'exp-1', null, 'sample', 'SMP-GONE', 'sample'),
      makeLink(
        'link-restricted',
        'exp-1',
        'restricted-rec',
        'sample',
        'SMP-REST',
        'sample',
      ),
    ]
    const graph = buildLineageGraph(
      [experiment],
      links,
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const missingEdge = graph.edges.find(
      (e) => e.targetIdentifier === 'SMP-GONE',
    )
    expect(missingEdge).toBeDefined()

    const restrictedEdge = graph.edges.find(
      (e) => e.targetIdentifier === 'SMP-REST',
    )
    expect(restrictedEdge).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Restricted nodes / permission boundaries
// ---------------------------------------------------------------------------

describe('permission boundaries', () => {
  it('does not include records absent from the fetched set', () => {
    // Only fetch experiment, not the samples
    const graph = buildLineageGraph(
      [experiment],
      simpleLinks,
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    // Samples are not in the record set, so they become restricted nodes
    const smp1 = graph.nodes.find((n) => n.id === 'smp-1')
    expect(smp1).toBeUndefined() // not as an accessible node

    const restrictedSmp1 = graph.nodes.find((n) => n.id === 'restricted:smp-1')
    expect(restrictedSmp1).toBeDefined()
    expect(restrictedSmp1!.accessible).toBe(false)
  })

  it('filters out restricted nodes when showExternal is false', () => {
    const graph = buildLineageGraph(
      [experiment],
      [
        makeLink(
          'link-r',
          'exp-1',
          'restricted-rec',
          'sample',
          'SMP-REST',
          'sample',
        ),
      ],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const filtered = filterLineageGraph(graph, {
      ...DEFAULT_FILTERS,
      showExternal: false,
    })

    const restrictedNode = filtered.nodes.find((n) => !n.accessible)
    expect(restrictedNode).toBeUndefined()
  })

  it('keeps restricted nodes when showExternal is true', () => {
    const graph = buildLineageGraph(
      [experiment],
      [
        makeLink(
          'link-r',
          'exp-1',
          'restricted-rec',
          'sample',
          'SMP-REST',
          'sample',
        ),
      ],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const filtered = filterLineageGraph(graph, {
      ...DEFAULT_FILTERS,
      showExternal: true,
    })

    const restrictedNode = filtered.nodes.find((n) => !n.accessible)
    expect(restrictedNode).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Large neighbourhoods
// ---------------------------------------------------------------------------

describe('large neighbourhoods', () => {
  it('limits nodes to maxNodes', () => {
    const records: RecordWire[] = [experiment]
    const links: RecordLinkWire[] = []
    for (let i = 0; i < 100; i++) {
      const rec = makeRecord(
        `big-${i}`,
        'sample',
        `SMP-BIG-${i}`,
        `Big Sample ${i}`,
      )
      records.push(rec)
      links.push(
        makeLink(
          `big-link-${i}`,
          'exp-1',
          `big-${i}`,
          'sample',
          `SMP-BIG-${i}`,
          'sample',
        ),
      )
    }

    const graph = buildLineageGraph(
      records,
      links,
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
      4,
      20, // maxNodes = 20
    )

    expect(graph.truncated).toBe(true)
    // Accessible nodes (not counting restricted/missing) should be <= 20
    const accessibleCount = graph.nodes.filter((n) => n.accessible).length
    expect(accessibleCount).toBeLessThanOrEqual(20)
  })

  it('handles a wide graph without crashing', () => {
    const records: RecordWire[] = [experiment]
    const links: RecordLinkWire[] = []
    // 200 nodes all connected to the seed
    for (let i = 0; i < 200; i++) {
      const rec = makeRecord(`wide-${i}`, 'sample', `SMP-W-${i}`, `Wide ${i}`)
      records.push(rec)
      links.push(
        makeLink(
          `wide-link-${i}`,
          'exp-1',
          `wide-${i}`,
          'sample',
          `SMP-W-${i}`,
          'sample',
        ),
      )
    }

    const graph = buildLineageGraph(
      records,
      links,
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
      4,
      50, // maxNodes = 50 to trigger truncation
    )

    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.truncated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe('filterLineageGraph', () => {
  it('filters by entity type', () => {
    const graph = buildSimpleGraph()

    const filtered = filterLineageGraph(graph, {
      ...DEFAULT_FILTERS,
      entityTypes: ['sample'],
    })

    // Seed is always kept, plus sample nodes
    const types = new Set(filtered.nodes.map((n) => n.entityType))
    expect(types.has('experiment')).toBe(true) // seed
    expect(types.has('sample')).toBe(true)
    expect(types.has('dataset')).toBe(false)
  })

  it('filters by relationship type', () => {
    const graph = buildSimpleGraph()

    const filtered = filterLineageGraph(graph, {
      ...DEFAULT_FILTERS,
      relationshipTypes: ['sample'],
    })

    // Only sample edges remain
    const relTypes = new Set(filtered.edges.map((e) => e.relationshipType))
    expect(relTypes.has('sample')).toBe(true)
    expect(relTypes.has('dataset')).toBe(false)
  })

  it('filters by direction (upstream only)', () => {
    // Build a graph where exp has upstream links
    const upstreamLink = makeLink(
      'up-1',
      'smp-1',
      'exp-1',
      'experiment',
      'EXP-2025-0014',
      'sample',
    )
    const graph = buildLineageGraph(
      [experiment, sample1, dataset1],
      [upstreamLink, ...simpleLinks.filter((l) => l.id !== 'link-1')],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const filtered = filterLineageGraph(graph, {
      ...DEFAULT_FILTERS,
      direction: 'upstream',
    })

    // Only upstream edges should remain
    for (const edge of filtered.edges) {
      expect(
        edge.direction === 'upstream' || edge.direction === 'bidirectional',
      ).toBe(true)
    }
  })

  it('filters by direction (downstream only)', () => {
    const graph = buildSimpleGraph()

    const filtered = filterLineageGraph(graph, {
      ...DEFAULT_FILTERS,
      direction: 'downstream',
    })

    for (const edge of filtered.edges) {
      expect(
        edge.direction === 'downstream' || edge.direction === 'bidirectional',
      ).toBe(true)
    }
  })

  it('always keeps the seed node', () => {
    const graph = buildSimpleGraph()

    const filtered = filterLineageGraph(graph, {
      ...DEFAULT_FILTERS,
      entityTypes: ['file'], // no file nodes in the graph
    })

    const seed = filtered.nodes.find((n) => n.id === 'exp-1')
    expect(seed).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Timeline building
// ---------------------------------------------------------------------------

describe('buildTimeline', () => {
  it('sorts events by created_at descending', () => {
    const events: ChangeEventWire[] = [
      {
        id: 'e1',
        workspace_id: 'ws-1',
        sequence: '1',
        entity_type: 'record',
        entity_uuid: 'exp-1',
        operation: 'create',
        record_id: 'exp-1',
        project_id: 'proj-1',
        actor_user_id: 'user-1',
        actor_credential_id: null,
        client_id: null,
        payload: {},
        created_at: '2025-07-14T09:12:00Z',
      },
      {
        id: 'e2',
        workspace_id: 'ws-1',
        sequence: '2',
        entity_type: 'record',
        entity_uuid: 'exp-1',
        operation: 'update',
        record_id: 'exp-1',
        project_id: 'proj-1',
        actor_user_id: 'user-1',
        actor_credential_id: null,
        client_id: null,
        payload: {},
        created_at: '2025-07-15T10:00:00Z',
      },
    ]

    const graph = buildLineageGraph(
      [experiment],
      [],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      events,
      'exp-1',
    )

    const timeline = buildTimeline(graph.events)
    expect(timeline).toHaveLength(2)
    expect(timeline[0].createdAt).toBe('2025-07-15T10:00:00Z')
    expect(timeline[1].createdAt).toBe('2025-07-14T09:12:00Z')
  })

  it('maps operations to readable labels', () => {
    const events: ChangeEventWire[] = [
      {
        id: 'e1',
        workspace_id: 'ws-1',
        sequence: '1',
        entity_type: 'record',
        entity_uuid: 'exp-1',
        operation: 'create',
        record_id: 'exp-1',
        project_id: null,
        actor_user_id: 'user-1',
        actor_credential_id: null,
        client_id: null,
        payload: {},
        created_at: '2025-07-14T09:12:00Z',
      },
    ]

    const graph = buildLineageGraph(
      [experiment],
      [],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      events,
      'exp-1',
    )

    const timeline = buildTimeline(graph.events)
    expect(timeline[0].operationLabel).toBe('Created')
  })
})

// ---------------------------------------------------------------------------
// Table data
// ---------------------------------------------------------------------------

describe('buildTableData', () => {
  it('produces one row per node-edge pair', () => {
    const graph = buildSimpleGraph()
    const rows = buildTableData(graph)

    expect(rows.length).toBeGreaterThan(0)
    // Each row should have an identifier and type label
    for (const row of rows) {
      expect(row.identifier).toBeTruthy()
      expect(row.entityTypeLabel).toBeTruthy()
    }
  })

  it('includes nodes with no edges as standalone rows', () => {
    const graph = buildLineageGraph(
      [experiment],
      [],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const rows = buildTableData(graph)
    expect(rows).toHaveLength(1)
    expect(rows[0].relationshipLabel).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// Inspector helpers
// ---------------------------------------------------------------------------

describe('getLineageSummary', () => {
  it('counts upstream and downstream links', () => {
    const graph = buildSimpleGraph()
    const summary = getLineageSummary(graph, 'exp-1')

    // exp-1 has 3 outgoing links (to smp-1, smp-2, ds-1) and 0 incoming
    expect(summary.downstreamCount).toBe(3)
    expect(summary.upstreamCount).toBe(0)
    expect(summary.totalLinks).toBe(3)
  })

  it('counts external links (inaccessible targets)', () => {
    const graph = buildLineageGraph(
      [experiment],
      [
        makeLink(
          'link-r',
          'exp-1',
          'restricted-rec',
          'sample',
          'SMP-REST',
          'sample',
        ),
      ],
      NO_REVIEWS,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const summary = getLineageSummary(graph, 'exp-1')
    expect(summary.externalLinks).toBe(1)
  })
})

describe('getLinkedRecordsByType', () => {
  it('groups linked records by entity type', () => {
    const graph = buildSimpleGraph()
    const groups = getLinkedRecordsByType(graph, 'exp-1')

    const sampleGroup = groups.find((g) => g.entityType === 'sample')
    expect(sampleGroup).toBeDefined()
    expect(sampleGroup!.count).toBe(2)

    // ds-1 has kind='experiment' (datasets are experiment records with
    // dataset links), so its entity type is 'experiment', not 'dataset'.
    const experimentGroup = groups.find((g) => g.entityType === 'experiment')
    expect(experimentGroup).toBeDefined()
    expect(experimentGroup!.count).toBe(1)
  })
})

describe('getTransformationHistory', () => {
  it('builds a transformation chain from dataset links', () => {
    const graph = buildSimpleGraph()
    const chain = getTransformationHistory(graph, 'exp-1')

    // exp-1 → ds-1 → ds-2 (following dataset links)
    expect(chain.length).toBeGreaterThan(1)
    expect(chain[0].id).toBe('exp-1')
    expect(chain.some((c) => c.id === 'ds-1')).toBe(true)
    expect(chain.some((c) => c.id === 'ds-2')).toBe(true)
  })

  it('returns a single entry for a node with no dataset links', () => {
    const graph = buildSimpleGraph()
    const chain = getTransformationHistory(graph, 'smp-1')

    expect(chain).toHaveLength(1)
    expect(chain[0].id).toBe('smp-1')
  })
})

// ---------------------------------------------------------------------------
// Reviews, decisions and signatures
// ---------------------------------------------------------------------------

describe('reviews, decisions and signatures', () => {
  it('adds review nodes and edges', () => {
    const reviews: ReviewSubmissionWire[] = [
      {
        id: 'rev-1',
        workspace_id: 'ws-1',
        record_id: 'exp-1',
        revision_id: 'r-1',
        state: 'submitted',
        workflow_definition_key: 'default',
        workflow_definition_version: 1,
        assigned_reviewer_user_ids: ['user-2'],
        submitted_by_user_id: 'user-1',
        submitted_at: '2025-07-14T10:00:00Z',
        created_at: '2025-07-14T10:00:00Z',
        updated_at: '2025-07-14T10:00:00Z',
      },
    ]

    const graph = buildLineageGraph(
      [experiment],
      [],
      reviews,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const reviewNode = graph.nodes.find((n) => n.id === 'review:rev-1')
    expect(reviewNode).toBeDefined()
    expect(reviewNode!.entityType).toBe('review')

    const reviewEdge = graph.edges.find(
      (e) => e.relationshipType === 'reviewed_by',
    )
    expect(reviewEdge).toBeDefined()
    expect(reviewEdge!.sourceId).toBe('exp-1')
    expect(reviewEdge!.targetId).toBe('review:rev-1')
  })

  it('adds approval nodes and edges', () => {
    const decisions: ReviewDecisionWire[] = [
      {
        id: 'dec-1',
        workspace_id: 'ws-1',
        submission_id: 'sub-1',
        revision_id: 'r-1',
        record_id: 'exp-1',
        decision: 'approve',
        note: null,
        actor_user_id: 'user-2',
        created_at: '2025-07-14T11:00:00Z',
      },
    ]

    const graph = buildLineageGraph(
      [experiment],
      [],
      NO_REVIEWS,
      decisions,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const approvalNode = graph.nodes.find((n) => n.id === 'decision:dec-1')
    expect(approvalNode).toBeDefined()
    expect(approvalNode!.entityType).toBe('approval')

    const approvalEdge = graph.edges.find(
      (e) => e.relationshipType === 'approved_by',
    )
    expect(approvalEdge).toBeDefined()
  })

  it('adds rejection nodes and edges', () => {
    const decisions: ReviewDecisionWire[] = [
      {
        id: 'dec-rej',
        workspace_id: 'ws-1',
        submission_id: 'sub-1',
        revision_id: 'r-1',
        record_id: 'exp-1',
        decision: 'reject',
        note: 'Issues found',
        actor_user_id: 'user-2',
        created_at: '2025-07-14T11:00:00Z',
      },
    ]

    const graph = buildLineageGraph(
      [experiment],
      [],
      NO_REVIEWS,
      decisions,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const rejectionNode = graph.nodes.find((n) => n.id === 'decision:dec-rej')
    expect(rejectionNode).toBeDefined()
    expect(rejectionNode!.entityType).toBe('rejection')

    const rejectionEdge = graph.edges.find(
      (e) => e.relationshipType === 'rejected_by',
    )
    expect(rejectionEdge).toBeDefined()
  })

  it('adds signature nodes and edges', () => {
    const signatures: SignatureWire[] = [
      {
        id: 'sig-1',
        workspace_id: 'ws-1',
        record_id: 'exp-1',
        revision_id: 'r-1',
        signer_user_id: 'user-2',
        signature_meaning: 'I approve this revision',
        assurance_level: 'standard',
        created_at: '2025-07-14T12:00:00Z',
      },
    ]

    const graph = buildLineageGraph(
      [experiment],
      [],
      NO_REVIEWS,
      NO_DECISIONS,
      signatures,
      NO_EVENTS,
      'exp-1',
    )

    const sigNode = graph.nodes.find((n) => n.id === 'signature:sig-1')
    expect(sigNode).toBeDefined()
    expect(sigNode!.entityType).toBe('signature')

    const sigEdge = graph.edges.find((e) => e.relationshipType === 'signed_by')
    expect(sigEdge).toBeDefined()
  })

  it('does not add review nodes for records not in the graph', () => {
    const reviews: ReviewSubmissionWire[] = [
      {
        id: 'rev-other',
        workspace_id: 'ws-1',
        record_id: 'other-rec',
        revision_id: 'r-1',
        state: 'submitted',
        workflow_definition_key: 'default',
        workflow_definition_version: 1,
        assigned_reviewer_user_ids: ['user-2'],
        submitted_by_user_id: 'user-1',
        submitted_at: '2025-07-14T10:00:00Z',
        created_at: '2025-07-14T10:00:00Z',
        updated_at: '2025-07-14T10:00:00Z',
      },
    ]

    const graph = buildLineageGraph(
      [experiment],
      [],
      reviews,
      NO_DECISIONS,
      NO_SIGNATURES,
      NO_EVENTS,
      'exp-1',
    )

    const reviewNode = graph.nodes.find((n) => n.id === 'review:rev-other')
    expect(reviewNode).toBeUndefined()
  })
})
