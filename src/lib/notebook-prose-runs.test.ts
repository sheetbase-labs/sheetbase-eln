/**
 * Prose-run rules, as behaviour rather than shape: which rows render
 * continuously, and what a Backspace at the start of a row does to the row
 * above it.
 */

import { describe, expect, it } from 'vitest'

import { joinProsePayloads, proseRunMembers } from './notebook-prose-runs'
import type { RichTextPayload } from './blocks/rich-text'

const paragraph = (
  text: string,
): RichTextPayload['doc']['content'][number] =>
  text
    ? { type: 'paragraph', content: [{ type: 'text', text }] }
    : { type: 'paragraph' }

const prose = (...texts: string[]): RichTextPayload => ({
  doc: { type: 'doc', content: texts.map(paragraph) },
})

const block = (id: string, type: string) => ({ id, type })

describe('proseRunMembers', () => {
  it('treats consecutive prose rows as one run', () => {
    const members = proseRunMembers([
      block('a', 'rich_text'),
      block('b', 'rich_text'),
      block('c', 'rich_text'),
    ])
    expect(members.a).toEqual({
      size: 3,
      indexInRun: 0,
      isFirst: true,
      isLast: false,
    })
    expect(members.b).toEqual({
      size: 3,
      indexInRun: 1,
      isFirst: false,
      isLast: false,
    })
    expect(members.c).toEqual({
      size: 3,
      indexInRun: 2,
      isFirst: false,
      isLast: true,
    })
  })

  it('leaves a lone prose row framed, because there is no seam to hide', () => {
    const members = proseRunMembers([
      block('a', 'rich_text'),
      block('b', 'sheet'),
      block('c', 'rich_text'),
    ])
    expect(members).toEqual({})
  })

  it('splits runs around a block of another kind', () => {
    const members = proseRunMembers([
      block('a', 'rich_text'),
      block('b', 'rich_text'),
      block('c', 'chart'),
      block('d', 'rich_text'),
      block('e', 'rich_text'),
    ])
    expect(members.a?.size).toBe(2)
    expect(members.b?.isLast).toBe(true)
    expect(members.d?.indexInRun).toBe(0)
    expect(members.e?.isLast).toBe(true)
    expect(members.c).toBeUndefined()
  })

  it('handles a run that reaches the end of the notebook', () => {
    const members = proseRunMembers([
      block('x', 'plate_map'),
      block('a', 'rich_text'),
      block('b', 'rich_text'),
    ])
    expect(members.b?.isLast).toBe(true)
    expect(members.x).toBeUndefined()
  })
})

describe('joinProsePayloads', () => {
  it('appends the row below to the row above, in order', () => {
    expect(
      joinProsePayloads(prose('First.'), prose('Second.', 'Third.')),
    ).toEqual(prose('First.', 'Second.', 'Third.'))
  })

  it('drops the caret’s own empty paragraph, so no blank line is left behind', () => {
    expect(joinProsePayloads(prose('Above.'), prose('', 'Below.'))).toEqual(
      prose('Above.', 'Below.'),
    )
  })

  it('returns null when the row below brings nothing with it', () => {
    // An empty row joining upward would either clear the row above or leave a
    // blank line; the caller deletes the row instead.
    expect(joinProsePayloads(prose('Above.'), prose(''))).toBeNull()
  })

  it('returns null when either payload is not valid prose', () => {
    expect(joinProsePayloads(prose('a'), { items: [] })).toBeNull()
    expect(joinProsePayloads({ items: [] }, prose('a'))).toBeNull()
    expect(
      joinProsePayloads(prose('a'), { doc: { type: 'doc', content: [] } }),
    ).toBeNull()
  })

  it('does not mutate either input', () => {
    const above = prose('One.')
    const below = prose('Two.')
    joinProsePayloads(above, below)
    expect(above.doc.content).toHaveLength(1)
    expect(below.doc.content).toHaveLength(1)
  })
})
