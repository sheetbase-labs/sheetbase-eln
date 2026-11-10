import { describe, expect, it } from 'vitest'

import { isRichTextPayload, richTextToPlainText } from './rich-text-data'
import { plainTextToRichText } from './plain-text'

describe('plainTextToRichText', () => {
  it('splits paragraphs, headings and lists into valid rich text', () => {
    const payload = plainTextToRichText(
      '## Aim\nTest the buffer.\nSecond line.\n\n- one\n- two\n\n1. first\n2. second',
    )

    expect(isRichTextPayload(payload)).toBe(true)
    expect(payload.doc.content.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'orderedList',
    ])
    expect(richTextToPlainText(payload)).toContain(
      'Test the buffer. Second line.',
    )
  })

  it('returns one empty paragraph for empty text', () => {
    const payload = plainTextToRichText('  \n ')
    expect(isRichTextPayload(payload)).toBe(true)
    expect(richTextToPlainText(payload)).toBe('')
  })
})
