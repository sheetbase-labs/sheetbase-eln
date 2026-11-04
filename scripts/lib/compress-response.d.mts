export function dynamicEncoding(input: {
  contentType: string | null | undefined
  contentEncoding: string | null | undefined
  contentLength: string | number | null | undefined
  acceptEncoding: string | undefined
}): 'br' | 'gzip' | null
