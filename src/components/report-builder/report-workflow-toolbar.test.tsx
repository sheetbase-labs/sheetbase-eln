import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReportWorkflowToolbar } from './report-workflow-toolbar'
import type { ReportDefinition, ValidationSummary } from '#/lib/report-builder'

const report: ReportDefinition = {
  id: 'report-1',
  workspaceId: 'workspace-1',
  projectId: null,
  recordId: null,
  templateRecordId: null,
  reviewSubmissionId: null,
  title: 'Stability report',
  subtitle: null,
  documentIdentifier: 'RPT-2026-0001',
  status: 'draft',
  version: 1,
  lastSavedAt: '2026-08-06T12:00:00Z',
  createdAt: '2026-08-06T12:00:00Z',
  updatedAt: '2026-08-06T12:00:00Z',
  createdByUserId: 'user-1',
  updatedByUserId: 'user-1',
}

const readyValidation: ValidationSummary = {
  reportId: report.id,
  sections: 2,
  valid: 2,
  missingSource: 0,
  stale: 0,
  locked: 0,
  ready: true,
}

afterEach(() => cleanup())

describe('ReportWorkflowToolbar', () => {
  it('requires validation before HTML export is enabled', () => {
    render(
      <ReportWorkflowToolbar
        report={report}
        validation={null}
        isValidating={false}
        isExporting={false}
        onValidate={vi.fn()}
        onExport={vi.fn()}
      />,
    )

    expect(screen.getByText('1. Build')).toBeTruthy()
    expect(screen.getByText('2. Validate')).toBeTruthy()
    expect(screen.getByText('3. Export')).toBeTruthy()
    const exportButton = screen.getByRole('button', { name: 'Export HTML' })
    expect(exportButton.hasAttribute('disabled')).toBe(true)
    expect(exportButton.getAttribute('title')).toBe(
      'Validate sources before exporting.',
    )
  })

  it('enables export and calls its action after ready validation', () => {
    const onExport = vi.fn()
    const onValidate = vi.fn()
    render(
      <ReportWorkflowToolbar
        report={report}
        validation={readyValidation}
        isValidating={false}
        isExporting={false}
        onValidate={onValidate}
        onExport={onExport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Validate sources' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export HTML' }))
    expect(onValidate).toHaveBeenCalledOnce()
    expect(onExport).toHaveBeenCalledOnce()
  })
})
