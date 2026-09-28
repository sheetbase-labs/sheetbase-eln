import { describe, expect, it } from 'vitest'

import {
  extractTextFromStream,
  isTextExtractableMediaType,
  TEXT_EXTRACT_MAX_BYTES,
} from '#/lib/file-text'

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('isTextExtractableMediaType', () => {
  it('accepts CSV, plain text and JSON, case-insensitively', () => {
    expect(isTextExtractableMediaType('text/csv')).toBe(true)
    expect(isTextExtractableMediaType('TEXT/PLAIN')).toBe(true)
    expect(isTextExtractableMediaType('application/json')).toBe(true)
  })

  it('rejects binary formats', () => {
    expect(isTextExtractableMediaType('application/pdf')).toBe(false)
    expect(isTextExtractableMediaType('image/png')).toBe(false)
  })
})

describe('extractTextFromStream', () => {
  it('decodes UTF-8 text and keeps newlines', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,2\n3,4\n')
    await expect(extractTextFromStream(streamOf(bytes))).resolves.toBe(
      'a,b\n1,2\n3,4\n',
    )
  })

  it('stops at the byte cap', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(100))
    const text = await extractTextFromStream(streamOf(bytes), 10)
    expect(text).toHaveLength(10)
  })

  it('replaces invalid sequences instead of throwing', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x61])
    const text = await extractTextFromStream(streamOf(bytes))
    expect(text).toContain('a')
  })

  it('defaults the cap to two megabytes', () => {
    expect(TEXT_EXTRACT_MAX_BYTES).toBe(2 * 1024 * 1024)
  })
})
