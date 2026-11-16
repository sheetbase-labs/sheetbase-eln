/** Draws a record figure into a PDF page with plain lines, markers and bars. */
import { degrees, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'

import { formatMagnitude } from '#/lib/format-numbers'
import { safeText } from '#/lib/client-portal-pdf'
import type { PdfFigure } from './chart-figure'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

const ink = rgb(0.2, 0.22, 0.26)
const grid = rgb(0.88, 0.89, 0.91)

function colourOf(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)

  if (!m?.[1]) return rgb(0.1, 0.4, 0.75)
  const n = Number.parseInt(m[1], 16)

  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || Math.abs(hi) || 1
  const raw = span / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow
  const first = Math.ceil(lo / step) * step
  const ticks: number[] = []

  for (let v = first; v <= hi + step * 1e-6; v += step)
    ticks.push(Number(v.toPrecision(12)))

  return ticks
}

const tickText = (v: number) => formatMagnitude(v) ?? String(v)

/** Height the figure needs, so the caller can keep it on one page. */
export const FIGURE_HEIGHT = 200

/** The y values a figure has to fit, by kind. */
function yValues(figure: PdfFigure): number[] {
  return figure.series.flatMap((s) => [
    ...s.points.map((p) => p.y),
    ...(s.box ? [s.box.lo, s.box.hi, ...s.box.outliers] : []),
    ...(s.violin ? s.violin.map((v) => v.y) : []),
  ])
}

function drawHeatmap(
  page: PDFPage,
  font: PDFFont,
  figure: PdfFigure,
  plot: Box,
): void {
  const heat = figure.heatmap

  if (!heat) return
  const cols = heat.xLabels.length
  const rows = Math.max(heat.yLabels?.length ?? 1, 1)
  const cw = plot.width / Math.max(cols, 1)
  const ch = plot.height / rows
  const lo = heat.min ?? 0
  const hi = heat.max ?? lo + 1

  for (const cell of heat.cells) {
    if (cell.value === null) continue
    const t = (cell.value - lo) / (hi - lo || 1)
    const cx = plot.x + cell.x * cw
    const cy = plot.y + plot.height - (cell.y + 1) * ch

    page.drawRectangle({
      x: cx,
      y: cy,
      width: cw,
      height: ch,
      color: rgb(0.93 - 0.78 * t, 0.95 - 0.55 * t, 0.98 - 0.3 * t),
      borderColor: rgb(1, 1, 1),
      borderWidth: 0.5,
    })

    if (cw > 26 && ch > 11)
      page.drawText(safeText(tickText(cell.value)), {
        x: cx + 3,
        y: cy + ch / 2 - 3,
        size: 7,
        font,
        color: t > 0.6 ? rgb(1, 1, 1) : ink,
      })
  }

  const step = Math.ceil(cols / 12)

  heat.xLabels.forEach((label, i) => {
    if (i % step) return
    const text = safeText(label).slice(0, 10)

    page.drawText(text, {
      x: plot.x + i * cw + cw / 2 - font.widthOfTextAtSize(text, 7) / 2,
      y: plot.y - 10,
      size: 7,
      font,
      color: ink,
    })
  })
  heat.yLabels?.forEach((label, i) => {
    const text = safeText(label).slice(0, 8)

    page.drawText(text, {
      x: plot.x - 4 - font.widthOfTextAtSize(text, 7),
      y: plot.y + plot.height - (i + 0.5) * ch - 2.5,
      size: 7,
      font,
      color: ink,
    })
  })
}

export function drawFigure(
  page: PDFPage,
  font: PDFFont,
  figure: PdfFigure,
  box: Box,
): void {
  const left = 46
  const bottom = 34
  const top = 8
  const right = 10

  const plot: Box = {
    x: box.x + left,
    y: box.y + bottom,
    width: box.width - left - right,
    height: box.height - bottom - top - 12,
  }

  const text = (value: string, x: number, y: number, size = 7) =>
    page.drawText(safeText(value), { x, y, size, font, color: ink })

  const frame = () => {
    page.drawLine({
      start: { x: plot.x, y: plot.y },
      end: { x: plot.x + plot.width, y: plot.y },
      thickness: 0.6,
      color: ink,
    })
    page.drawLine({
      start: { x: plot.x, y: plot.y },
      end: { x: plot.x, y: plot.y + plot.height },
      thickness: 0.6,
      color: ink,
    })
  }

  const labels = () => {
    text(figure.xLabel, plot.x + plot.width / 2 - 20, box.y + 4, 8)
    page.drawText(safeText(figure.yLabel), {
      x: box.x + 10,
      y: plot.y + plot.height / 2 - 20,
      size: 8,
      font,
      color: ink,
      rotate: degrees(90),
    })
  }

  if (figure.kind === 'heat') {
    drawHeatmap(page, font, figure, plot)
    labels()

    return
  }

  const categories = [
    ...new Set(
      figure.series.flatMap((s) =>
        s.points.map((p) => p.label ?? String(p.x ?? '')),
      ),
    ),
  ]

  const byCategory = figure.kind === 'box' || figure.kind === 'violin'
  const names = byCategory ? figure.series.map((s) => s.label) : categories
  const edges = figure.edges ?? []
  const ys = yValues(figure)
  const refs = figure.hlines.map((h) => h.value)
  const zeroBased = figure.kind === 'bar' || figure.kind === 'hist'
  const yMin = Math.min(zeroBased ? 0 : Infinity, ...ys, ...refs)
  const yMax = Math.max(...ys, ...refs)
  const yTicks = niceTicks(yMin, yMax)
  const y0 = Math.min(yMin, yTicks[0] ?? yMin)
  const y1 = Math.max(yMax, yTicks.at(-1) ?? yMax)

  const xs =
    figure.kind === 'hist'
      ? edges
      : figure.series.flatMap((s) =>
          s.points.flatMap((p) => (p.x === null ? [] : [p.x])),
        )

  const numericX = figure.kind === 'xy' || figure.kind === 'hist'
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const xTicks = numericX ? niceTicks(xMin, xMax) : []
  const x0 = Math.min(xMin, xTicks[0] ?? xMin)
  const x1 = Math.max(xMax, xTicks.at(-1) ?? xMax)

  const py = (v: number) => plot.y + ((v - y0) / (y1 - y0 || 1)) * plot.height

  const px = (v: number) => plot.x + ((v - x0) / (x1 - x0 || 1)) * plot.width

  for (const t of yTicks) {
    page.drawLine({
      start: { x: plot.x, y: py(t) },
      end: { x: plot.x + plot.width, y: py(t) },
      thickness: 0.4,
      color: grid,
    })
    const label = safeText(tickText(t))

    text(label, plot.x - 4 - font.widthOfTextAtSize(label, 7), py(t) - 2.5)
  }

  frame()

  for (const t of xTicks) {
    const label = safeText(tickText(t))

    text(label, px(t) - font.widthOfTextAtSize(label, 7) / 2, plot.y - 10)
  }

  const slot = plot.width / Math.max(names.length, 1)

  names.forEach((name, i) => {
    if (numericX) return
    const label = safeText(name).slice(0, 14)

    text(
      label,
      plot.x + i * slot + slot / 2 - font.widthOfTextAtSize(label, 7) / 2,
      plot.y - 10,
    )
  })

  if (figure.kind === 'bar') {
    const barWidth = (slot * 0.7) / figure.series.length

    figure.series.forEach((s, si) => {
      for (const p of s.points) {
        const ci = categories.indexOf(p.label ?? String(p.x ?? ''))

        page.drawRectangle({
          x: plot.x + ci * slot + slot * 0.15 + si * barWidth,
          y: py(Math.min(0, p.y)),
          width: barWidth,
          height: Math.abs(py(p.y) - py(0)),
          color: colourOf(s.color),
        })
      }
    })
  }

  if (figure.kind === 'hist') {
    figure.series.forEach((s) => {
      for (const p of s.points) {
        const binStart = p.x ?? 0
        const next = edges.find((e) => e > binStart) ?? binStart

        page.drawRectangle({
          x: px(binStart),
          y: py(0),
          width: Math.max(px(next) - px(binStart) - 0.5, 0.5),
          height: py(p.y) - py(0),
          color: colourOf(s.color),
          opacity: figure.series.length > 1 ? 0.55 : 0.9,
        })
      }
    })
  }

  if (byCategory) {
    figure.series.forEach((s, i) => {
      const colour = colourOf(s.color)
      const cx = plot.x + i * slot + slot / 2
      const half = slot * 0.3

      const dMax = Math.max(...(s.violin ?? []).map((v) => v.d), 0)
      const samples = [...(s.violin ?? [])].sort((a, b) => a.y - b.y)

      samples.slice(1).forEach((v, k) => {
        const a = samples[k] ?? v
        const w = (Math.max(a.d, v.d) / (dMax || 1)) * half

        page.drawRectangle({
          x: cx - w,
          y: py(a.y),
          width: w * 2,
          height: Math.max(py(v.y) - py(a.y), 0.3),
          color: colour,
          opacity: 0.35,
        })
      })

      const stats = s.box

      if (!stats) return
      const bw = figure.kind === 'violin' ? half * 0.25 : half * 0.8

      page.drawLine({
        start: { x: cx, y: py(stats.lo) },
        end: { x: cx, y: py(stats.hi) },
        thickness: 0.8,
        color: ink,
      })
      page.drawRectangle({
        x: cx - bw,
        y: py(stats.q1),
        width: bw * 2,
        height: py(stats.q3) - py(stats.q1),
        color: colour,
        opacity: 0.5,
        borderColor: ink,
        borderWidth: 0.8,
      })
      page.drawLine({
        start: { x: cx - bw, y: py(stats.median) },
        end: { x: cx + bw, y: py(stats.median) },
        thickness: 1.4,
        color: ink,
      })

      for (const o of figure.kind === 'box' ? stats.outliers : [])
        page.drawCircle({
          x: cx,
          y: py(o),
          size: 1.8,
          borderColor: ink,
          borderWidth: 0.6,
        })
    })
  }

  if (figure.kind === 'xy') {
    for (const s of figure.series) {
      const colour = colourOf(s.color)
      const pts = s.points.flatMap((p) => (p.x === null ? [] : [p]))

      if (figure.connect) {
        const sorted = [...pts].sort((a, b) => (a.x ?? 0) - (b.x ?? 0))

        sorted.slice(1).forEach((p, i) => {
          const a = sorted[i] ?? p

          page.drawLine({
            start: { x: px(a.x ?? 0), y: py(a.y) },
            end: { x: px(p.x ?? 0), y: py(p.y) },
            thickness: 1.2,
            color: colour,
          })
        })
      }

      for (const p of pts)
        page.drawCircle({
          x: px(p.x ?? 0),
          y: py(p.y),
          size: 2.2,
          color: colour,
        })
    }
  }

  for (const h of figure.hlines) {
    page.drawLine({
      start: { x: plot.x, y: py(h.value) },
      end: { x: plot.x + plot.width, y: py(h.value) },
      thickness: 0.8,
      color: rgb(0.45, 0.45, 0.5),
      dashArray: [4, 3],
    })
    const label = safeText(h.label)

    text(
      label,
      plot.x + plot.width - font.widthOfTextAtSize(label, 7) - 2,
      py(h.value) + 3,
    )
  }

  labels()

  // Legend along the top of the plot.
  let lx = plot.x

  for (const s of figure.series) {
    page.drawCircle({
      x: lx + 3,
      y: box.y + box.height - 4,
      size: 3,
      color: colourOf(s.color),
    })
    text(s.label, lx + 9, box.y + box.height - 7)
    lx += 18 + font.widthOfTextAtSize(safeText(s.label), 7)
  }
}
