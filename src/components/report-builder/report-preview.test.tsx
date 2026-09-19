import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ReportDefinition, ReportSection } from '#/lib/report-builder'
import { ReportPreview } from './report-preview'

const report: ReportDefinition = {
  id: 'report-1',
  workspaceId: 'workspace-1',
  projectId: null,
  recordId: null,
  templateRecordId: null,
  reviewSubmissionId: null,
  title: 'QC Trend Analysis',
  subtitle: 'Cross-project quality control metrics',
  documentIdentifier: 'RPT-2026-0002',
  status: 'draft',
  version: 1,
  lastSavedAt: '2026-08-06T12:00:00Z',
  createdAt: '2026-08-06T12:00:00Z',
  updatedAt: '2026-08-06T12:00:00Z',
  createdByUserId: 'user-1',
  updatedByUserId: 'user-1',
}

function section(overrides: Partial<ReportSection>): ReportSection {
  return {
    id: 'section-1',
    workspaceId: 'workspace-1',
    reportId: 'report-1',
    position: 0,
    title: 'Overview',
    description: null,
    sectionType: 'text',
    sourceType: 'free_text',
    sourceRevisionId: null,
    sourceRef: {},
    frozenPayload: {},
    validationStatus: 'valid',
    validationDetail: {},
    createdAt: '2026-08-06T12:00:00Z',
    updatedAt: '2026-08-06T12:00:00Z',
    createdByUserId: 'user-1',
    updatedByUserId: 'user-1',
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('ReportPreview', () => {
  it('renders the report masthead once', () => {
    render(
      <ReportPreview
        report={report}
        sections={[]}
        validation={null}
        generationsChecksum={null}
      />,
    )
    expect(screen.getAllByText('QC Trend Analysis')).toHaveLength(1)
    expect(screen.getAllByText('RPT-2026-0002 · v1')).toHaveLength(1)
  })

  it('unwraps the text payload for text sections', () => {
    render(
      <ReportPreview
        report={report}
        sections={[
          section({
            frozenPayload: {
              text: 'Quarterly QC performance summary across all projects.',
            },
          }),
        ]}
        validation={null}
        generationsChecksum={null}
      />,
    )
    expect(
      screen.getByText('Quarterly QC performance summary across all projects.'),
    ).toBeTruthy()
    expect(screen.queryByText(/"text":/)).toBeNull()
  })

  it('keeps the frozen JSON view for structured sections', () => {
    render(
      <ReportPreview
        report={report}
        sections={[
          section({
            sectionType: 'table',
            sourceType: 'table_block',
            frozenPayload: { rows: [['a', 'b']] },
          }),
        ]}
        validation={null}
        generationsChecksum={null}
      />,
    )
    expect(screen.getByText(/"rows":/)).toBeTruthy()
  })
})
