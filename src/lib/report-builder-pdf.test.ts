import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import {
  buildReportPdf,
  PDF_MIME_TYPE,
  reportPdfFilename,
} from './report-builder-pdf'
import type { ReportSection } from './report-builder'

const report = {
  title: 'Virus Stability Study Report',
  subtitle: 'Frozen stability evidence',
  documentIdentifier: 'RPT-2026-0001',
  version: 2,
}

const section: ReportSection = {
  id: 'section-1',
  workspaceId: 'workspace-1',
  reportId: 'report-1',
  position: 0,
  title: 'Executive Summary',
  description: 'The frozen report summary.',
  sectionType: 'text',
  sourceType: 'revision_block',
  sourceRevisionId: 'revision-12345678',
  sourceRef: {},
  frozenPayload: { conclusion: 'Stable through day 21' },
  validationStatus: 'valid',
  validationDetail: {},
  createdAt: '2026-08-08T00:00:00Z',
  updatedAt: '2026-08-08T00:00:00Z',
  createdByUserId: 'user-1',
  updatedByUserId: 'user-1',
}

describe('buildReportPdf', () => {
  it('creates a paginated PDF with the official PDF MIME type and signature', async () => {
    const pdf = await buildReportPdf(report, [section])
    const bytes = new Uint8Array(await pdf.arrayBuffer())
    const parsed = await PDFDocument.load(bytes)

    expect(pdf.type).toBe(PDF_MIME_TYPE)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(parsed.getPageCount()).toBeGreaterThan(0)
  })

  it('derives a safe .pdf download filename', () => {
    expect(reportPdfFilename(report)).toBe(
      'RPT-2026-0001-Virus-Stability-Study-Report.pdf',
    )
  })
})
