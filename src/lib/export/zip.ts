/**
 * Deterministic ZIP writer for export artefacts (DATA-02).
 *
 * Entries are deflated and buffered one at a time (each entry is bounded by
 * the export content itself), then written to the output stream with known
 * CRC/size fields so readers never need data descriptors. Fixed DOS
 * timestamps make byte-identical inputs produce byte-identical archives.
 */
import { deflateRawSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Fixed DOS timestamp: 1980-01-01, keeps archives byte-deterministic. */
const DOS_TIME = 0
/** DOS date word for 1980-01-01: (yearOffset << 9) | (month << 5) | day. */
const DOS_DATE = (1 << 5) | 1

interface ZipEntry {
  name: Uint8Array
  data: Uint8Array
  crc: number
}

export class ZipWriter {
  private readonly staged: ZipEntry[] = []

  /** Add an entry; text is UTF-8 encoded. Call before `stream()`. */
  add(name: string, content: string | Uint8Array): void {
    const data =
      typeof content === 'string' ? new TextEncoder().encode(content) : content
    this.staged.push({
      name: new TextEncoder().encode(name),
      data,
      crc: crc32(data),
    })
  }

  /** Read-only view of staged entries (name → uncompressed bytes). */
  entries(): Array<[string, Uint8Array]> {
    return this.staged.map((entry) => [
      new TextDecoder().decode(entry.name),
      entry.data,
    ])
  }

  /**
   * Produce the complete archive. Entry payloads are deflated eagerly
   * (bounded per-entry buffering); entries smaller deflated than stored use
   * method 8, everything else method 0.
   */
  async stream(): Promise<Uint8Array> {
    type Prepared = {
      name: Uint8Array
      compressed: Uint8Array
      rawLength: number
      crc: number
      method: number
    }
    const prepared: Prepared[] = []
    for (const entry of this.staged) {
      const compressed = deflateRawSync(entry.data)
      const useDeflate = compressed.length < entry.data.length
      prepared.push({
        name: entry.name,
        compressed: useDeflate ? compressed : entry.data,
        rawLength: entry.data.length,
        crc: entry.crc,
        method: useDeflate ? 8 : 0,
      })
    }

    const chunks: Uint8Array[] = []
    const offsets: number[] = []
    let offset = 0
    for (const p of prepared) {
      offsets.push(offset)
      const header = new Uint8Array(30 + p.name.length)
      const view = new DataView(header.buffer)
      view.setUint32(0, 0x04034b50, true)
      view.setUint16(4, 20, true)
      view.setUint16(8, p.method, true)
      view.setUint16(10, DOS_TIME, true)
      view.setUint16(12, DOS_DATE, true)
      view.setUint32(14, p.crc, true)
      view.setUint32(18, p.compressed.length, true)
      view.setUint32(22, p.rawLength, true)
      view.setUint16(26, p.name.length, true)
      header.set(p.name, 30)
      chunks.push(header, p.compressed)
      offset += header.length + p.compressed.length
    }

    const centralStart = offset
    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i]
      const central = new Uint8Array(46 + p.name.length)
      const view = new DataView(central.buffer)
      view.setUint32(0, 0x02014b50, true)
      view.setUint16(4, 20, true)
      view.setUint16(6, 20, true)
      view.setUint16(8, 0, true) // flags
      view.setUint16(10, p.method, true)
      view.setUint16(12, DOS_TIME, true)
      view.setUint16(14, DOS_DATE, true)
      view.setUint32(16, p.crc, true)
      view.setUint32(20, p.compressed.length, true)
      view.setUint32(24, p.rawLength, true)
      view.setUint16(28, p.name.length, true)
      view.setUint32(42, offsets[i], true)
      central.set(p.name, 46)
      chunks.push(central)
      offset += central.length
    }

    const end = new Uint8Array(22)
    const endView = new DataView(end.buffer)
    endView.setUint32(0, 0x06054b50, true)
    endView.setUint16(8, prepared.length, true)
    endView.setUint16(10, prepared.length, true)
    endView.setUint32(12, offset - centralStart, true)
    endView.setUint32(16, centralStart, true)
    chunks.push(end)

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const out = new Uint8Array(total)
    let position = 0
    for (const chunk of chunks) {
      out.set(chunk, position)
      position += chunk.length
    }
    return out
  }
}
