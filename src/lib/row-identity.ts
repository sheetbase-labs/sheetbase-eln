export const ROW_IDENTITY_FORMAT_VERSION = 1 as const

export type RowIdentitySpec = {
  kind: 'source' | 'composite' | 'local'
  columnIds: readonly string[]
  logicalTypes: readonly RowIdentityLogicalType[]
}

export type RowIdentityLogicalType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'category'
  | 'reference'

export type RowIdentityError = {
  code: 'missing' | 'invalid' | 'duplicate'
  row: number
  columnId?: string
  key?: string
}

export type RowIdentityBatchResult =
  | { ok: true; rows: Array<{ key: string; localId?: string }> }
  | { ok: false; errors: RowIdentityError[] }

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const nilUuid = '00000000-0000-0000-0000-000000000000'

function scalar(value: unknown): string | null {
  return typeof value === 'string' ? `s:${JSON.stringify(value)}` : null
}

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [, year, month, day] = match
  const numericYear = Number(year)
  const numericMonth = Number(month)
  const numericDay = Number(day)
  const leap =
    numericYear % 4 === 0 &&
    (numericYear % 100 !== 0 || numericYear % 400 === 0)
  return (
    numericYear >= 1 &&
    numericMonth >= 1 &&
    numericMonth <= 12 &&
    numericDay >= 1 &&
    numericDay <=
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
        numericMonth - 1
      ]
  )
}

function encode(
  value: unknown,
  logicalType: RowIdentityLogicalType,
): string | null {
  switch (logicalType) {
    case 'text':
      return scalar(value)
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? `i:${value}`
        : null
    case 'decimal':
      return typeof value === 'number' && Number.isFinite(value)
        ? `d:${value}`
        : null
    case 'boolean':
      return typeof value === 'boolean' ? `b:${value}` : null
    case 'date':
      return typeof value === 'string' && isCalendarDate(value)
        ? `d:${value}`
        : null
    case 'timestamp': {
      if (typeof value !== 'string') return null
      const match =
        /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
          value,
        )
      return match &&
        isCalendarDate(match[1]) &&
        Number(match[2]) <= 23 &&
        Number(match[3]) <= 59 &&
        Number(match[4]) <= 59 &&
        (value.endsWith('Z') ||
          (Number(match[5]) <= 23 && Number(match[6]) <= 59))
        ? `t:${value}`
        : null
    }
    case 'category':
    case 'reference':
      return typeof value === 'string' && uuid.test(value) && value !== nilUuid
        ? `u:${value.toLowerCase()}`
        : null
  }
}

function canonical(spec: RowIdentitySpec, values: unknown[]) {
  return JSON.stringify({
    v: ROW_IDENTITY_FORMAT_VERSION,
    kind: spec.kind,
    columns: spec.columnIds,
    types: spec.logicalTypes,
    values,
  })
}

export function rowIdentityKey(spec: RowIdentitySpec, values: unknown[]) {
  return `sb-row-v${ROW_IDENTITY_FORMAT_VERSION}:${sha256Hex(canonical(spec, values))}`
}

/** Resolves a batch without ever deriving identity from input order or labels. */
export function resolveRowIdentityBatch(
  spec: RowIdentitySpec,
  rows: Array<Record<string, unknown> & { localId?: string }>,
): RowIdentityBatchResult {
  const errors: RowIdentityError[] = []
  const validCardinality =
    spec.kind === 'composite'
      ? spec.columnIds.length >= 2 && spec.columnIds.length <= 8
      : spec.columnIds.length === 1
  if (
    !validCardinality ||
    spec.columnIds.length !== spec.logicalTypes.length ||
    new Set(spec.columnIds).size !== spec.columnIds.length ||
    (spec.kind === 'local' && spec.logicalTypes[0] !== 'reference')
  )
    return { ok: false, errors: [{ code: 'invalid', row: 0 }] }
  const keys = new Map<string, number>()
  const resolved: Array<{ key: string; localId?: string }> = []
  for (const [row, input] of rows.entries()) {
    const values: string[] = []
    if (spec.kind === 'local') {
      const localId = input.localId ?? newRowUuid()
      if (!uuid.test(localId) || localId === nilUuid) {
        errors.push({ code: 'invalid', row, columnId: spec.columnIds[0] })
        continue
      }
      values.push(`u:${localId.toLowerCase()}`)
      const key = rowIdentityKey(spec, values)
      resolved.push({ key, localId })
      if (keys.has(key)) errors.push({ code: 'duplicate', row, key })
      else keys.set(key, row)
      continue
    }
    for (const [index, columnId] of spec.columnIds.entries()) {
      const value = input[columnId]
      if (value === undefined || value === null) {
        errors.push({ code: 'missing', row, columnId })
        continue
      }
      const encoded = encode(value, spec.logicalTypes[index])
      if (encoded === null) errors.push({ code: 'invalid', row, columnId })
      else values.push(encoded)
    }
    if (errors.some((error) => error.row === row)) continue
    const key = rowIdentityKey(spec, values)
    resolved.push({ key })
    if (keys.has(key)) errors.push({ code: 'duplicate', row, key })
    else keys.set(key, row)
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows: resolved }
}

function newRowUuid(): string {
  return globalThis.crypto.randomUUID()
}

function sha256Hex(value: string): string {
  return sha256HexBrowser(value)
}

/** Synchronous SHA-256 for the browser bundle. Must match Node's createHash. */
function sha256HexBrowser(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const bitLen = bytes.length * 8
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  withPad.set(bytes)
  withPad[bytes.length] = 0x80
  const view = new DataView(withPad.buffer)
  view.setUint32(withPad.length - 4, bitLen)

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + k[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('')
}
