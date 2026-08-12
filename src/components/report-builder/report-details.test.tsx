import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReportDetails } from './report-details'
import type { ReportDefinition } from '#/lib/report-builder'
import type { ModelFieldDefinition } from '#/lib/model-fields'

afterEach(cleanup)

const report: ReportDefinition = {
  id: 'report-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  recordId: 'record-1',
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

const field: ModelFieldDefinition = {
  id: 'field-1',
  modelKey: 'report',
  fieldName: 'programme',
  label: 'Programme',
  description: null,
  displayOrder: 1,
  logicalType: 'text',
  nullable: true,
  defaultValue: null,
  unit: null,
  validation: {},
  lifecycle: 'active',
  options: [],
}

describe('ReportDetails', () => {
  it('shows locked and workspace properties together and edits only the workspace value', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <ReportDetails
        report={report}
        generations={[]}
        validation={null}
        timeZone="UTC"
        modelFields={[field]}
        modelFieldValues={{
          customFields: { programme: 'Oncology' },
          metadataVersion: 1,
          locked: false,
        }}
        onSaveModelFields={onSave}
      />,
    )

    expect(screen.getByText('Stability report')).toBeTruthy()
    expect(screen.getByText('Oncology')).toBeTruthy()
    expect(screen.getAllByLabelText('Locked system property').length).toBe(7)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Stability report')).toBeTruthy()
    const programme = screen.getByRole('textbox', { name: 'Programme' })
    await user.clear(programme)
    await user.type(programme, 'Neurology')
    await user.click(screen.getByRole('button', { name: 'Save properties' }))

    expect(onSave).toHaveBeenCalledWith({ programme: 'Neurology' })
  })

  it('makes workspace properties visibly read-only when the report is locked', () => {
    render(
      <ReportDetails
        report={report}
        generations={[]}
        validation={null}
        timeZone="UTC"
        modelFields={[field]}
        modelFieldValues={{
          customFields: {},
          metadataVersion: 2,
          locked: true,
        }}
        onSaveModelFields={vi.fn()}
      />,
    )

    const edit = screen.getByRole('button', { name: 'Edit' })
    expect(edit.hasAttribute('disabled')).toBe(true)
    expect(edit.getAttribute('title')).toBe('This record is locked.')
    expect(screen.getByLabelText('Locked workspace property')).toBeTruthy()
  })
})
