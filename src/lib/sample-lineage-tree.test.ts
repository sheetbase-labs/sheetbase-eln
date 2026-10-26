import { describe, expect, it } from 'vitest'

import {
  rowIdentifier,
  rowTitle,
  sampleLineageRows,
  sampleLineageSummary,
} from './sample-lineage-tree'
import type { LineageEdge, LineageGraph, LineageNode } from './lineage-data'

function node(
  identifier: string,
  title: string,
  direction: LineageNode['direction'],
  depth: number,
  entityType: LineageNode['entityType'] = 'sample',
): LineageNode {
  return {
    id: identifier,
    recordId: identifier,
    entityType,
    kind: entityType,
    identifier,
    title,
    status: 'available',
    depth,
    direction,
    subtype: identifier === 'SMP-1002' ? 'Cell bank' : null,
  } as LineageNode
}

function edge(source: string, target: string, relation: string): LineageEdge {
  return {
    id: `${source}>${target}`,
    sourceId: source,
    targetId: target,
    relationLabel: relation,
    label: 'uses',
  } as LineageEdge
}

const filtrates = Array.from({ length: 8 }, (_, i) =>
  node(
    `SMP-${2240 + i}`,
    ['A-50', 'A-100', 'A-150', 'B-50', 'B-100', 'B-150', 'C-50', 'C-100'][i] +
      ' filtrate',
    'downstream',
    1,
  ),
)

const graph: LineageGraph = {
  nodes: [
    node('SMP-2231', 'Harvest lot', 'seed', 0),
    node('SMP-2226', 'Production culture', 'upstream', 1),
    node('SMP-1002', 'HEK293 WCB-2', 'upstream', 2),
    ...filtrates,
    node('SMP-2248', 'C-150 filtrate', 'downstream', 1),
    node('SMP-2249', 'C-150 dilution', 'downstream', 2),
    node('SMP-2250', 'Feed retain', 'downstream', 1),
    node('EXP-0142', 'An experiment', 'upstream', 1, 'experiment'),
  ],
  edges: [
    edge('SMP-1002', 'SMP-2226', 'Expanded in EXP-0134'),
    edge('SMP-2226', 'SMP-2231', 'This sample'),
    ...filtrates.map((f) => edge('SMP-2231', f.id, 'Filtered in EXP-0142')),
    edge('SMP-2231', 'SMP-2248', 'Filtered in EXP-0142'),
    edge('SMP-2248', 'SMP-2249', 'Diluted from SMP-2248'),
    edge('SMP-2231', 'SMP-2250', 'Aliquot of this lot'),
    edge('EXP-0142', 'SMP-2231', 'defined by'),
  ],
} as unknown as LineageGraph

describe('sampleLineageRows', () => {
  const rows = sampleLineageRows(graph, 'SMP-2231')

  it('lists only samples, ancestors first, then this sample, then what came from it', () => {
    expect(rows.map(rowIdentifier)).toEqual([
      'SMP-1002',
      'SMP-2226',
      'SMP-2231',
      'SMP-2240 … 2247',
      'SMP-2248',
      'SMP-2249',
      'SMP-2250',
    ])
  })

  it('indents by generation', () => {
    expect(rows.map((r) => r.indent)).toEqual([0, 1, 2, 3, 3, 4, 3])
  })

  it('says how each row was made, and the root what it is', () => {
    expect(rows.map((r) => r.relation)).toEqual([
      'Cell bank',
      'Expanded in EXP-0134',
      'This sample',
      'Filtered in EXP-0142',
      'Filtered in EXP-0142',
      'Diluted from SMP-2248',
      'Aliquot of this lot',
    ])
  })

  it('collapses a run of siblings into one titled row', () => {
    expect(rowTitle(rows[3])).toBe('A-50 to C-100 filtrates (8)')
  })

  it('closes each level with └', () => {
    expect(rows.map((r) => r.branch)).toEqual([
      '├',
      '├',
      '└',
      '├',
      '├',
      '└',
      '└',
    ])
  })

  it('counts parent chains and derived samples', () => {
    expect(sampleLineageSummary(graph, 'SMP-2231')).toEqual({
      parentChains: 1,
      derived: 11,
    })
  })

  it('returns nothing when the sample is not in the graph', () => {
    expect(sampleLineageRows(graph, 'SMP-0000')).toEqual([])
  })
})
