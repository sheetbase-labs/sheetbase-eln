import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SectionEditor } from './section-editor'
import type { ReportSection } from '#/lib/report-builder'

const section: ReportSection = {
  id: 'section-1',
  workspaceId: 'workspace-1',
  reportId: 'report-1',
  position: 0,
  title: 'Executive Summary',
  description: 'Original summary',
  sectionType: 'text',
  sourceType: 'free_text',
  sourceRevisionId: null,
  sourceRef: {},
  frozenPayload: {},
  validationStatus: 'pending',
  validationDetail: {},
  createdAt: '2026-08-06T12:00:00Z',
  updatedAt: '2026-08-06T12:00:00Z',
  createdByUserId: 'user-1',
  updatedByUserId: 'user-1',
}

afterEach(() => cleanup())

describe('SectionEditor', () => {
  it('saves edited title, description, and section type', () => {
    const onSave = vi.fn()
    render(
      <SectionEditor
        section={section}
        isSaving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Study overview' },
    })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Updated summary of the stability study.' },
    })
    fireEvent.change(screen.getByLabelText('Section type'), {
      target: { value: 'table' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onSave).toHaveBeenCalledWith({
      title: 'Study overview',
      description: 'Updated summary of the stability study.',
      sectionType: 'table',
    })
  })

  it('shows the immutable source type for the selected section', () => {
    render(
      <SectionEditor
        section={section}
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    const sourceType = screen.getByLabelText('Source type')
    expect(sourceType.value).toBe('free_text')
    expect(sourceType.disabled).toBe(true)
  })
})
