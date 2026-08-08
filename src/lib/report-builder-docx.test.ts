import { describe, expect, it } from 'vitest'

import {
  buildReportDocx,
  DOCX_MIME_TYPE,
  reportDocxFilename,
} from './report-builder-docx'
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

describe('buildReportDocx', () => {
  it('creates a non-empty OpenXML ZIP with the official Word MIME type', async () => {
    const docx = await buildReportDocx(report, [section])
    const bytes = new Uint8Array(await docx.arrayBuffer())

    expect(docx.type).toBe(DOCX_MIME_TYPE)
    expect(bytes.byteLength).toBeGreaterThan(100)
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('derives a safe .docx download filename', () => {
    expect(reportDocxFilename(report)).toBe(
      'RPT-2026-0001-Virus-Stability-Study-Report.docx',
    )
  })
})
