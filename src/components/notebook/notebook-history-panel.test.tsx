import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatDate } from '#/lib/notebook-data'
import type { RevisionWire } from '#/lib/notebook-data'

import { NotebookHistoryPanel } from './notebook-history-panel'

vi.mock('#/lib/notebook-experience', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRecordTimeline: vi.fn(),
  fetchRevisionsForRecord: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    search?: { revision?: string }
    children?: ReactNode
    [key: string]: unknown
  }) => {
    let href = to
      .replace('$projectId', params?.projectId ?? '')
      .replace('$recordId', params?.recordId ?? '')
    if (search?.revision) href += `?revision=${search.revision}`
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPanel(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const revision: RevisionWire = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  record_id: 'r1',
  structure_version: 1,
  metadata_version: 1,
  metadata_snapshot: {},
  block_snapshot: [],
  reason: 'submit',
  superseded_by_revision_id: null,
  created_at: '2026-07-18T12:00:00.000Z',
  created_by_user_id: 'u1',
}

describe('NotebookHistoryPanel', () => {
  it('renders submitted revisions as experiment links', async () => {
    const { fetchRecordTimeline, fetchRevisionsForRecord } = await import(
      '#/lib/notebook-experience'
    )
    vi.mocked(fetchRecordTimeline).mockResolvedValue([])
    vi.mocked(fetchRevisionsForRecord).mockResolvedValue([revision])
    renderPanel(
      <NotebookHistoryPanel
        recordId="r1"
        currentUserId="u1"
        currentUserName="Ada"
        projectId="p1"
      />,
    )
    const link = await screen.findByRole('link', {
      name: new RegExp(`Submitted ${formatDate(revision.created_at)}`),
    })
    expect(link.getAttribute('href')).toBe(
      '/projects/p1/experiments/r1?revision=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )
    expect(screen.getByText('aaaaaaaa')).toBeTruthy()
  })

  it('calls onSelectRevision when no projectId is provided', async () => {
    const { fetchRecordTimeline, fetchRevisionsForRecord } = await import(
      '#/lib/notebook-experience'
    )
    vi.mocked(fetchRecordTimeline).mockResolvedValue([])
    vi.mocked(fetchRevisionsForRecord).mockResolvedValue([revision])
    const onSelectRevision = vi.fn()
    const user = userEvent.setup()
    renderPanel(
      <NotebookHistoryPanel
        recordId="r1"
        currentUserId="u1"
        currentUserName="Ada"
        onSelectRevision={onSelectRevision}
      />,
    )
    await user.click(
      await screen.findByRole('button', {
        name: new RegExp(`Submitted ${formatDate(revision.created_at)}`),
      }),
    )
    expect(onSelectRevision).toHaveBeenCalledWith(revision.id)
  })
})
