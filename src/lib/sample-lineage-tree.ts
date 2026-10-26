import type { LineageGraph, LineageNode } from './lineage-data'

export interface SampleTreeRow {
  /** The sample, or the first sample of a collapsed run. */
  node: LineageNode
  /** What the row's parent did to make it; the root shows its own type. */
  relation: string | null
  indent: number
  /** `├` when a sibling follows at the same level, `└` for the last one. */
  branch: '├' | '└'
  /** Set when the row stands for several siblings: their count and the last one. */
  group: { count: number; last: LineageNode } | null
}

const MIN_GROUP = 3

/**
 * The design's lineage tree for a sample: only the samples in the graph, the
 * ancestors top-down, then this sample, then what was derived from it. A run
 * of three or more siblings made the same way, with nothing derived from them,
 * collapses to one row.
 */
export function sampleLineageRows(
  graph: LineageGraph,
  sampleId: string,
): SampleTreeRow[] {
  const samples = graph.nodes.filter((node) => node.entityType === 'sample')
  const seed = samples.find((node) => node.recordId === sampleId)
  if (!seed) return []

  const incoming = (node: LineageNode): string | null => {
    const edge = graph.edges.find(
      (candidate) =>
        candidate.targetId === node.id &&
        samples.some((n) => n.id === candidate.sourceId),
    )
    return edge ? edge.relationLabel : null
  }
  const byIdentifier = (a: LineageNode, b: LineageNode) =>
    a.identifier.localeCompare(b.identifier)

  const upstream = samples
    .filter((node) => node.direction === 'upstream')
    .sort((a, b) => b.depth - a.depth || byIdentifier(a, b))
  const downstream = samples
    .filter((node) => node.direction === 'downstream')
    .sort(byIdentifier)
  const seedIndent = upstream.length

  const rows: SampleTreeRow[] = [
    ...upstream.map((node, index) => ({
      node,
      relation: incoming(node) ?? node.subtype ?? null,
      indent: index,
      branch: '├' as const,
      group: null,
    })),
    {
      node: seed,
      relation: incoming(seed) ?? 'This sample',
      indent: seedIndent,
      branch: '└' as const,
      group: null,
    },
    ...downstream.map((node) => ({
      node,
      relation: incoming(node),
      indent: seedIndent + node.depth,
      branch: '├' as const,
      group: null,
    })),
  ]

  const collapsed = collapseSiblings(rows)
  // A row is the last of its level when nothing deeper-or-equal follows it
  // before the level above resumes.
  collapsed.forEach((row, index) => {
    if (row.node.direction === 'upstream') {
      row.branch = '├'
      return
    }
    if (row.node.recordId === sampleId) {
      row.branch = '└'
      return
    }
    let last = true
    for (let next = index + 1; next < collapsed.length; next++) {
      if (collapsed[next].indent < row.indent) break
      if (collapsed[next].indent === row.indent) {
        last = false
        break
      }
    }
    row.branch = last ? '└' : '├'
  })
  return collapsed
}

function collapseSiblings(rows: SampleTreeRow[]): SampleTreeRow[] {
  const out: SampleTreeRow[] = []
  for (let start = 0; start < rows.length;) {
    const row = rows[start]
    let end = start + 1
    while (
      end < rows.length &&
      rows[end].indent === row.indent &&
      rows[end].relation === row.relation &&
      rows[end].node.direction === 'downstream' &&
      row.node.direction === 'downstream' &&
      // Nothing derived from it: the next row is not deeper.
      !(rows[end + 1] && rows[end + 1].indent > row.indent)
    )
      end++
    const count = end - start
    if (count >= MIN_GROUP && row.node.direction === 'downstream') {
      out.push({ ...row, group: { count, last: rows[end - 1].node } })
    } else {
      out.push(...rows.slice(start, end))
    }
    start = end
  }
  return out
}

/** "SMP-2240 … 2247" for a collapsed run, the identifier otherwise. */
export function rowIdentifier(row: SampleTreeRow): string {
  if (!row.group) return row.node.identifier
  const last = row.group.last.identifier
  return `${row.node.identifier} … ${last.slice(last.lastIndexOf('-') + 1)}`
}

/** "A-50 to C-100 filtrates (8)" for a run of "A-50 filtrate" … "C-100 filtrate". */
export function rowTitle(row: SampleTreeRow): string {
  if (!row.group) return row.node.title
  const [firstHead, ...firstRest] = row.node.title.split(' ')
  const [lastHead, ...lastRest] = row.group.last.title.split(' ')
  const suffix = firstRest.join(' ')
  if (suffix && suffix === lastRest.join(' ')) {
    const plural = suffix.endsWith('s') ? suffix : `${suffix}s`
    return `${firstHead} to ${lastHead} ${plural} (${row.group.count})`
  }
  return `${row.node.title} to ${row.group.last.title} (${row.group.count})`
}

/** "1 parent chain · 11 derived samples": the chains above this sample (one
 * per ancestor with no parent of its own) and the samples made from it. */
export function sampleLineageSummary(
  graph: LineageGraph,
  sampleId: string,
): { parentChains: number; derived: number } | null {
  const samples = graph.nodes.filter((node) => node.entityType === 'sample')
  if (!samples.some((node) => node.recordId === sampleId)) return null
  const upstream = samples.filter((node) => node.direction === 'upstream')
  const hasParent = (node: LineageNode) =>
    graph.edges.some(
      (edge) =>
        edge.targetId === node.id &&
        upstream.some((candidate) => candidate.id === edge.sourceId),
    )
  return {
    parentChains: upstream.filter((node) => !hasParent(node)).length,
    derived: samples.filter((node) => node.direction === 'downstream').length,
  }
}
