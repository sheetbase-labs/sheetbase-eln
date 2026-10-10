/**
 * GuidePanel tests (ASSIST-03). The panel is guidance display only: step
 * states, missing-prerequisite reasons, ASSIST-01 explanations where they
 * fit, and next actions. It never mutates — accept buttons only call the
 * host `onAccept` with the canonical accept key, navigation is plain links,
 * and assistance stays marked throughout.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  evaluateAnalysisToFigure,
  evaluateSubmissionReadiness,
} from '#/lib/assist-guide'

import { GuidePanel } from './guide-panel'

afterEach(cleanup)

describe('GuidePanel', () => {
  it('renders step states with blocked prerequisites named', () => {
    const workflow = evaluateAnalysisToFigure({
      datasetId: 'd1',
      columnCount: 0,
      rowCount: 0,
      compareConfigValid: false,
      chartSpecReady: false,
      embeddedBlockId: null,
    })
    render(<GuidePanel workflow={workflow} onAccept={() => {}} />)
    expect(screen.getByLabelText('Guide: Analysis to figure')).toBeTruthy()
    expect(
      screen.getAllByText(/Waiting on 'Dataset ready'/).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByLabelText(/Step 2: Compare configured \(Blocked\)/),
    ).toBeTruthy()
    expect(screen.getByText(/Guided workflow — assistance/)).toBeTruthy()
  })

  it('routes accept actions through onAccept and navigation through links, mutating nothing itself', () => {
    const workflow = evaluateAnalysisToFigure({
      datasetId: 'd1',
      columnCount: 3,
      rowCount: 10,
      compareConfigValid: true,
      chartSpecReady: false,
      embeddedBlockId: null,
    })
    const onAccept = vi.fn()
    render(<GuidePanel workflow={workflow} onAccept={onAccept} />)
    const propose = screen.getByRole('button', {
      name: 'Propose chart from compare config',
    })
    fireEvent.click(propose)
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onAccept).toHaveBeenCalledWith('promoteToChartSpec')
    const open = screen.getByRole('link', { name: 'Open chart configurator' })
    expect(open.getAttribute('href')).toBe('/datasets?dataset=d1')
  })

  it('renders ASSIST-01 explanations on the steps they fit', () => {
    const workflow = evaluateAnalysisToFigure({
      datasetId: 'd1',
      columnCount: 3,
      rowCount: 10,
      compareConfigValid: true,
      chartSpecReady: true,
      embeddedBlockId: null,
      recordId: 'r1',
      blockType: 'chart',
      blockErrors: [
        {
          code: 'missing_required_field',
          field: 'y',
          message: 'y is required',
        },
      ],
    })
    render(<GuidePanel workflow={workflow} onAccept={() => {}} />)
    expect(screen.getByText(/Why this chart block cannot save/)).toBeTruthy()
  })

  it('walks the submission workflow to the review actions', () => {
    const workflow = evaluateSubmissionReadiness({
      recordId: 'r1',
      hasUnsavedWork: false,
      archivedAt: null,
      lockedAt: null,
      activeReview: false,
      reviewerCount: 1,
      digest: 'abc123',
      digestPending: false,
      digestError: null,
      submissionId: 'sub-1',
      revisionId: 'rev-1',
      decision: null,
    })
    const onAccept = vi.fn()
    render(<GuidePanel workflow={workflow} onAccept={onAccept} />)
    expect(
      screen.getByLabelText(/Step 5: Review decided \(Current\)/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve review' }))
    expect(onAccept).toHaveBeenCalledWith('approveReview')
    expect(
      screen
        .getByRole('link', { name: 'Open review workspace' })
        .getAttribute('href'),
    ).toBe('/review/rev-1')
  })

  it('announces completion when every step is done', () => {
    const workflow = evaluateAnalysisToFigure({
      datasetId: 'd1',
      columnCount: 3,
      rowCount: 10,
      compareConfigValid: true,
      chartSpecReady: true,
      embeddedBlockId: 'b1',
    })
    render(<GuidePanel workflow={workflow} onAccept={() => {}} />)
    expect(screen.getByText(/Workflow complete/)).toBeTruthy()
  })
})
