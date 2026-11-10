import type { Trace } from './abif'

/**
 * A trace in a form that is kept with the block: the peak positions and the
 * four channels as 16-bit numbers, as base64. The bases and qualities are the
 * read's own.
 */
export function packTrace(trace: Trace): string {
  const n = trace.channels.A.length
  const m = trace.peaks.length
  const buf = new ArrayBuffer(8 + m * 4 + n * 8)
  const head = new Uint32Array(buf, 0, 2)
  head[0] = n
  head[1] = m
  new Uint32Array(buf, 8, m).set(trace.peaks)

  const channels = new Uint16Array(buf, 8 + m * 4, n * 4)

  ;(['A', 'C', 'G', 'T'] as const).forEach((k, i) => {
    const src = trace.channels[k]

    for (let j = 0; j < n; j++)
      channels[i * n + j] = Math.max(0, Math.min(65535, src[j] ?? 0))
  })
  const bytes = new Uint8Array(buf)
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))

  return btoa(binary)
}

export function unpackTrace(
  packed: string,
  read: { name: string; bases: string; quality: readonly number[] },
): Trace {
  const binary = atob(packed)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const buf = bytes.buffer
  const [n, m] = new Uint32Array(buf, 0, 2)
  const peaks = Array.from(new Uint32Array(buf, 8, m))
  const all = new Uint16Array(buf, 8 + m * 4, n * 4)
  const channel = (i: number) => Array.from(all.subarray(i * n, (i + 1) * n))

  return {
    name: read.name,
    bases: read.bases,
    quality: [...read.quality],
    peaks,
    channels: { A: channel(0), C: channel(1), G: channel(2), T: channel(3) },
    meta: {},
  }
}
