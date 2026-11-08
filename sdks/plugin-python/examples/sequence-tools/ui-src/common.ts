import { arc, pie } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import './style.css'

export interface Analysis {
  length: number
  gc: number
  counts: Record<string, number>
}

/** The letters of a pasted sequence, upper case, with spaces and line breaks gone. */
export const clean = (text: string) => text.replace(/\s+/g, '').toUpperCase()

export const isDna = (sequence: string) => /^[ACGTN]+$/.test(sequence)

export function gcContent(sequence: string): number {
  if (!sequence) return 0
  let gc = 0
  for (const base of sequence) if (base === 'G' || base === 'C') gc += 1
  return (100 * gc) / sequence.length
}

/**
 * A ring split into equal windows of the sequence, each shaded by how much of
 * it is G or C. Drawn in the current text colour, so it follows light and dark.
 */
export function ringSvg(sequence: string, size = 160, windows = 48): string {
  const count = Math.max(1, Math.min(windows, sequence.length))
  const step = sequence.length / count
  const shade = scaleLinear().domain([0, 100]).range([0.12, 1])
  const slices = pie<number>().sort(null).value(1)(
    Array.from({ length: count }, (_, i) => i),
  )
  const outer = size / 2 - 4
  const path = arc<(typeof slices)[number]>()
    .innerRadius(outer * 0.62)
    .outerRadius(outer)
    .padAngle(0.012)
  const parts = slices.map((slice, i) => {
    const part = sequence.slice(Math.floor(i * step), Math.floor((i + 1) * step))
    return `<path d="${path(slice)}" fill="currentColor" fill-opacity="${shade(gcContent(part)).toFixed(2)}"/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Sequence map, ${sequence.length} bases">${parts.join('')}<text text-anchor="middle" dy="0.35em" font-size="${size / 9}" fill="currentColor">${sequence.length}</text></svg>`
}

/** A bar for a percentage, `width` wide. */
export function barSvg(percent: number, width = 64): string {
  const x = scaleLinear().domain([0, 100]).range([0, width])
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 8" width="${width}" height="8" role="img" aria-label="${percent.toFixed(0)}% GC"><rect width="${width}" height="8" rx="4" fill="#2563eb" fill-opacity="0.18"/><rect width="${x(percent).toFixed(1)}" height="8" rx="4" fill="#2563eb"/></svg>`
}

export async function analyse(sequence: string): Promise<Analysis> {
  // `fetch` here is the SDK's door to this plugin's own operations.
  const response = await fetch('/operations/analyse', {
    method: 'POST',
    body: JSON.stringify({ sequence }),
  })
  const body = (await response.json()) as Analysis & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'That could not be analysed.')
  return body
}

export function stats(a: Analysis): string {
  return `${a.length} bases · ${a.gc}% GC · A ${a.counts.A} · C ${a.counts.C} · G ${a.counts.G} · T ${a.counts.T}`
}

export const app = () => document.getElementById('app') as HTMLElement
