/**
 * Searchable text from the pre-2007 Office binary formats: .xls (BIFF8) and
 * .doc (via `word-extractor`). Both live in an OLE2 compound file, which this
 * module reads directly so no spreadsheet engine has to be pulled in just to
 * index a workbook.
 *
 * Nothing here executes content: macros, embedded objects and formulas are
 * never evaluated. A cell contributes its stored text or its last calculated
 * value. Anything malformed or unsupported yields '' (or throws a plain Error
 * the upload path logs), never a partial guess.
 */

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const END_OF_CHAIN = 0xfffffffe
const FREE_SECTOR = 0xffffffff

/** A directory with this many entries is not a spreadsheet. */
const MAX_DIRECTORY_ENTRIES = 10_000
const MAX_SECTORS = 1 << 20

export function isCompoundFile(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 512 && CFB_SIGNATURE.every((byte, i) => bytes[i] === byte)
  )
}

interface DirectoryEntry {
  name: string
  type: number
  start: number
  size: number
}

/** The named streams of an OLE2 compound file, read in full. */
export function readCompoundFile(bytes: Uint8Array): Map<string, Uint8Array> {
  if (!isCompoundFile(bytes)) throw new Error('not an OLE2 compound file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sectorShift = view.getUint16(30, true)
  const miniShift = view.getUint16(32, true)

  if (sectorShift !== 9 && sectorShift !== 12) {
    throw new Error('unsupported compound file sector size')
  }

  const sectorSize = 1 << sectorShift
  const miniSize = 1 << miniShift
  const sectorCount = Math.floor((bytes.length - 512) / sectorSize)

  if (sectorCount > MAX_SECTORS) throw new Error('compound file is too large')
  const sectorOffset = (sector: number) => (sector + 1) * sectorSize

  const readSector = (sector: number): Uint8Array => {
    const start = sectorOffset(sector)

    if (sector < 0 || start + sectorSize > bytes.length + sectorSize) {
      throw new Error('compound file sector is out of range')
    }

    return bytes.subarray(start, Math.min(start + sectorSize, bytes.length))
  }

  // The FAT: the header lists the first 109 FAT sectors, DIFAT sectors list the rest.
  const fatSectors: number[] = []

  for (let i = 0; i < 109; i++) {
    const sector = view.getUint32(76 + i * 4, true)

    if (sector !== FREE_SECTOR && sector !== END_OF_CHAIN) {
      fatSectors.push(sector)
    }
  }

  let difat = view.getUint32(68, true)
  const difatCount = view.getUint32(72, true)

  for (let n = 0; n < difatCount && difat < END_OF_CHAIN; n++) {
    const sector = readSector(difat)
    const dv = new DataView(sector.buffer, sector.byteOffset, sector.length)
    const perSector = sectorSize / 4 - 1

    for (let i = 0; i < perSector; i++) {
      const value = dv.getUint32(i * 4, true)

      if (value !== FREE_SECTOR && value !== END_OF_CHAIN) {
        fatSectors.push(value)
      }
    }

    difat = dv.getUint32(perSector * 4, true)
  }

  const fat: number[] = []

  for (const fatSector of fatSectors) {
    const sector = readSector(fatSector)
    const dv = new DataView(sector.buffer, sector.byteOffset, sector.length)

    for (let i = 0; i + 4 <= sector.length; i += 4) {
      fat.push(dv.getUint32(i, true))
    }
  }

  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = []
    let sector = start

    while (sector < END_OF_CHAIN) {
      if (out.length > MAX_SECTORS || sector >= table.length) {
        throw new Error('compound file chain is malformed')
      }

      out.push(sector)
      sector = table[sector]
    }

    return out
  }

  const joinSectors = (sectors: number[], size?: number): Uint8Array => {
    const total = sectors.length * sectorSize
    const out = new Uint8Array(total)
    sectors.forEach((sector, i) => out.set(readSector(sector), i * sectorSize))

    return size === undefined ? out : out.subarray(0, Math.min(size, total))
  }

  // Directory.
  const directoryStart = view.getUint32(48, true)
  const directoryBytes = joinSectors(chain(directoryStart, fat))

  const dir = new DataView(
    directoryBytes.buffer,
    directoryBytes.byteOffset,
    directoryBytes.length,
  )

  const entries: DirectoryEntry[] = []

  const entryCount = Math.min(
    directoryBytes.length / 128,
    MAX_DIRECTORY_ENTRIES,
  )

  for (let i = 0; i < entryCount; i++) {
    const base = i * 128
    const nameLength = dir.getUint16(base + 64, true)
    let name = ''

    for (let c = 0; c + 2 <= Math.max(0, nameLength - 2); c += 2) {
      name += String.fromCharCode(dir.getUint16(base + c, true))
    }

    entries.push({
      name,
      type: directoryBytes[base + 66],
      start: dir.getUint32(base + 116, true),
      size: dir.getUint32(base + 120, true),
    })
  }

  // The mini stream holds streams under 4096 bytes.
  const root = entries[0]
  const miniCutoff = view.getUint32(56, true)
  let miniStream: Uint8Array | null = null
  let miniFat: number[] = []

  const loadMini = (): Uint8Array => {
    if (miniStream) return miniStream
    miniStream =
      entries.length > 0
        ? joinSectors(chain(root.start, fat), root.size)
        : new Uint8Array()
    const miniFatStart = view.getUint32(60, true)

    const bytesOfMiniFat = joinSectors(
      miniFatStart < END_OF_CHAIN ? chain(miniFatStart, fat) : [],
    )

    const mv = new DataView(
      bytesOfMiniFat.buffer,
      bytesOfMiniFat.byteOffset,
      bytesOfMiniFat.length,
    )

    miniFat = []

    for (let i = 0; i + 4 <= bytesOfMiniFat.length; i += 4) {
      miniFat.push(mv.getUint32(i, true))
    }

    return miniStream
  }

  const streams = new Map<string, Uint8Array>()

  for (const entry of entries) {
    if (entry.type !== 2 || !entry.name) continue

    if (entry.size < miniCutoff) {
      const mini = loadMini()
      const out = new Uint8Array(entry.size)
      let written = 0

      for (const sector of chain(entry.start, miniFat)) {
        const from = sector * miniSize

        const piece = mini.subarray(from, from + miniSize)

        out.set(
          piece.subarray(0, Math.min(piece.length, entry.size - written)),
          written,
        )
        written += Math.min(piece.length, entry.size - written)

        if (written >= entry.size) break
      }

      streams.set(entry.name, out)
    } else {
      streams.set(entry.name, joinSectors(chain(entry.start, fat), entry.size))
    }
  }

  return streams
}

// ---------------------------------------------------------------------------
// BIFF8 workbook
// ---------------------------------------------------------------------------

const REC_BOF = 0x0809
const REC_EOF = 0x000a
const REC_BOUNDSHEET = 0x0085
const REC_SST = 0x00fc
const REC_CONTINUE = 0x003c
const REC_LABELSST = 0x00fd
const REC_LABEL = 0x0204
const REC_NUMBER = 0x0203
const REC_RK = 0x027e
const REC_MULRK = 0x00bd
const REC_FORMULA = 0x0006
const REC_STRING = 0x0207
const REC_BOOLERR = 0x0205

interface Record {
  id: number
  data: Uint8Array
}

function* records(stream: Uint8Array): Generator<Record> {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.length)
  let pos = 0

  while (pos + 4 <= stream.length) {
    const id = view.getUint16(pos, true)
    const length = view.getUint16(pos + 2, true)
    const start = pos + 4

    if (start + length > stream.length) return
    yield { id, data: stream.subarray(start, start + length) }
    pos = start + length
  }
}

/** Reads strings that may continue into CONTINUE records. */
class ChunkReader {
  private chunk = 0
  private offset = 0
  constructor(private readonly chunks: Uint8Array[]) {}

  get done(): boolean {
    return this.chunk >= this.chunks.length
  }

  private advance() {
    while (
      this.chunk < this.chunks.length &&
      this.offset >= this.chunks[this.chunk].length
    ) {
      this.chunk++
      this.offset = 0
    }
  }

  u8(): number {
    this.advance()

    if (this.done) throw new Error('unexpected end of shared strings')

    return this.chunks[this.chunk][this.offset++]
  }

  u16(): number {
    return this.u8() | (this.u8() << 8)
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0
  }

  skip(count: number) {
    let left = count

    while (left > 0) {
      this.advance()

      if (this.done) return
      const take = Math.min(left, this.chunks[this.chunk].length - this.offset)
      this.offset += take
      left -= take
    }
  }

  /** Characters of a string; a continued string restarts with a width flag. */
  chars(count: number, wide: boolean): string {
    let out = ''
    let remaining = count
    let isWide = wide

    while (remaining > 0) {
      const atEnd = this.offset >= this.chunks[this.chunk]?.length

      if (atEnd) {
        this.advance()

        if (this.done) throw new Error('unexpected end of shared strings')
        // A new record carrying the rest of a string starts with its width flag.
        isWide = (this.chunks[this.chunk][this.offset++] & 1) === 1
        continue
      }

      const chunk = this.chunks[this.chunk]
      const unit = isWide ? 2 : 1
      const available = Math.floor((chunk.length - this.offset) / unit)
      const take = Math.min(available, remaining)

      if (take === 0) {
        // Half a wide character at a boundary: treat as end of this chunk.
        this.offset = chunk.length
        continue
      }

      for (let i = 0; i < take; i++) {
        if (isWide) {
          out += String.fromCharCode(
            chunk[this.offset] | (chunk[this.offset + 1] << 8),
          )
          this.offset += 2
        } else {
          out += String.fromCharCode(chunk[this.offset++])
        }
      }

      remaining -= take
    }

    return out
  }
}

function parseSharedStrings(chunks: Uint8Array[]): string[] {
  const reader = new ChunkReader(chunks)
  reader.u32() // total references
  const unique = reader.u32()
  const strings: string[] = []

  for (let i = 0; i < unique && !reader.done; i++) {
    try {
      const length = reader.u16()
      const flags = reader.u8()
      const wide = (flags & 1) === 1
      const richRuns = flags & 8 ? reader.u16() : 0
      const extSize = flags & 4 ? reader.u32() : 0
      strings.push(reader.chars(length, wide))
      reader.skip(richRuns * 4 + extSize)
    } catch {
      break
    }
  }

  return strings
}

function decodeRk(raw: number): number {
  const isInteger = (raw & 2) !== 0
  const div100 = (raw & 1) !== 0
  let value: number

  if (isInteger) {
    value = raw >> 2
  } else {
    const buffer = new DataView(new ArrayBuffer(8))
    buffer.setUint32(4, (raw & 0xfffffffc) >>> 0, true)
    value = buffer.getFloat64(0, true)
  }

  return div100 ? value / 100 : value
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ''

  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toPrecision(12)))
}

function ansiString(
  data: Uint8Array,
  from: number,
  length: number,
  wide: boolean,
) {
  let out = ''

  for (let i = 0; i < length; i++) {
    out += wide
      ? String.fromCharCode(data[from + i * 2] | (data[from + i * 2 + 1] << 8))
      : String.fromCharCode(data[from + i])
  }

  return out
}

/**
 * Text of a legacy .xls workbook: sheet names, then each sheet's cells, one row
 * per line. Numbers are the stored values; formulas contribute their last
 * calculated result. Only BIFF8 (Excel 97-2003) is read.
 */
export function extractXlsText(bytes: Uint8Array): string {
  if (!isCompoundFile(bytes)) return ''
  const streams = readCompoundFile(bytes)
  const book = streams.get('Workbook') ?? streams.get('Book')

  if (!book) return ''

  // Gather records, joining SST with its CONTINUE records.
  const sheetNames: string[] = []
  const sheets: Array<Map<number, string[]>> = []
  let shared: string[] = []
  let sstChunks: Uint8Array[] | null = null
  let current: Map<number, string[]> | null = null
  let sheetIndex = -1
  let pendingFormulaCell: { row: number } | null = null
  let biff8 = true

  const put = (row: number, text: string) => {
    if (!current || text === '') return
    const cells = current.get(row) ?? []
    cells.push(text)
    current.set(row, cells)
  }

  for (const { id, data } of records(book)) {
    if (sstChunks && id === REC_CONTINUE) {
      sstChunks.push(data)
      continue
    }

    if (sstChunks) {
      shared = parseSharedStrings(sstChunks)
      sstChunks = null
    }

    const view = new DataView(data.buffer, data.byteOffset, data.length)

    switch (id) {
      case REC_BOF: {
        if (data.length >= 4) {
          const version = view.getUint16(0, true)
          const kind = view.getUint16(2, true)

          if (version !== 0x0600) biff8 = false

          if (kind === 0x0010) {
            // Worksheet substream: the n-th BOF of this kind follows BOUNDSHEET order.
            sheetIndex++
            current = new Map()
            sheets[sheetIndex] = current
          } else {
            current = null
          }
        }

        break
      }

      case REC_EOF:
        pendingFormulaCell = null
        break
      case REC_BOUNDSHEET: {
        if (data.length < 8) break
        const length = data[6]
        const wide = (data[7] & 1) === 1
        sheetNames.push(ansiString(data, 8, length, wide))
        break
      }

      case REC_SST:
        sstChunks = [data]
        break
      case REC_LABELSST:
        if (data.length >= 10) {
          put(view.getUint16(0, true), shared[view.getUint32(6, true)] ?? '')
        }

        break
      case REC_LABEL:
        if (data.length >= 8) {
          const length = view.getUint16(6, true)
          const wide = (data[8] & 1) === 1
          put(view.getUint16(0, true), ansiString(data, 9, length, wide))
        }

        break
      case REC_NUMBER:
        if (data.length >= 14) {
          put(view.getUint16(0, true), formatNumber(view.getFloat64(6, true)))
        }

        break
      case REC_RK:
        if (data.length >= 10) {
          put(
            view.getUint16(0, true),
            formatNumber(decodeRk(view.getUint32(6, true))),
          )
        }

        break
      case REC_MULRK: {
        if (data.length < 6) break
        const row = view.getUint16(0, true)

        for (let at = 4; at + 6 <= data.length - 2; at += 6) {
          put(row, formatNumber(decodeRk(view.getUint32(at + 2, true))))
        }

        break
      }

      case REC_BOOLERR:
        if (data.length >= 8 && data[7] === 0) {
          put(view.getUint16(0, true), data[6] ? 'TRUE' : 'FALSE')
        }

        break
      case REC_FORMULA: {
        if (data.length < 14) break
        const row = view.getUint16(0, true)

        // A string result is flagged 0xFFFF in the last two bytes of the 8 and
        // arrives in the STRING record that follows.
        if (view.getUint16(12, true) === 0xffff && data[6] === 0) {
          pendingFormulaCell = { row }
        } else if (view.getUint16(12, true) !== 0xffff) {
          put(row, formatNumber(view.getFloat64(6, true)))
        }

        break
      }

      case REC_STRING:
        if (pendingFormulaCell && data.length >= 3) {
          const length = view.getUint16(0, true)
          const wide = (data[2] & 1) === 1
          put(pendingFormulaCell.row, ansiString(data, 3, length, wide))
        }

        pendingFormulaCell = null
        break
      default:
        break
    }
  }

  if (sstChunks) shared = parseSharedStrings(sstChunks)

  if (!biff8) return ''

  // LABELSST cells above were resolved against `shared` at the time they were
  // read; the SST precedes every worksheet in a BIFF8 file, so that holds.
  const lines: string[] = []
  const names = sheetNames.filter((name) => name.trim() !== '')

  if (names.length) lines.push(names.join('\n'))

  for (const sheet of sheets) {
    for (const row of [...sheet.keys()].sort((a, b) => a - b)) {
      lines.push((sheet.get(row) ?? []).join(' '))
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Word 97-2003
// ---------------------------------------------------------------------------

/** Body text of a legacy .doc (Word 97-2003), with headers, footnotes and endnotes. */
export async function extractDocText(bytes: Uint8Array): Promise<string> {
  if (!isCompoundFile(bytes)) return ''
  const { default: WordExtractor } = await import('word-extractor')
  const document = await new WordExtractor().extract(Buffer.from(bytes))

  const parts = [
    document.getBody(),
    document.getHeaders({ includeFooters: true }),
    document.getFootnotes(),
    document.getEndnotes(),
  ]

  return parts
    .join('\n')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}
