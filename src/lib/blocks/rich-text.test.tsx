import { describe, expect, it } from 'vitest'

import {
  EMPTY_RICH_TEXT_PAYLOAD,
  isEmptyRichText,
  isRichTextPayload,
  richTextToPlainText,
} from './rich-text-data'

describe('rich-text native boundary compatibility', () => {
  it.each([undefined, null, false, true, 0, NaN, Infinity, '', 'text', 1n])(
    'rejects primitive payload %s without decoding it',
    (value) => {
      expect(isRichTextPayload(value)).toBe(false)
      expect(isEmptyRichText(value)).toBe(false)
    },
  )

  it('keeps the original document, arrays and nodes by identity', () => {
    const paragraph = { type: 'paragraph' }
    const content = [paragraph]
    const doc = { type: 'doc', content }
    const payload = { doc }

    expect(isRichTextPayload(payload)).toBe(true)
    expect(payload.doc).toBe(doc)
    expect(payload.doc.content).toBe(content)
    expect(payload.doc.content[0]).toBe(paragraph)
    expect(isEmptyRichText(EMPTY_RICH_TEXT_PAYLOAD)).toBe(true)
  })

  it('accepts inherited values and ignores nonenumerable and symbol extras', () => {
    const paragraph = Object.create({ type: 'paragraph' })
    const doc = Object.create({ type: 'doc', content: [paragraph] })
    const payload = Object.create({ doc })
    Object.defineProperty(payload, 'hidden', { value: true })
    Object.defineProperty(payload, Symbol('extra'), { value: true })

    expect(isRichTextPayload(payload)).toBe(true)
    expect(isEmptyRichText(payload)).toBe(true)
  })

  it('rejects enumerable extra keys without reading later accessors', () => {
    const failure = new Error('must not read doc')

    const payload = {
      extra: true,
      get doc() {
        throw failure
      },
    }

    expect(isRichTextPayload(payload)).toBe(false)
  })

  it('preserves repeated document/content accessor reads and their order', () => {
    const reads: string[] = []

    const doc = {
      type: 'doc',
      get content() {
        reads.push('content')

        return [{ type: 'paragraph' }]
      },
    }

    const payload = {
      get doc() {
        reads.push('doc')

        return doc
      },
    }

    expect(isRichTextPayload(payload)).toBe(true)
    expect(reads).toEqual(['doc', 'doc', 'content', 'content', 'content'])
  })

  it('preserves empty checks on a different second document read', () => {
    let reads = 0

    const payload = {
      get doc() {
        reads += 1

        return reads === 1 ? {} : 'boxed native primitive'
      },
    }

    expect(isEmptyRichText(payload)).toBe(true)
    expect(reads).toBe(2)
  })

  it('propagates the exact accessor exception', () => {
    const failure = new Error('native getter failure')

    const payload = {
      get doc() {
        throw failure
      },
    }

    expect(() => isRichTextPayload(payload)).toThrow(failure)
    expect(() => isEmptyRichText(payload)).toThrow(failure)
  })

  it('keeps native null-property throws after the first document check', () => {
    let reads = 0

    const payload = {
      get doc() {
        reads += 1

        return reads === 1 ? {} : null
      },
    }

    expect(() => isEmptyRichText(payload)).toThrow(TypeError)
  })

  it('keeps sparse-array every semantics at each accepted level', () => {
    const holes: never[] = []
    holes.length = 1

    expect(isRichTextPayload({ doc: { type: 'doc', content: holes } })).toBe(
      true,
    )
    expect(isEmptyRichText({ doc: { content: holes } })).toBe(true)
    expect(
      isRichTextPayload({
        doc: {
          type: 'doc',
          content: [{ type: 'bulletList', content: holes }],
        },
      }),
    ).toBe(true)
    expect(
      isRichTextPayload({
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'x', marks: holes }],
            },
          ],
        },
      }),
    ).toBe(true)
  })

  it.each([1, 2, Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE])(
    'accepts the original Number.isInteger start range: %s',
    (start) => {
      expect(
        isRichTextPayload({
          doc: {
            type: 'doc',
            content: [
              {
                type: 'orderedList',
                attrs: { start },
                content: [
                  { type: 'listItem', content: [{ type: 'paragraph' }] },
                ],
              },
            ],
          },
        }),
      ).toBe(true)
    },
  )

  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, '1', 1n, null])(
    'rejects the original noninteger start: %s',
    (start) => {
      expect(
        isRichTextPayload({
          doc: {
            type: 'doc',
            content: [
              {
                type: 'orderedList',
                attrs: { start },
                content: [
                  { type: 'listItem', content: [{ type: 'paragraph' }] },
                ],
              },
            ],
          },
        }),
      ).toBe(false)
    },
  )

  it('coerces the third start read natively without rechecking its type', () => {
    const reads: string[] = []
    let starts = 0

    const attrs = {
      get start() {
        starts += 1
        reads.push(`start:${starts}`)

        return starts < 3
          ? 1
          : {
              [Symbol.toPrimitive](hint: string) {
                reads.push(hint)

                return 2n
              },
            }
      },
    }

    expect(
      isRichTextPayload({
        doc: {
          type: 'doc',
          content: [
            {
              type: 'orderedList',
              attrs,
              content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
            },
          ],
        },
      }),
    ).toBe(true)
    expect(reads).toEqual(['start:1', 'start:2', 'start:3', 'number'])
  })

  it('reads text twice and marks four times without decoding either', () => {
    const reads: string[] = []
    const marks = [{ type: 'bold' }]
    let texts = 0

    const text = {
      type: 'text',
      get text() {
        texts += 1
        reads.push('text')

        return texts === 1 ? 'checked string' : NaN
      },
      get marks() {
        reads.push('marks')

        return marks
      },
    }

    expect(
      isRichTextPayload({
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [text] }],
        },
      }),
    ).toBe(true)
    expect(reads).toEqual(['text', 'text', 'marks', 'marks', 'marks', 'marks'])
  })

  it('propagates an exception from native start coercion unchanged', () => {
    const failure = new Error('coercion failed')
    let starts = 0

    const attrs = {
      get start() {
        starts += 1

        return starts < 3
          ? 1
          : {
              [Symbol.toPrimitive]() {
                throw failure
              },
            }
      },
    }

    expect.assertions(2)

    try {
      isRichTextPayload({
        doc: {
          type: 'doc',
          content: [
            {
              type: 'orderedList',
              attrs,
              content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
            },
          ],
        },
      })
    } catch (error) {
      expect(error).toBe(failure)
    }

    expect(starts).toBe(3)
  })

  it('retains raw plain-text traversal and trimming', () => {
    expect(
      richTextToPlainText({
        doc: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [] },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: ' native text ' }],
            },
          ],
        },
      }),
    ).toBe('native text')
  })
})
