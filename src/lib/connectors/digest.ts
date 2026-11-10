/** sha256 hex over UTF-8 bytes. Shared by connector request identities. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This typed input distinguishes text from bytes without rejecting foreign-realm Uint8Array values.
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : new Uint8Array(input)

  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
