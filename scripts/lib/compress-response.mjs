import { acceptsEncoding } from './accept-encoding.mjs'

/** Text the server generates per request and that shrinks well. */
const COMPRESSIBLE =
  /^(text\/(html|plain|css|csv|javascript)|application\/(json|javascript|xml|openapi\+json|problem\+json|vnd\.pgrst\.[a-z.+-]*json)|image\/svg\+xml)\b/i

/** Below this a compressed body is barely smaller and costs CPU. */
const MIN_BYTES = 1024

/**
 * Which encoding to compress a generated response with, or null to send it
 * as it is. Never compresses a live event stream (it must flush each event
 * as it happens), a response that is already encoded, or a known-small body.
 */
export function dynamicEncoding({
  contentType,
  contentEncoding,
  contentLength,
  acceptEncoding,
}) {
  if (contentEncoding) return null

  if (!contentType || !COMPRESSIBLE.test(contentType)) return null

  if (contentLength != null && Number(contentLength) < MIN_BYTES) return null

  if (acceptsEncoding(acceptEncoding, 'br')) return 'br'

  if (acceptsEncoding(acceptEncoding, 'gzip')) return 'gzip'

  return null
}
