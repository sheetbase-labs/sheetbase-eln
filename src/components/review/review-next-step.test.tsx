import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReviewNextStepPanel } from './review-next-step'
import type * as WorkItemsData from '#/lib/work-items/data'
import type { WorkItem } from '#/lib/work-items/data'

const { work } = vi.hoisted(() => ({
  work: { data: undefined as WorkItem[] | undefined, isSuccess: true },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children?: React.ReactNode
    to?: string
    params?: { revisionId?: string }
  }) => (
    <a href={(to ?? '#').replace('$revisionId', params?.revisionId ?? '')}>
      {children}
    </a>
  ),
}))
vi.mock('#/lib/reviews', () => ({ reviewsDataClient: {} }))
vi.mock('#/lib/work-items/data', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkItemsData>()),
  useWorkItems: () => work,
}))

afterEach(() => {
  cleanup()
  work.data = undefined
  work.isSuccess = true
})

const step = { headline: 'Waiting for your decision', detail: 'Approve it.' }

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewNextStepPanel step={step} currentRevisionId="rev-now" />
    </QueryClientProvider>,
  )
}

function review(revisionId: string, identifier: string): WorkItem {
  return {
    kind: 'review_requested',
    recordId: 'r',
    identifier,
    title: 'T',
    projectId: null,
    reason: '',
    dueAt: null,
    state: 'needs_action',
    createdAt: null,
    revisionId,
  }
}

describe('ReviewNextStepPanel', () => {
  it('states what happens next', () => {
    work.data = []
    renderPanel()
    expect(screen.getByText('Waiting for your decision')).toBeTruthy()
    expect(screen.getByText('Approve it.')).toBeTruthy()
  })

  it('offers the next review waiting, and not the one on screen', () => {
    work.data = [review('rev-now', 'EXP-1'), review('rev-next', 'EXP-2')]
    renderPanel()
    const link = screen.getByRole('link', { name: 'Next review: EXP-2' })
    expect(link.getAttribute('href')).toBe('/review/rev-next')
  })

  it('says so when nothing else is waiting', () => {
    work.data = [review('rev-now', 'EXP-1')]
    renderPanel()
    expect(screen.queryByRole('link', { name: /Next review/ })).toBeNull()
    expect(screen.getByText('No other reviews waiting for you')).toBeTruthy()
  })
})
