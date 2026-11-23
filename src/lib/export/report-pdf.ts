/**
 * A generated report as a PDF: the same title, numbered sections and source
 * lines as the stored HTML, with the version and fingerprint on every page so
 * a printed copy can be matched to the record.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'

import { safeText } from '#/lib/client-portal-pdf'
import type { ReportDocument } from './report-document'

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 60
const FOOTER_ROOM = 36
const WIDTH = PAGE_W - MARGIN * 2

const ink = rgb(0.07, 0.07, 0.07)
const muted = rgb(0.4, 0.4, 0.4)
const rule = rgb(0.9, 0.9, 0.9)

interface Fonts {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
  mono: PDFFont
}

/** Break a line of words so each piece fits the width, in the font used. */
function wrapLines(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of safeText(text).split(/\s+/)) {
    if (!word) continue

    let piece = word

    // A single word wider than the line (a digest) is cut where it overflows.
    while (font.widthOfTextAtSize(piece, size) > width) {
      let cut = piece.length - 1

      while (
        cut > 1 &&
        font.widthOfTextAtSize(piece.slice(0, cut), size) > width
      )
        cut -= 1

      if (current) {
        lines.push(current)
        current = ''
      }

      lines.push(piece.slice(0, cut))
      piece = piece.slice(cut)
    }

    const candidate = current ? `${current} ${piece}` : piece

    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate
    } else {
      lines.push(current)
      current = piece
    }
  }

  if (current) lines.push(current)

  return lines
}

export async function renderReportPdf(
  doc: ReportDocument,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(safeText(doc.title))
  pdf.setSubject(`Fingerprint ${doc.fingerprint}`)

  const [regular, bold, italic, mono] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.HelveticaOblique),
    pdf.embedFont(StandardFonts.Courier),
  ])

  const fonts: Fonts = { regular, bold, italic, mono }
  const pages: PDFPage[] = []
  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN
  pages.push(page)

  const ensure = (needed: number) => {
    if (y - needed >= MARGIN + FOOTER_ROOM) return
    page = pdf.addPage([PAGE_W, PAGE_H])
    pages.push(page)
    y = PAGE_H - MARGIN
  }

  const paragraph = (
    text: string,
    options: {
      font: PDFFont
      size: number
      color?: ReturnType<typeof rgb>
      indent?: number
      after?: number
      leading?: number
    },
  ) => {
    const indent = options.indent ?? 0
    const leading = options.leading ?? options.size * 1.45

    for (const line of wrapLines(
      text,
      options.font,
      options.size,
      WIDTH - indent,
    )) {
      ensure(leading)
      y -= leading
      page.drawText(line, {
        x: MARGIN + indent,
        y,
        size: options.size,
        font: options.font,
        color: options.color ?? ink,
      })
    }

    y -= options.after ?? 0
  }

  paragraph(doc.title, { font: fonts.bold, size: 22, after: 6 })

  if (doc.subtitle) {
    paragraph(doc.subtitle, {
      font: fonts.italic,
      size: 12,
      color: muted,
      after: 4,
    })
  }

  if (doc.meta) {
    paragraph(doc.meta, {
      font: fonts.regular,
      size: 9,
      color: muted,
      after: 4,
    })
  }

  paragraph(`Fingerprint ${doc.fingerprint}`, {
    font: fonts.mono,
    size: 9,
    color: muted,
    after: 10,
  })

  for (const section of doc.sections) {
    ensure(70)
    y -= 6
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.75,
      color: rule,
    })
    y -= 8
    paragraph(section.heading, { font: fonts.bold, size: 14, after: 2 })

    for (const part of section.body) {
      if (part.kind === 'heading') {
        paragraph(part.text, { font: fonts.bold, size: 11.5, after: 3 })
      } else if (part.kind === 'bullet') {
        ensure(15)
        page.drawText('-', {
          x: MARGIN + 6,
          y: y - 15,
          size: 10.5,
          font: fonts.regular,
          color: ink,
        })
        paragraph(part.text, {
          font: fonts.regular,
          size: 10.5,
          indent: 18,
          after: 2,
        })
      } else if (part.kind === 'meta') {
        paragraph(part.text, {
          font: fonts.regular,
          size: 8.5,
          color: muted,
          after: 5,
        })
      } else if (part.kind === 'code') {
        paragraph(part.text, {
          font: fonts.mono,
          size: 8,
          color: muted,
          after: 4,
        })
      } else {
        paragraph(part.text, { font: fonts.regular, size: 10.5, after: 5 })
      }
    }
  }

  const footer = safeText(
    [doc.meta, `Fingerprint ${doc.fingerprint}`].filter(Boolean).join('  ·  '),
  )

  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: MARGIN, y: MARGIN },
      end: { x: PAGE_W - MARGIN, y: MARGIN },
      thickness: 0.5,
      color: rule,
    })
    p.drawText(footer, {
      x: MARGIN,
      y: MARGIN - 14,
      size: 8,
      font: regular,
      color: muted,
    })

    const label = `Page ${index + 1} of ${pages.length}`

    p.drawText(label, {
      x: PAGE_W - MARGIN - regular.widthOfTextAtSize(label, 8),
      y: MARGIN - 14,
      size: 8,
      font: regular,
      color: muted,
    })
  })

  return pdf.save()
}
