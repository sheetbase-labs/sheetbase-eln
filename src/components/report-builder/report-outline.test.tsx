import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReportSection } from '#/lib/report-builder'
import { ReportOutline } from './report-outline'

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
  validationStatus: 'valid',
  validationDetail: {},
  createdAt: '2026-08-06T12:00:00Z',
  updatedAt: '2026-08-06T12:00:00Z',
  createdByUserId: 'user-1',
  updatedByUserId: 'user-1',
}

afterEach(() => cleanup())

describe('ReportOutline', () => {
  it('selects a clicked section and starts the add-section flow', () => {
    const onSelectSection = vi.fn()
    const onAddSection = vi.fn()
    render(
      <ReportOutline
        sections={[section]}
        selectedSectionId={null}
        onSelectSection={onSelectSection}
        onAddSection={onAddSection}
        onMoveSection={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Executive Summary section' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))

    expect(onSelectSection).toHaveBeenCalledWith(section.id)
    expect(onAddSection).toHaveBeenCalledOnce()
  })
})
