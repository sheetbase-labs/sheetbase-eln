import { describe, expect, it } from 'vitest'

import type { NotebookBlock } from './notebook-data'
import {
  collapsedSectionBlockIds,
  notebookOutline,
  notebookSectionSpans,
  sectionHiddenCounts,
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
    expect(spans.get(`section-${h2a.id}-h0`)).toEqual([para.id, h3.id, sub.id])
    // H3 owns only its own trailing paragraph block.
    expect(spans.get(`section-${h3.id}-h0`)).toEqual([sub.id])
    // Last H2 owns the trailing block.
    expect(spans.get(`section-${h2b.id}-h0`)).toEqual([tail.id])
    // Sub-heading section is empty (boundary at next block): not collapsible.
    expect(spans.get(`section-${h2b.id}-h0`)!.length).toBe(1)
  })

  it('never hides the heading block itself', () => {
    seq = 0
    const single = richTextBlock([{ level: 2 }], 1, 1)
    const spans = notebookSectionSpans([single])
    expect(spans.get(`section-${single.id}-h0`)).toEqual([])
    expect(
      collapsedSectionBlockIds(spans, new Set([`section-${single.id}-h0`])),
    ).toEqual(new Set())
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

describe('NOTE-02 review fixes', () => {
  it('multiple headings in one block never produce overlapping spans', () => {
    seq = 0
    // One rich_text block containing H2a and H2b back to back.
    const block = richTextBlock([{ level: 2 }, { level: 2 }], 1)
    const body = richTextBlock([], 2)
    const spans = notebookSectionSpans([block, body])
    // First heading is superseded by the second in the same block: empty span.
    expect(spans.get(`section-${block.id}-h0`)).toEqual([])
    // Second heading owns the following block.
    expect(spans.get(`section-${block.id}-h1`)).toEqual([body.id])
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
    expect(spans.get(`section-${h2a.id}-h0`)).toEqual([])
    // New section's anchor is h1 (heading ordinal inside the payload).
    expect(spans.get(`section-${boundary.id}-h1`)).toEqual([tail.id])
  })
})
