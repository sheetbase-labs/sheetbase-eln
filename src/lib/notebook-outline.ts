/**
 * NOTE-02 — Notebook section structure derived from the content itself.
 *
 * Headings are H2/H3 nodes inside `rich_text` block payloads (the only
 * heading model Sheetbase has). The outline is a *projection* of that
 * content, never a second ownership model: it stores no IDs of its own and
 * every entry resolves to its stable block UUID plus the heading's index
 * within the block payload.
 */
import type { NotebookBlock } from './notebook-data'

export interface NotebookOutlineEntry {
  /** Stable block UUID the heading lives in. */
  blockId: string
  order: number
  level: 2 | 3
  text: string
  /** Stable DOM anchor: `block-<blockId>-h<headingIndex>`. */
  anchorId: string
}

interface OutlineRichTextNode {
  type?: string
  attrs?: { level?: number }
  text?: string
  content?: OutlineRichTextNode[]
}

function headingText(node: OutlineRichTextNode): string {
  const parts: string[] = []
  const walk = (content: Array<OutlineRichTextNode> | undefined) => {
    for (const child of content ?? []) {
      if (typeof child.text === 'string') parts.push(child.text)
      if (Array.isArray(child.content)) walk(child.content)
    }
  }
  walk(node.content)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/**
 * Project the document's heading structure into a flat outline, in document
 * order. Only top-level H2/H3 nodes inside rich_text payloads count — the
 * same nodes the editor toolbar creates.
 */
export function notebookOutline(
  blocks: ReadonlyArray<
    Pick<NotebookBlock, 'id' | 'order' | 'type' | 'payload'>
  >,
): NotebookOutlineEntry[] {
  const entries: NotebookOutlineEntry[] = []
  for (const block of [...blocks].sort((a, b) => a.order - b.order)) {
    if (block.type !== 'rich_text') continue
    const doc = block.payload as unknown as {
      doc?: { content?: OutlineRichTextNode[] }
    }
    const docContent = doc.doc?.content
    const content = Array.isArray(docContent) ? docContent : []
    content.forEach((node, index) => {
      if (node.type !== 'heading') return
      const level = node.attrs?.level
      if (level !== 2 && level !== 3) return
      entries.push({
        blockId: block.id,
        order: block.order,
        level,
        text: headingText(node) || `Heading ${index + 1}`,
        anchorId: `section-${block.id}-h${index}`,
      })
    })
  }
  return entries
}

/**
 * A heading's ownership for collapse purposes. Two granularities:
 *
 * - `blockIds`: the whole blocks after the heading's own block, in document
 *   order, until the next heading of the same or higher level (unchanged
 *   NOTE-02 behaviour).
 * - `nodeRange`: the range of top-level nodes INSIDE the heading's own
 *   rich_text block that the section owns — from the node after the heading
 *   up to (a) the next heading of the same or higher level in the same
 *   block, or (b) the end of the block. Same-block content is hidden at the
 *   node level while later blocks stay block-granular, so a rich_text block
 *   containing `H2 + prose` can collapse its own prose and multiple headings
 *   in one block are independently collapsible. A lower-level heading does
 *   NOT bound an enclosing section's range: an H2's range encompasses the
 *   nested H3 headings and their content (collapsing the H2 hides them),
 *   while each H3 keeps its own narrower range for independent collapse.
 *   Same-block ranges may therefore nest; hidden node indexes are the union
 *   across collapsed sections.
 */
export interface NotebookSectionSpan {
  blockIds: string[]
  nodeRange?: { blockId: string; from: number; to: number }
}

interface OpenSection {
  anchorId: string
  level: 2 | 3
  startBlockId: string
  /** Block ids hidden while this section is collapsed. */
  span: string[]
  /** Top-level node count of the heading's own block payload. */
  startNodeCount: number
  /** Index of the heading node within its own block payload. */
  startNodeIndex: number
  /**
   * Index of the next heading of the same or higher level in the same
   * block, once seen. Bounds the same-block node range independently of the
   * block-granular nesting rules. A lower-level heading in the same block
   * (e.g. an H3 inside an H2 section) does NOT bound this range — its
   * content stays inside the enclosing section's same-block range.
   */
  nodeEnd: number | null
}

/**
 * For each outline entry, what it owns when collapsed: the blocks after its
 * own (block-granular) until the next heading of the same or higher level,
 * plus — since the NOTE-02 remediation — the nodes after the heading inside
 * its own rich_text block. A heading's span never hides its own block (a
 * heading may still be hidden when an *enclosing* section is collapsed —
 * nested collapse).
 */
export function notebookSectionSpans(
  blocks: ReadonlyArray<
    Pick<NotebookBlock, 'id' | 'order' | 'type' | 'payload'>
  >,
): Map<string, NotebookSectionSpan> {
  const ordered = [...blocks].sort((a, b) => a.order - b.order)
  const spans = new Map<string, NotebookSectionSpan>()
  const open: OpenSection[] = []
  const close = (section: OpenSection) => {
    if (spans.has(section.anchorId)) return
    // Same-block ownership: nodes after the heading up to the closing
    // boundary (the next heading of the same or higher level in the same
    // block) or the end of the block when no in-block boundary exists.
    // Lower-level headings in the same block stay inside the range, so an
    // H2's collapse hides its nested H3 content too.
    let nodeRange: NotebookSectionSpan['nodeRange']
    const to = section.nodeEnd ?? section.startNodeCount
    if (section.startNodeIndex + 1 < to) {
      nodeRange = {
        blockId: section.startBlockId,
        from: section.startNodeIndex + 1,
        to,
      }
    }
    spans.set(section.anchorId, {
      blockIds: section.span,
      ...(nodeRange ? { nodeRange } : {}),
    })
  }
  for (const block of ordered) {
    const headings = block.type === 'rich_text' ? blockHeadings(block) : []
    const nodeCount = blockNodeCount(block)
    // Close at this block's first boundary (same or higher level) BEFORE
    // ownership, so the boundary block belongs to the new section, not the
    // old one.
    for (const head of headings) {
      while (open.length > 0 && open[open.length - 1].level >= head.level) {
        close(open.pop()!)
      }
    }
    // Sections opened by earlier blocks own this whole block (block-granular
    // collapse). Sections started in THIS block never own it.
    for (const section of open) {
      if (section.startBlockId !== block.id) section.span.push(block.id)
    }
    for (const head of headings) {
      // A heading bounds the same-block node range of sections started in
      // this block only when its level is the same or higher — an H3 does
      // not close an H2's same-block range (the H3 content is nested inside
      // it), while any heading closes an H3's range. Those sections stay
      // open for block-granular ownership until the level rule below closes
      // them.
      for (const section of open) {
        if (
          section.startBlockId === block.id &&
          section.nodeEnd === null &&
          head.level <= section.level
        ) {
          section.nodeEnd = head.index
        }
      }
      // A second heading in the same block closes the earlier one (same
      // block, same start), so spans never overlap.
      while (open.length > 0 && open[open.length - 1].level >= head.level) {
        close(open.pop()!)
      }
      open.push({
        anchorId: head.anchorId,
        level: head.level,
        startBlockId: block.id,
        span: [],
        startNodeCount: nodeCount,
        startNodeIndex: head.index,
        nodeEnd: null,
      })
    }
  }
  for (const section of open) close(section)
  return spans
}

function blockNodeCount(block: Pick<NotebookBlock, 'payload'>): number {
  const doc = block.payload as unknown as {
    doc?: { content?: OutlineRichTextNode[] }
  }
  const content = doc.doc?.content
  return Array.isArray(content) ? content.length : 0
}

function blockHeadings(
  block: Pick<NotebookBlock, 'id' | 'payload'>,
): Array<{ anchorId: string; level: 2 | 3; index: number }> {
  const doc = block.payload as unknown as {
    doc?: { content?: OutlineRichTextNode[] }
  }
  const docContent = doc.doc?.content
  const content = Array.isArray(docContent) ? docContent : []
  const result: Array<{ anchorId: string; level: 2 | 3; index: number }> = []
  content.forEach((node, index) => {
    if (node.type !== 'heading') return
    const level = node.attrs?.level
    if (level !== 2 && level !== 3) return
    result.push({ anchorId: `section-${block.id}-h${index}`, level, index })
  })
  return result
}

/** Block ids to hide for the currently collapsed sections. */
export function collapsedSectionBlockIds(
  spans: Map<string, NotebookSectionSpan>,
  collapsedAnchors: ReadonlySet<string>,
): Set<string> {
  const hidden = new Set<string>()
  for (const anchor of collapsedAnchors) {
    for (const blockId of spans.get(anchor)?.blockIds ?? []) hidden.add(blockId)
  }
  return hidden
}

/**
 * Node indexes to hide inside a heading's own rich_text block for the
 * currently collapsed sections, keyed by block id. Same-block ranges may
 * nest (an H2's range encompasses its H3 content), so collapsed sections'
 * ranges are unioned per block. A heading node is never inside its own
 * section's range.
 */
export function collapsedSectionNodeIndexes(
  spans: Map<string, NotebookSectionSpan>,
  collapsedAnchors: ReadonlySet<string>,
): Map<string, Set<number>> {
  const hidden = new Map<string, Set<number>>()
  for (const anchor of collapsedAnchors) {
    const range = spans.get(anchor)?.nodeRange
    if (!range) continue
    const set = hidden.get(range.blockId) ?? new Set<number>()
    for (let i = range.from; i < range.to; i += 1) set.add(i)
    hidden.set(range.blockId, set)
  }
  return hidden
}

/**
 * Does the collapsed section own anything to hide — later blocks or content
 * inside its own block? Drives which outline entries get collapse controls.
 */
export function sectionSpanHidesContent(span: NotebookSectionSpan): boolean {
  return span.blockIds.length > 0 || span.nodeRange !== undefined
}

/** anchorId → number of blocks hidden by that collapsed section. */
export function sectionHiddenCounts(
  spans: Map<string, NotebookSectionSpan>,
  collapsedAnchors: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const anchor of collapsedAnchors) {
    const span = spans.get(anchor)
    if (span && span.blockIds.length > 0) {
      counts.set(anchor, span.blockIds.length)
    }
  }
  return counts
}
