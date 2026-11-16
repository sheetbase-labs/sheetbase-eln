/** Draws a record figure into a PDF page with plain lines, markers and bars. */
import { degrees, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'

import { formatMagnitude } from '#/lib/format-numbers'
import { safeText } from '#/lib/client-portal-pdf'
import type { PdfFigure } from './record-figures'

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

  const categories = [
    ...new Set(
      figure.series.flatMap((s) =>
        s.points.map((p) => p.label ?? String(p.x ?? '')),
      ),
    ),
  ]

  const xs = figure.series.flatMap((s) =>
    s.points.flatMap((p) => (p.x === null ? [] : [p.x])),
  )

  const ys = figure.series.flatMap((s) => s.points.map((p) => p.y))
  const refs = figure.hlines.map((h) => h.value)
  const yMin = Math.min(figure.kind === 'bar' ? 0 : Infinity, ...ys, ...refs)
  const yMax = Math.max(...ys, ...refs)
  const yTicks = niceTicks(yMin, yMax)
  const y0 = Math.min(yMin, yTicks[0] ?? yMin)
  const y1 = Math.max(yMax, yTicks.at(-1) ?? yMax)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const xTicks = figure.kind === 'xy' ? niceTicks(xMin, xMax) : []
  const x0 = Math.min(xMin, xTicks[0] ?? xMin)
  const x1 = Math.max(xMax, xTicks.at(-1) ?? xMax)

  const py = (v: number) => plot.y + ((v - y0) / (y1 - y0 || 1)) * plot.height

  const px = (v: number) => plot.x + ((v - x0) / (x1 - x0 || 1)) * plot.width

  const text = (value: string, x: number, y: number, size = 7) =>
    page.drawText(safeText(value), { x, y, size, font, color: ink })

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

  if (figure.kind === 'xy') {
    for (const t of xTicks) {
      const label = safeText(tickText(t))

      text(label, px(t) - font.widthOfTextAtSize(label, 7) / 2, plot.y - 10)
    }
  } else {
    const slot = plot.width / Math.max(categories.length, 1)
    const barWidth = (slot * 0.7) / figure.series.length

    figure.series.forEach((s, si) => {
      s.points.forEach((p) => {
        const ci = categories.indexOf(p.label ?? String(p.x ?? ''))
        const bx = plot.x + ci * slot + slot * 0.15 + si * barWidth

        page.drawRectangle({
          x: bx,
          y: py(Math.min(0, p.y)),
          width: barWidth,
          height: Math.abs(py(p.y) - py(0)),
          color: colourOf(s.color),
        })
      })
    })
    categories.forEach((c, ci) => {
      const label = safeText(c).slice(0, 14)

      text(
        label,
        plot.x + ci * slot + slot / 2 - font.widthOfTextAtSize(label, 7) / 2,
        plot.y - 10,
      )
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

  text(figure.xLabel, plot.x + plot.width / 2 - 20, box.y + 4, 8)
  page.drawText(safeText(figure.yLabel), {
    x: box.x + 10,
    y: plot.y + plot.height / 2 - 20,
    size: 8,
    font,
    color: ink,
    rotate: degrees(90),
  })

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
