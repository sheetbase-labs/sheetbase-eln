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

interface OpenSection {
  anchorId: string
  level: 2 | 3
  startBlockId: string
  /** Block ids hidden while this section is collapsed. */
  span: string[]
}

/**
 * For each outline entry, the blocks it owns: the blocks after its own
 * (in document order) until the next heading of the same or higher level.
 * A heading's own span never hides its own block (a heading may still be
 * hidden when an *enclosing* section is collapsed — nested collapse).
 */
export function notebookSectionSpans(
  blocks: ReadonlyArray<
    Pick<NotebookBlock, 'id' | 'order' | 'type' | 'payload'>
  >,
): Map<string, string[]> {
  const ordered = [...blocks].sort((a, b) => a.order - b.order)
  const spans = new Map<string, string[]>()
  const open: OpenSection[] = []
  const close = (section: OpenSection) => {
    if (!spans.has(section.anchorId)) spans.set(section.anchorId, section.span)
  }
  for (const block of ordered) {
    const headings = block.type === 'rich_text' ? blockHeadings(block) : []
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
      })
    }
  }
  for (const section of open) close(section)
  return spans
}

function blockHeadings(
  block: Pick<NotebookBlock, 'id' | 'payload'>,
): Array<{ anchorId: string; level: 2 | 3 }> {
  const doc = block.payload as unknown as {
    doc?: { content?: OutlineRichTextNode[] }
  }
  const docContent = doc.doc?.content
  const content = Array.isArray(docContent) ? docContent : []
  const result: Array<{ anchorId: string; level: 2 | 3 }> = []
  content.forEach((node, index) => {
    if (node.type !== 'heading') return
    const level = node.attrs?.level
    if (level !== 2 && level !== 3) return
    result.push({ anchorId: `section-${block.id}-h${index}`, level })
  })
  return result
}

/** Block ids to hide for the currently collapsed sections. */
export function collapsedSectionBlockIds(
  spans: Map<string, string[]>,
  collapsedAnchors: ReadonlySet<string>,
): Set<string> {
  const hidden = new Set<string>()
  for (const anchor of collapsedAnchors) {
    for (const blockId of spans.get(anchor) ?? []) hidden.add(blockId)
  }
  return hidden
}

/** anchorId → number of blocks hidden by that collapsed section. */
export function sectionHiddenCounts(
  spans: Map<string, string[]>,
  collapsedAnchors: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const anchor of collapsedAnchors) {
    const span = spans.get(anchor)
    if (span && span.length > 0) counts.set(anchor, span.length)
  }
  return counts
}
