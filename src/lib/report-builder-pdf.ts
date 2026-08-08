/** OPS-007 — Browser PDF export built exclusively from frozen report data. */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import { stableStringify } from './report-builder'
import type { ReportDefinition, ReportSection } from './report-builder'

export const PDF_MIME_TYPE = 'application/pdf'

type ExportableReport = Pick<
  ReportDefinition,
  'title' | 'subtitle' | 'documentIdentifier' | 'version'
>

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 54
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

function sourceMetadata(section: ReportSection): string {
  const revision = section.sourceRevisionId
    ? ` · revision ${section.sourceRevisionId.slice(0, 8)}`
    : ''
  return `Source: ${section.sourceType}${revision} · validation: ${section.validationStatus}`
}

function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
) {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && measure(candidate) > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
    if (!paragraph) lines.push('')
  }
  return lines
}

/**
 * Produce a paginated PDF from frozen evidence only. No live source is
 * accessed; the rendered body includes the ordered sections and exact frozen
 * payload captured when each section was bound.
 */
export async function buildReportPdf(
  report: ExportableReport,
  sections: ReportSection[],
): Promise<Blob> {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono = await pdf.embedFont(StandardFonts.Courier)
  const ordered = sections.slice().sort((a, b) => a.position - b.position)
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let cursorY = PAGE_HEIGHT - MARGIN

  const nextPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    cursorY = PAGE_HEIGHT - MARGIN
  }
  const reserve = (height: number) => {
    if (cursorY - height < MARGIN) nextPage()
  }
  const drawLines = (
    text: string,
    font: typeof regular,
    size: number,
    color: ReturnType<typeof rgb>,
    lineHeight: number,
    indent = 0,
  ) => {
    const lines = wrapText(text, CONTENT_WIDTH - indent, (line) =>
      font.widthOfTextAtSize(line, size),
    )
    for (const line of lines) {
      reserve(lineHeight)
      page.drawText(line, {
        x: MARGIN + indent,
        y: cursorY - size,
        font,
        size,
        color,
      })
      cursorY -= lineHeight
    }
  }

  drawLines(report.title, bold, 24, rgb(0.09, 0.14, 0.22), 30)
  cursorY -= 6
  if (report.subtitle) {
    drawLines(report.subtitle, regular, 12, rgb(0.3, 0.34, 0.4), 17)
    cursorY -= 5
  }
  drawLines(
    `${report.documentIdentifier} · Version ${report.version}`,
    bold,
    10,
    rgb(0.3, 0.34, 0.4),
    14,
  )
  cursorY -= 18

  for (const [index, section] of ordered.entries()) {
    reserve(42)
    drawLines(
      `${index + 1}. ${section.title}`,
      bold,
      15,
      rgb(0.09, 0.14, 0.22),
      21,
    )
    if (section.description) {
      drawLines(section.description, regular, 10, rgb(0.12, 0.15, 0.19), 15)
      cursorY -= 5
    }
    drawLines(sourceMetadata(section), regular, 8.5, rgb(0.35, 0.39, 0.44), 13)
    cursorY -= 5
    if (Object.keys(section.frozenPayload).length > 0) {
      drawLines('Frozen payload', bold, 9, rgb(0.12, 0.15, 0.19), 13)
      drawLines(
        stableStringify(section.frozenPayload),
        mono,
        8,
        rgb(0.12, 0.15, 0.19),
        11,
        8,
      )
    }
    cursorY -= 16
  }

  const pages = pdf.getPages()
  pages.forEach((currentPage, index) => {
    currentPage.drawText(`Sheetbase ELN · ${index + 1} of ${pages.length}`, {
      x: MARGIN,
      y: 26,
      font: regular,
      size: 8,
      color: rgb(0.4, 0.43, 0.47),
    })
  })
  pdf.setTitle(report.title)
  pdf.setSubject(`Frozen evidence report ${report.documentIdentifier}`)
  pdf.setCreator('Sheetbase ELN')

  const bytes = await pdf.save()
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return new Blob([arrayBuffer], { type: PDF_MIME_TYPE })
}

export function reportPdfFilename(report: ExportableReport): string {
  const stem = `${report.documentIdentifier}-${report.title}`
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/(^-|-$)/g, '')
  return `${stem || 'report'}.pdf`
}

/** Browser-only download helper for genuine PDF bytes. */
export function downloadReportPdf(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
