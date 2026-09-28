/**
 * SRCH-01.3 — text extraction for uploaded files.
 *
 * Only formats whose bytes are already text are extracted here: CSV, plain
 * text and JSON. The text is stored on the file object (with its original
 * newlines) so search can name the matching line. PDF text extraction needs a
 * text-layer parser dependency and is tracked separately.
 */
export const TEXT_EXTRACT_MAX_BYTES = 2 * 1024 * 1024

const TEXT_EXTRACTABLE_MEDIA_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/json',
])

export function isTextExtractableMediaType(mediaType: string): boolean {
  return TEXT_EXTRACTABLE_MEDIA_TYPES.has(mediaType.trim().toLowerCase())
}

/**
 * Read a byte stream up to `maxBytes` and decode it as UTF-8. Bytes beyond the
 * cap are ignored rather than failing the upload. Invalid UTF-8 sequences are
 * replaced, never thrown.
 */
export async function extractTextFromStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number = TEXT_EXTRACT_MAX_BYTES,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let read = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - read
      if (remaining <= 0) break
      const slice =
        value.byteLength > remaining ? value.subarray(0, remaining) : value
      read += slice.byteLength
      text += decoder.decode(slice, { stream: true })
      if (read >= maxBytes) break
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return text
}
