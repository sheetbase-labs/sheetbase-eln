/** OPS-007 pure unit tests for report builder helpers and rendering. */
import { describe, expect, it } from 'vitest'

import { DataClientError } from './data-client'
import {
  REPORT_STATUS_LABELS,
  SECTION_TYPE_LABELS,
  SOURCE_TYPE_LABELS,
  VALIDATION_STATUS_LABELS,
  buildGenerationInputs,
  computeChecksum,
  describeReportBuilderError,
  fakeSha256,
  renderReportHtml,
  stableStringify,
  toReportDefinition,
  toReportGeneration,
  toReportSection,
  toValidationSummary,
} from './report-builder'
import type {
  ReportDefinitionWire,
  ReportGenerationWire,
  ReportSection,
  ReportSectionWire,
} from './report-builder'

const reportWire: ReportDefinitionWire = {
  id: 'r1',
  workspace_id: 'ws1',
  project_id: null,
  record_id: null,
  template_record_id: null,
  review_submission_id: null,
  title: 'Stability Report',
  subtitle: '4C stability',
  document_identifier: 'RPT-2026-0001',
  status: 'draft',
  version: 1,
  last_saved_at: '2026-07-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  created_by_user_id: 'u1',
  updated_by_user_id: 'u1',
}

const sectionWire: ReportSectionWire = {
  id: 's1',
  workspace_id: 'ws1',
  report_id: 'r1',
  position: 0,
  title: 'Summary',
  description: 'Overview',
  section_type: 'text',
  source_type: 'free_text',
  source_revision_id: null,
  source_ref: {},
  frozen_payload: {},
  validation_status: 'valid',
  validation_detail: {},
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  created_by_user_id: 'u1',
  updated_by_user_id: 'u1',
}

describe('report-builder mappers', () => {
  it('maps a report definition wire to domain', () => {
    expect(toReportDefinition(reportWire)).toMatchObject({
      id: 'r1',
      workspaceId: 'ws1',
      documentIdentifier: 'RPT-2026-0001',
      status: 'draft',
      version: 1,
      subtitle: '4C stability',
    })
  })

  it('maps a report section wire to domain', () => {
    expect(toReportSection(sectionWire)).toMatchObject({
      id: 's1',
      reportId: 'r1',
      sectionType: 'text',
      sourceType: 'free_text',
      validationStatus: 'valid',
    })
  })

  it('maps a report generation wire to domain', () => {
    const wire: ReportGenerationWire = {
      id: 'g1',
      workspace_id: 'ws1',
      report_id: 'r1',
      report_version: 1,
      generation_inputs: { reportId: 'r1' },
      output_format: 'html',
      output_checksum: 'a'.repeat(64),
      output_size_bytes: 100,
      output_html: '<html/>',
      actor_user_id: 'u1',
      generated_at: '2026-07-01T00:00:00Z',
      created_at: '2026-07-01T00:00:00Z',
    }
    expect(toReportGeneration(wire)).toMatchObject({
      id: 'g1',
      outputChecksum: 'a'.repeat(64),
      outputFormat: 'html',
      outputSizeBytes: 100,
    })
  })

  it('maps a validation summary wire to domain', () => {
    expect(
      toValidationSummary({
        reportId: 'r1',
        sections: 3,
        valid: 2,
        missingSource: 1,
        stale: 0,
        locked: 0,
        ready: false,
      }),
    ).toMatchObject({ reportId: 'r1', ready: false, missingSource: 1 })
  })
})

describe('report-builder labels', () => {
  it('exposes labels for every status and type', () => {
    expect(REPORT_STATUS_LABELS.draft).toBe('Draft')
    expect(SECTION_TYPE_LABELS.chart).toBe('Chart')
    expect(SOURCE_TYPE_LABELS.revision_block).toBe('Revision block')
    expect(VALIDATION_STATUS_LABELS.stale).toBe('Stale live ref')
  })
})

describe('buildGenerationInputs', () => {
  const report = {
    id: 'r1',
    version: 1,
    documentIdentifier: 'RPT-2026-0001',
    title: 'Stability Report',
    subtitle: '4C',
  }

  it('sorts sections by position and indexes them from zero', () => {
    const sections: ReportSection[] = [
      { ...toReportSection(sectionWire), id: 's2', position: 1 },
      { ...toReportSection(sectionWire), id: 's1', position: 0 },
    ]
    const inputs = buildGenerationInputs(report, sections, 'html')
    const list = inputs.sections as Array<{
      position: number
      sectionId: string
    }>
    expect(list.map((s) => s.sectionId)).toEqual(['s1', 's2'])
    expect(list.map((s) => s.position)).toEqual([0, 1])
  })

  it('is deterministic for identical inputs regardless of input order', () => {
    const a: ReportSection[] = [
      { ...toReportSection(sectionWire), id: 's2', position: 1 },
      { ...toReportSection(sectionWire), id: 's1', position: 0 },
    ]
    const b: ReportSection[] = [
      { ...toReportSection(sectionWire), id: 's1', position: 0 },
      { ...toReportSection(sectionWire), id: 's2', position: 1 },
    ]
    expect(stableStringify(buildGenerationInputs(report, a, 'html'))).toBe(
      stableStringify(buildGenerationInputs(report, b, 'html')),
    )
  })

  it('changes the envelope when the output format changes', () => {
    const sections: ReportSection[] = [toReportSection(sectionWire)]
    expect(
      stableStringify(buildGenerationInputs(report, sections, 'html')),
    ).not.toBe(stableStringify(buildGenerationInputs(report, sections, 'pdf')))
  })
})

describe('stableStringify', () => {
  it('sorts object keys deeply', () => {
    expect(stableStringify({ b: 1, a: { z: 1, y: 2 } })).toBe(
      JSON.stringify({ a: { y: 2, z: 1 }, b: 1 }),
    )
  })
})

describe('checksum determinism', () => {
  it('fakeSha256 is stable for identical input', () => {
    expect(fakeSha256('hello')).toBe(fakeSha256('hello'))
    expect(fakeSha256('hello')).toHaveLength(64)
    expect(fakeSha256('hello')).not.toBe(fakeSha256('world'))
  })

  it('computeChecksum is deterministic for identical inputs', async () => {
    const inputs = buildGenerationInputs(
      {
        id: 'r1',
        version: 1,
        documentIdentifier: 'RPT-2026-0001',
        title: 'T',
        subtitle: null,
      },
      [toReportSection(sectionWire)],
      'html',
    )
    expect(await computeChecksum(inputs)).toBe(await computeChecksum(inputs))
    expect((await computeChecksum(inputs)).length).toBe(64)
  })
})

describe('renderReportHtml', () => {
  const report = {
    title: 'Stability Report',
    subtitle: '4C',
    documentIdentifier: 'RPT-2026-0001',
    version: 1,
  }

  it('renders an accessible HTML document with lang and charset', () => {
    const html = renderReportHtml(report, [])
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<meta charset="utf-8"/>')
    expect(html).toContain('<title>Stability Report</title>')
  })

  it('renders ordered numbered sections from frozen payloads only', () => {
    const sections: ReportSection[] = [
      {
        ...toReportSection(sectionWire),
        id: 's1',
        position: 0,
        title: 'Summary',
        frozenPayload: { block: { value: 42 } },
        sourceRevisionId: 'rev-12345678',
        validationStatus: 'valid',
      },
      {
        ...toReportSection(sectionWire),
        id: 's2',
        position: 1,
        title: 'Results',
        sourceType: 'chart_block',
        frozenPayload: {},
      },
    ]
    const html = renderReportHtml(report, sections)
    expect(html).toContain('1. Summary')
    expect(html).toContain('2. Results')
    expect(html).toContain('"block":{"value":42}')
    expect(html).toContain('revision rev-1234')
  })

  it('is deterministic for identical inputs', () => {
    const sections: ReportSection[] = [
      { ...toReportSection(sectionWire), id: 's2', position: 1, title: 'B' },
      { ...toReportSection(sectionWire), id: 's1', position: 0, title: 'A' },
    ]
    expect(renderReportHtml(report, sections)).toBe(
      renderReportHtml(report, [...sections].reverse()),
    )
  })

  it('escapes HTML in titles and frozen payloads', () => {
    const sections: ReportSection[] = [
      {
        ...toReportSection(sectionWire),
        title: '<script>alert(1)</script>',
        frozenPayload: { x: '<b>' },
      },
    ]
    const html = renderReportHtml(report, sections)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;')
  })
})

describe('describeReportBuilderError', () => {
  it('maps known codes to messages', () => {
    expect(
      describeReportBuilderError(new DataClientError('SB046', 'x', 400)),
    ).toBe('The report was not found.')
    expect(
      describeReportBuilderError(new DataClientError('SB049', 'x', 400)),
    ).toBe('The source revision was not found.')
  })

  it('falls back to the error message for unknown codes', () => {
    expect(
      describeReportBuilderError(new DataClientError('SB999', 'boom', 400)),
    ).toBe('boom')
  })

  it('returns a generic message for non-DataClient errors', () => {
    expect(describeReportBuilderError(new Error('nope'))).toMatch(
      /could not complete/i,
    )
  })
})
