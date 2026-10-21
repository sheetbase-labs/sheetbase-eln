/**
 * Minimal ZIP reader for .eln imports. Reads the central directory, supports
 * stored and deflated entries, and refuses encrypted, ZIP64 and oversize
 * archives. Entry names are returned as stored; callers must treat them as
 * untrusted (see `isSafeEntryName`).
 */
import { inflateRawSync } from 'node:zlib'

export interface ZipLimits {
  /** Maximum number of entries accepted. */
  maxEntries: number
  /** Maximum total uncompressed bytes accepted. */
  maxUncompressedBytes: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 5000,
  maxUncompressedBytes: 256 * 1024 * 1024,
}

export class ZipReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipReadError'
  }
}

/** Reject absolute paths, drive letters, backslashes and `..` traversal. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.startsWith('/') || name.includes('\\')) return false
  if (/^[A-Za-z]:/.test(name) || name.includes('\0')) return false
  return !name.split('/').some((part) => part === '..')
}

export function readZip(
  bytes: Uint8Array,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipReadError('Not a ZIP archive.')
  const count = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || centralOffset === 0xffffffff) {
    throw new ZipReadError('ZIP64 archives are not supported.')
  }
  if (count > limits.maxEntries) {
    throw new ZipReadError('The archive has too many entries.')
  }

  const entries = new Map<string, Uint8Array>()
  let position = centralOffset
  let total = 0
  for (let n = 0; n < count; n++) {
    if (
      position + 46 > bytes.length ||
      view.getUint32(position, true) !== 0x02014b50
    ) {
      throw new ZipReadError('The ZIP central directory is corrupt.')
    }
    const flags = view.getUint16(position + 8, true)
    const method = view.getUint16(position + 10, true)
    const compressedSize = view.getUint32(position + 20, true)
    const rawSize = view.getUint32(position + 24, true)
    const nameLength = view.getUint16(position + 28, true)
    const extraLength = view.getUint16(position + 30, true)
    const commentLength = view.getUint16(position + 32, true)
    const localOffset = view.getUint32(position + 42, true)
    const name = new TextDecoder().decode(
      bytes.subarray(position + 46, position + 46 + nameLength),
    )
    position += 46 + nameLength + extraLength + commentLength

    if (flags & 1)
      throw new ZipReadError('Encrypted archives are not supported.')
    if (name.endsWith('/')) continue
    if (!isSafeEntryName(name)) {
      throw new ZipReadError(`Unsafe entry name: ${name}`)
    }
    total += rawSize
    if (total > limits.maxUncompressedBytes) {
      throw new ZipReadError('The archive is too large when unpacked.')
    }
    if (
      localOffset + 30 > bytes.length ||
      view.getUint32(localOffset, true) !== 0x04034b50
    ) {
      throw new ZipReadError('The ZIP local header is corrupt.')
    }
    const dataStart =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true)
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)
    if (raw.length !== compressedSize) {
      throw new ZipReadError('The ZIP entry is truncated.')
    }
    let data: Uint8Array
    if (method === 0) data = raw
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: rawSize + 1 })
      } catch {
        throw new ZipReadError(`Could not inflate ${name}.`)
      }
    } else throw new ZipReadError(`Unsupported compression for ${name}.`)
    if (data.length !== rawSize) {
      throw new ZipReadError(`Size mismatch for ${name}.`)
    }
    entries.set(name, data)
  }
  return entries
}
