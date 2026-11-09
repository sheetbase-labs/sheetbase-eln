/**
 * A small DER reader, enough for RFC 3161 timestamp responses (PKCS#7 /
 * CMS SignedData). It reads definite-length encodings only, which is all DER
 * allows, and never trusts a length that runs past the buffer.
 */
export interface DerNode {
  tag: number
  /** Offset of the first byte of the whole element (tag). */
  start: number
  /** Offset of the first content byte. */
  contentStart: number
  /** Offset one past the last content byte. */
  end: number
}

export class DerError extends Error {}

export function readDer(buf: Uint8Array, offset = 0): DerNode {
  if (offset + 2 > buf.length) throw new DerError('truncated element')
  const tag = buf[offset]

  if ((tag & 0x1f) === 0x1f) throw new DerError('long-form tags are not used')
  let length = buf[offset + 1]
  let cursor = offset + 2

  if (length & 0x80) {
    const count = length & 0x7f

    if (count === 0 || count > 4) throw new DerError('unsupported length')

    if (cursor + count > buf.length) throw new DerError('truncated length')
    length = 0

    for (let i = 0; i < count; i++) length = length * 256 + buf[cursor + i]
    cursor += count
  }

  const end = cursor + length

  if (end > buf.length) throw new DerError('element runs past the buffer')

  return { tag, start: offset, contentStart: cursor, end }
}

export function derChildren(buf: Uint8Array, node: DerNode): DerNode[] {
  const out: DerNode[] = []
  let cursor = node.contentStart

  while (cursor < node.end) {
    const child = readDer(buf, cursor)

    if (child.end > node.end) throw new DerError('child exceeds its parent')
    out.push(child)
    cursor = child.end
  }

  return out
}

export function derContent(buf: Uint8Array, node: DerNode): Uint8Array {
  return buf.subarray(node.contentStart, node.end)
}

export function derWhole(buf: Uint8Array, node: DerNode): Uint8Array {
  return buf.subarray(node.start, node.end)
}

export function derOid(buf: Uint8Array, node: DerNode): string {
  if (node.tag !== 0x06) throw new DerError('expected an OID')
  const bytes = derContent(buf, node)

  if (bytes.length === 0) throw new DerError('empty OID')
  const parts: number[] = [Math.floor(bytes[0] / 40), bytes[0] % 40]
  let value = 0

  for (let i = 1; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f)

    if (!(bytes[i] & 0x80)) {
      parts.push(value)
      value = 0
    }
  }

  return parts.join('.')
}

export function derInteger(buf: Uint8Array, node: DerNode): bigint {
  if (node.tag !== 0x02) throw new DerError('expected an INTEGER')
  const bytes = derContent(buf, node)

  if (bytes.length === 0) throw new DerError('empty INTEGER')
  let value = 0n

  for (const byte of bytes) value = (value << 8n) | BigInt(byte)

  if (bytes[0] & 0x80) value -= 1n << BigInt(bytes.length * 8)

  return value
}

/** Encode helpers for building a TimeStampReq. */
function lengthBytes(length: number): number[] {
  if (length < 0x80) return [length]
  const out: number[] = []
  let n = length

  while (n > 0) {
    out.unshift(n & 0xff)
    n = Math.floor(n / 256)
  }

  return [0x80 | out.length, ...out]
}

export function derEncode(tag: number, content: Uint8Array): Uint8Array {
  const header = [tag, ...lengthBytes(content.length)]
  const out = new Uint8Array(header.length + content.length)
  out.set(header, 0)
  out.set(content, header.length)

  return out
}

export function derConcat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0

  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }

  return out
}

export function derEncodeOid(oid: string): Uint8Array {
  const parts = oid.split('.').map(Number)
  const bytes: number[] = [parts[0] * 40 + parts[1]]

  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f]
    let rest = Math.floor(part / 128)

    while (rest > 0) {
      chunk.unshift((rest & 0x7f) | 0x80)
      rest = Math.floor(rest / 128)
    }

    bytes.push(...chunk)
  }

  return derEncode(0x06, Uint8Array.from(bytes))
}

/** A positive INTEGER from big-endian bytes (a leading 0 is added if needed). */
export function derEncodePositiveInteger(bytes: Uint8Array): Uint8Array {
  let start = 0

  while (start < bytes.length - 1 && bytes[start] === 0) start++
  const trimmed = bytes.subarray(start)

  const content =
    trimmed[0] & 0x80 ? derConcat(Uint8Array.of(0), trimmed) : trimmed

  return derEncode(0x02, content)
}
