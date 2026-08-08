/** OPS-007 — Browser DOCX export built exclusively from frozen report data. */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'

import { stableStringify } from './report-builder'
import type { ReportDefinition, ReportSection } from './report-builder'

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type ExportableReport = Pick<
  ReportDefinition,
  'title' | 'subtitle' | 'documentIdentifier' | 'version'
>

function sourceMetadata(section: ReportSection): string {
  const revision = section.sourceRevisionId
    ? ` · revision ${section.sourceRevisionId.slice(0, 8)}`
    : ''
  return `Source: ${section.sourceType}${revision} · validation: ${section.validationStatus}`
}

/**
 * Produce a standards-compliant OpenXML Word document from frozen evidence.
 * The ordered sections and payloads are copied at generation time; no live
 * source is accessed by this export path.
 */
export async function buildReportDocx(
  report: ExportableReport,
  sections: ReportSection[],
): Promise<Blob> {
  const ordered = sections.slice().sort((a, b) => a.position - b.position)
  const children: Paragraph[] = [
    new Paragraph({
      text: report.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
    ...(report.subtitle
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: report.subtitle, italics: true })],
          }),
        ]
      : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `${report.documentIdentifier} · Version ${report.version}`,
          color: '5D646F',
          size: 18,
        }),
      ],
      spacing: { after: 360 },
    }),
  ]

  for (const [index, section] of ordered.entries()) {
    children.push(
      new Paragraph({
        text: `${index + 1}. ${section.title}`,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: index > 0,
      }),
    )
    if (section.description) children.push(new Paragraph(section.description))
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: sourceMetadata(section),
            italics: true,
            color: '5D646F',
            size: 18,
          }),
        ],
        spacing: { after: 120 },
      }),
    )
    if (Object.keys(section.frozenPayload).length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: 'Frozen payload', bold: true })],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: stableStringify(section.frozenPayload),
              font: 'Courier New',
              size: 16,
            }),
          ],
          shading: { fill: 'F1F4F8' },
          spacing: { after: 240 },
        }),
      )
    }
  }

  const document = new Document({
    creator: 'Sheetbase ELN',
    title: report.title,
    description: `Frozen evidence report ${report.documentIdentifier}`,
    sections: [{ children }],
  })
  return Packer.toBlob(document)
}

export function reportDocxFilename(report: ExportableReport): string {
  const stem = `${report.documentIdentifier}-${report.title}`
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/(^-|-$)/g, '')
  return `${stem || 'report'}.docx`
}

/** Browser-only download helper for genuine DOCX bytes. */
export function downloadReportDocx(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
