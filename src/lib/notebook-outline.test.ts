import { describe, expect, it } from 'vitest'

import type { NotebookBlock } from './notebook-data'
import {
  collapsedSectionBlockIds,
  collapsedSectionNodeIndexes,
  notebookOutline,
  notebookSectionSpans,
  sectionHiddenCounts,
  sectionSpanHidesContent,
} from './notebook-outline'

let seq = 0
function richTextBlock(
  headings: Array<{ level: 2 | 3 }>,
  order: number,
  trailingParagraphs = 0,
): NotebookBlock {
  const content: Array<Record<string, unknown>> = headings.map((h) => ({
    type: 'heading',
    attrs: { level: h.level },
    content: [
      { type: 'text', text: `${h.level === 2 ? 'H2' : 'H3'} ${h.level}` },
    ],
  }))
  for (let i = 0; i < trailingParagraphs; i += 1) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `p${i}` }],
    })
  }
  seq += 1
  return {
    id: `block-${seq}`,
    recordId: 'record-1',
    type: 'rich_text',
    payload: { doc: { type: 'doc', content } },
    payloadSchemaVersion: 1,
    order,
    version: 1,
  }
}

function otherBlock(type: string, order: number): NotebookBlock {
  seq += 1
  return {
    id: `block-${seq}`,
    recordId: 'record-1',
    type,
    payload: {},
    payloadSchemaVersion: 1,
    order,
    version: 1,
  }
}

describe('notebookOutline (NOTE-02)', () => {
  it('projects H2/H3 heading nodes into a document-order outline', () => {
    const blocks = [
      richTextBlock([{ level: 2 }], 1),
      otherBlock('file', 2),
      richTextBlock([{ level: 3 }], 3),
    ]
    const outline = notebookOutline(blocks)
    expect(outline).toHaveLength(2)
    expect(outline[0].level).toBe(2)
    expect(outline[0].anchorId).toBe(`section-${blocks[0].id}-h0`)
    expect(outline[1].level).toBe(3)
    expect(outline[1].anchorId).toBe(`section-${blocks[2].id}-h0`)
  })

  it('ignores non-rich_text blocks, other node types and non-heading levels', () => {
    const blocks = [otherBlock('sheet', 1), richTextBlock([{ level: 2 }], 2, 1)]
    const outline = notebookOutline(blocks)
    expect(outline).toHaveLength(1)
    expect(outline[0].text).toBe('H2 2')
  })

  it('falls back to a positional label for empty headings', () => {
    seq = 0
    const block = richTextBlock([{ level: 2 }], 1)
    block.payload = {
      doc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 } }] },
    }
    const outline = notebookOutline([block])
    expect(outline[0].text).toBe('Heading 1')
  })
})

describe('notebookSectionSpans + collapse helpers (NOTE-02)', () => {
  it('a section owns following blocks until the next same-or-higher heading', () => {
    seq = 0
    const h2a = richTextBlock([{ level: 2 }], 1)
    const para = richTextBlock([], 2)
    const h3 = richTextBlock([{ level: 3 }], 3)
    const sub = richTextBlock([], 4)
    const h2b = richTextBlock([{ level: 2 }], 5)
    const tail = richTextBlock([], 6)
    const spans = notebookSectionSpans([h2a, para, h3, sub, h2b, tail])
    // First H2 owns everything until the second H2.
    expect(spans.get(`section-${h2a.id}-h0`)?.blockIds).toEqual([
      para.id,
      h3.id,
      sub.id,
    ])
    // H3 owns only its own trailing paragraph block.
    expect(spans.get(`section-${h3.id}-h0`)?.blockIds).toEqual([sub.id])
    // Last H2 owns the trailing block.
    expect(spans.get(`section-${h2b.id}-h0`)?.blockIds).toEqual([tail.id])
    // Sub-heading section is empty (boundary at next block): not collapsible.
    expect(spans.get(`section-${h2b.id}-h0`)?.blockIds.length).toBe(1)
  })

  it('never hides the heading block itself', () => {
    seq = 0
    const single = richTextBlock([{ level: 2 }], 1, 1)
    const spans = notebookSectionSpans([single])
    expect(spans.get(`section-${single.id}-h0`)?.blockIds).toEqual([])
    // …but it owns its own trailing content at the node level.
    expect(spans.get(`section-${single.id}-h0`)?.nodeRange).toEqual({
      blockId: single.id,
      from: 1,
      to: 2,
    })
    expect(
      collapsedSectionBlockIds(spans, new Set([`section-${single.id}-h0`])),
    ).toEqual(new Set())
    expect(sectionSpanHidesContent(spans.get(`section-${single.id}-h0`)!)).toBe(
      true,
    )
  })

  it('hides exactly the union of collapsed spans and reports counts', () => {
    seq = 0
    const h2a = richTextBlock([{ level: 2 }], 1)
    const mid = richTextBlock([], 2)
    const h2b = richTextBlock([{ level: 2 }], 3)
    const tail = richTextBlock([], 4)
    const spans = notebookSectionSpans([h2a, mid, h2b, tail])
    const anchor = `section-${h2a.id}-h0`
    const hidden = collapsedSectionBlockIds(spans, new Set([anchor]))
    expect(hidden).toEqual(new Set([mid.id]))
    expect(sectionHiddenCounts(spans, new Set([anchor]))).toEqual(
      new Map([[anchor, 1]]),
    )
  })
})

describe('NOTE-02 same-block collapse (remediation)', () => {
  function proseBlock(
    id: string,
    order: number,
    nodes: Array<Record<string, unknown>>,
  ): NotebookBlock {
    return {
      id,
      recordId: 'r1',
      type: 'rich_text',
      payload: { doc: { type: 'doc', content: nodes } },
      payloadSchemaVersion: 1,
      order,
      version: 1,
    }
  }

  function heading(level: 2 | 3, text: string) {
    return {
      type: 'heading',
      attrs: { level },
      content: [{ type: 'text', text }],
    }
  }

  function paragraph(text: string) {
    return {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    }
  }

  it('a heading followed by prose in one block collapses the prose only', () => {
    seq = 0
    const block = proseBlock('b1', 1, [
      heading(2, 'Methods'),
      paragraph('step one'),
      paragraph('step two'),
    ])
    const spans = notebookSectionSpans([block])
    const anchor = `section-b1-h0`
    // No later blocks are owned; the same-block range covers exactly the
    // two prose nodes after the heading.
    expect(spans.get(anchor)?.blockIds).toEqual([])
    expect(spans.get(anchor)?.nodeRange).toEqual({
      blockId: 'b1',
      from: 1,
      to: 3,
    })
    expect(collapsedSectionNodeIndexes(spans, new Set([anchor]))).toEqual(
      new Map([['b1', new Set([1, 2])]]),
    )
    // The heading node itself is never inside the range.
    expect(
      collapsedSectionNodeIndexes(spans, new Set([anchor]))
        .get('b1')!
        .has(0),
    ).toBe(false)
  })

  it('multiple sibling headings in one block are independently collapsible', () => {
    seq = 0
    const block = proseBlock('b1', 1, [
      heading(2, 'Intro'),
      paragraph('intro prose'),
      heading(2, 'Detail'),
      paragraph('detail prose'),
    ])
    const spans = notebookSectionSpans([block])
    // H2's same-block range ends at the next same-level heading.
    expect(spans.get(`section-b1-h0`)?.nodeRange).toEqual({
      blockId: 'b1',
      from: 1,
      to: 2,
    })
    // Second H2's range runs to the end of the block.
    expect(spans.get(`section-b1-h2`)?.nodeRange).toEqual({
      blockId: 'b1',
      from: 3,
      to: 4,
    })
    // Collapsing both yields the union; ranges are disjoint and never hide
    // a heading node.
    const both = collapsedSectionNodeIndexes(
      spans,
      new Set([`section-b1-h0`, `section-b1-h2`]),
    )
    expect(both.get('b1')).toEqual(new Set([1, 3]))
  })

  it('collapsing an H2 encompasses its nested H3 content in the same block', () => {
    seq = 0
    const block = proseBlock('b1', 1, [
      heading(2, 'Methods'),
      paragraph('methods prose'),
      heading(3, 'Detail'),
      paragraph('detail prose'),
    ])
    const spans = notebookSectionSpans([block])
    // H2's same-block range runs past the H3 to the end of the block, so
    // collapsing it hides the methods prose, the H3 heading node and the
    // detail prose (indexes 1–3; the H2 heading at 0 stays visible).
    expect(spans.get(`section-b1-h0`)?.nodeRange).toEqual({
      blockId: 'b1',
      from: 1,
      to: 4,
    })
    expect(collapsedSectionNodeIndexes(spans, new Set([`section-b1-h0`]))).toEqual(
      new Map([['b1', new Set([1, 2, 3])]]),
    )
  })

  it('a nested H3 stays independently collapsible inside an H2 section', () => {
    seq = 0
    const block = proseBlock('b1', 1, [
      heading(2, 'Methods'),
      paragraph('methods prose'),
      heading(3, 'Detail'),
      paragraph('detail prose'),
    ])
    const spans = notebookSectionSpans([block])
    // H3's own range stops at the end of the block and covers only its own
    // prose — the H3 heading itself is never hidden by its own collapse.
    expect(spans.get(`section-b1-h2`)?.nodeRange).toEqual({
      blockId: 'b1',
      from: 3,
      to: 4,
    })
    expect(collapsedSectionNodeIndexes(spans, new Set([`section-b1-h2`]))).toEqual(
      new Map([['b1', new Set([3])]]),
    )
    // Collapsing both H2 and H3 unions to the same hidden set as the H2
    // alone — the H3 collapse adds nothing extra but stays independent.
    const both = collapsedSectionNodeIndexes(
      spans,
      new Set([`section-b1-h0`, `section-b1-h2`]),
    )
    expect(both.get('b1')).toEqual(new Set([1, 2, 3]))
  })

  it('a nested H3 does not extend an H2 section across a later H2 boundary', () => {
    seq = 0
    const block = proseBlock('b1', 1, [
      heading(2, 'Methods'),
      paragraph('methods prose'),
      heading(3, 'Detail'),
      paragraph('detail prose'),
      heading(2, 'Results'),
      paragraph('results prose'),
    ])
    const spans = notebookSectionSpans([block])
    // First H2's range ends at the next H2, hiding everything in between.
    expect(spans.get(`section-b1-h0`)?.nodeRange).toEqual({
      blockId: 'b1',
      from: 1,
      to: 4,
    })
    expect(spans.get(`section-b1-h2`)?.nodeRange).toEqual({
      blockId: 'b1',
      from: 3,
      to: 4,
    })
    expect(spans.get(`section-b1-h4`)?.nodeRange).toEqual({
      blockId: 'b1',
      from: 5,
      to: 6,
    })
    expect(collapsedSectionNodeIndexes(spans, new Set([`section-b1-h0`]))).toEqual(
      new Map([['b1', new Set([1, 2, 3])]]),
    )
  })

  it('a section closed by a heading in a later block still owns the rest of its own block', () => {
    seq = 0
    const block = proseBlock('b1', 1, [
      heading(2, 'Methods'),
      paragraph('same-block prose'),
    ])
    const mid = proseBlock('b2', 2, [paragraph('whole-block body')])
    const next = proseBlock('b3', 3, [heading(2, 'Results')])
    const spans = notebookSectionSpans([block, mid, next])
    const anchor = `section-b1-h0`
    expect(spans.get(anchor)?.nodeRange).toEqual({
      blockId: 'b1',
      from: 1,
      to: 2,
    })
    expect(spans.get(anchor)?.blockIds).toEqual([mid.id])
  })

  it('a heading with no own content stays uncollapsible', () => {
    seq = 0
    const block = proseBlock('b1', 1, [heading(2, 'Only')])
    const spans = notebookSectionSpans([block])
    const span = spans.get(`section-b1-h0`)!
    expect(span.blockIds).toEqual([])
    expect(span.nodeRange).toBeUndefined()
    expect(sectionSpanHidesContent(span)).toBe(false)
  })

  it('collapse unions across sections never overlap on the same block nodes', () => {
    seq = 0
    // Three sibling headings each followed by one prose node in one block.
    const block = proseBlock('b1', 1, [
      heading(2, 'A'),
      paragraph('a'),
      heading(2, 'B'),
      paragraph('b'),
      heading(2, 'C'),
      paragraph('c'),
    ])
    const spans = notebookSectionSpans([block])
    const hidden = collapsedSectionNodeIndexes(
      spans,
      new Set([`section-b1-h0`, `section-b1-h2`, `section-b1-h4`]),
    )
    expect(hidden.get('b1')).toEqual(new Set([1, 3, 5]))
  })
})

describe('NOTE-02 review fixes', () => {
  it('multiple headings in one block never produce overlapping spans', () => {
    seq = 0
    // One rich_text block containing H2a and H2b back to back.
    const block = richTextBlock([{ level: 2 }, { level: 2 }], 1)
    const body = richTextBlock([], 2)
    const spans = notebookSectionSpans([block, body])
    // First heading is superseded by the second in the same block: empty
    // block span (its in-block range is also empty — no nodes between them).
    expect(spans.get(`section-${block.id}-h0`)).toEqual({
      blockIds: [],
    })
    // Second heading owns the following block.
    expect(spans.get(`section-${block.id}-h1`)?.blockIds).toEqual([body.id])
  })

  it('a heading mid-block leaves the block in the prior section, but the boundary heading is not hidden by its own span', () => {
    seq = 0
    const h2a = richTextBlock([{ level: 2 }], 1)
    // Block with a paragraph then an H2: belongs to the prior section.
    const boundary = {
      ...richTextBlock([{ level: 2 }], 2),
      payload: {
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'lead' }] },
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'H2 2' }],
            },
          ],
        },
      },
    } as NotebookBlock
    const tail = richTextBlock([], 3)
    const spans = notebookSectionSpans([h2a, boundary, tail])
    // Block-granular: the boundary block (lead paragraph + heading) belongs
    // to the NEW section — the prior section's span ends before it.
    expect(spans.get(`section-${h2a.id}-h0`)).toEqual({ blockIds: [] })
    // New section's anchor is h1 (heading ordinal inside the payload).
    expect(spans.get(`section-${boundary.id}-h1`)?.blockIds).toEqual([tail.id])
  })
})
