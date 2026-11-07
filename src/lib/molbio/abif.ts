/**
 * Reader for ABIF (.ab1) Sanger sequencing files: the called bases, their
 * Phred qualities, where each base sits along the trace, and the four
 * fluorescence channels for drawing the chromatogram.
 */
export class AbifError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbifError'
  }
}

export interface Trace {
  /** Sample name as the instrument recorded it. */
  name: string
  bases: string
  /** Phred quality for each base (0 to 93). */
  quality: number[]
  /** Index into the trace arrays where each base was called. */
  peaks: number[]
  /** Channel intensities by base letter. */
  channels: Record<'A' | 'C' | 'G' | 'T', number[]>
  /** Machine, well and run details when the file carries them. */
  meta: { instrument?: string; well?: string; runDate?: string }
}

interface Entry {
  tag: string
  num: number
  type: number
  elemSize: number
  count: number
  size: number
  offset: number
  dataPos: number
}

export function isAbifFileName(name: string): boolean {
  return /\.(ab1|abi)$/i.test(name)
}

export function parseAbif(buffer: ArrayBuffer | Uint8Array): Trace {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes.length < 128 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== 'ABIF'
  )
    throw new AbifError('This is not an ABI trace (.ab1) file.')
  const dirCount = view.getInt32(18)
  const dirOffset = view.getInt32(26)
  if (
    dirCount <= 0 ||
    dirOffset <= 0 ||
    dirOffset + dirCount * 28 > bytes.length
  )
    throw new AbifError('The trace file directory is damaged.')
  const entries = new Map<string, Entry>()
  for (let i = 0; i < dirCount; i++) {
    const p = dirOffset + i * 28
    const tag = String.fromCharCode(...bytes.slice(p, p + 4))
    const num = view.getInt32(p + 4)
    // Layout: tag(4) num(4) type(2) elemSize(2) count(4) size(4) offset(4).
    const size = view.getInt32(p + 16)
    const entry: Entry = {
      tag,
      num,
      type: view.getInt16(p + 8),
      elemSize: view.getInt16(p + 10),
      count: view.getInt32(p + 12),
      size,
      offset: view.getInt32(p + 20),
      dataPos: size <= 4 ? p + 20 : view.getInt32(p + 20),
    }
    entries.set(`${tag}${num}`, entry)
  }
  const get = (tag: string, num: number): Entry | undefined =>
    entries.get(`${tag}${num}`)
  const bytesOf = (e: Entry): Uint8Array =>
    bytes.slice(e.dataPos, e.dataPos + e.size)
  const text = (tag: string, num: number): string | undefined => {
    const e = get(tag, num)
    if (!e) return undefined
    const raw = bytesOf(e)
    // Type 18 is a Pascal string: the first byte is its length.
    const body = e.type === 18 ? raw.slice(1, 1 + raw[0]) : raw
    return String.fromCharCode(...body).replace(/\0+$/, '')
  }
  const shorts = (tag: string, num: number): number[] | undefined => {
    const e = get(tag, num)
    if (!e) return undefined
    const out: number[] = []
    for (let i = 0; i < e.count; i++) out.push(view.getInt16(e.dataPos + i * 2))
    return out
  }

  const bases = text('PBAS', 2) ?? text('PBAS', 1)
  if (!bases) throw new AbifError('This trace file has no base calls.')
  const qe = get('PCON', 2) ?? get('PCON', 1)
  const quality = qe ? Array.from(bytesOf(qe)) : bases.split('').map(() => 0)
  const peaks = shorts('PLOC', 2) ?? shorts('PLOC', 1) ?? []
  const order = (text('FWO_', 1) ?? 'GATC').toUpperCase()
  const channels = {
    A: [] as number[],
    C: [] as number[],
    G: [] as number[],
    T: [] as number[],
  }
  for (let i = 0; i < 4; i++) {
    const letter = order[i] as 'A' | 'C' | 'G' | 'T'
    const data = shorts('DATA', 9 + i)
    if (data && letter in channels) channels[letter] = data
  }
  return {
    name: text('SMPL', 1) ?? text('LANE', 1) ?? '',
    bases: bases.toUpperCase(),
    quality,
    peaks,
    channels,
    meta: {
      instrument: text('MODL', 1) ?? text('MCHN', 1),
      well: text('TUBE', 1) ?? text('WELL', 1),
      runDate: undefined,
    },
  }
}

/**
 * Trim the poor ends of a read with a running-average quality test (the same
 * idea as phred's modified Mott algorithm): returns the kept span.
 */
export function trimByQuality(
  quality: readonly number[],
  threshold = 20,
  window = 10,
): { start: number; end: number } {
  const n = quality.length
  if (n === 0) return { start: 0, end: 0 }
  const w = Math.min(window, n)
  const mean = (i: number) => {
    let s = 0
    for (let k = 0; k < w; k++) s += quality[i + k]
    return s / w
  }
  let start = 0
  while (start + w <= n && mean(start) < threshold) start++
  let end = n
  while (end - w >= start && mean(end - w) < threshold) end--
  if (start + w > n || end <= start) return { start: 0, end: 0 }
  return { start, end }
}

/** Phred qualities as a compact string (Phred+33, as in FASTQ). */
export function encodeQuality(q: readonly number[]): string {
  return q
    .map((v) => String.fromCharCode(33 + Math.min(93, Math.max(0, v))))
    .join('')
}

export function decodeQuality(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0) - 33)
}
