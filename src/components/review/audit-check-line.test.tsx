import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuditCheckLine } from './audit-check-line'

const mocks = vi.hoisted(() => ({ fetchStatus: vi.fn() }))

vi.mock('#/lib/audit-verification-status', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchAuditVerificationStatus: mocks.fetchStatus,
}))

afterEach(() => {
  cleanup()
  mocks.fetchStatus.mockReset()
})

function show(note?: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuditCheckLine note={note} />
    </QueryClientProvider>,
  )
}

const checked = {
  checkedAt: '2026-10-29T22:45:00Z',
  entriesChecked: 1656,
  signaturesChecked: 2,
  firstBadRevisionId: null,
}

describe('AuditCheckLine', () => {
  it('says when the signatures and audit trail were last found intact', async () => {
    mocks.fetchStatus.mockResolvedValue({ ...checked, ok: true })
    show('Bound to version 1.')
    await userEvent.hover(
      await screen.findByRole('button', { name: 'About these signatures' }),
    )
    expect(
      await screen.findByText(/verified intact, last checked/),
    ).toBeTruthy()
    expect(screen.getByText('Bound to version 1.')).toBeTruthy()
  })

  it('warns when the latest check failed', async () => {
    mocks.fetchStatus.mockResolvedValue({ ...checked, ok: false })
    show()
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /check of the signatures and audit trail failed/,
    )
  })

  it('does not claim a check that has not run', async () => {
    mocks.fetchStatus.mockResolvedValue(null)
    show()
    await userEvent.hover(
      await screen.findByRole('button', { name: 'About these signatures' }),
    )
    expect(await screen.findByText(/haven’t been checked yet/)).toBeTruthy()
  })

  it('says nothing when the status cannot be read', async () => {
    mocks.fetchStatus.mockRejectedValue(new Error('denied'))
    const { container } = render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AuditCheckLine />
      </QueryClientProvider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(container.textContent).toBe('')
  })
})
