/** sha256 hex over UTF-8 bytes. Shared by connector request identities. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const buffer =
    typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
