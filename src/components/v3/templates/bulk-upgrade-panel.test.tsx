import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BulkUpgradePanel } from './bulk-upgrade-panel'

const mocks = vi.hoisted(() => ({ upgrade: vi.fn(), toast: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock('#/lib/notebook-template-data', () => ({
  notebookTemplateDataClient: {},
}))
vi.mock('#/lib/notebook-template-bulk-upgrade', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  upgradeNotebooksInBulk: (...args: unknown[]) => mocks.upgrade(...args),
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign((...args: unknown[]) => mocks.toast(...args), {
    error: vi.fn(),
  }),
}))

afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())

const notebooks = [
  { id: 'n1', identifier: 'EXP-1', locked_at: null },
  { id: 'n2', identifier: 'EXP-2', locked_at: null },
  { id: 'n3', identifier: 'EXP-3', locked_at: '2026-09-01T00:00:00Z' },
]

describe('BulkUpgradePanel', () => {
  it('updates in one pass and lists what it left, with a Review link for decisions', async () => {
    const user = userEvent.setup()
    mocks.upgrade.mockResolvedValue([
      { notebook: notebooks[0], outcome: { kind: 'updated' } },
      {
        notebook: notebooks[1],
        outcome: { kind: 'needs-decision', conflicts: 1 },
      },
      { notebook: notebooks[2], outcome: { kind: 'signed' } },
    ])
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BulkUpgradePanel
          templateId="t1"
          targetVersion={3}
          targetVersionId="v3"
          notebooks={notebooks}
        />
      </QueryClientProvider>,
    )
    expect(
      screen.getByText(/Update 3 notebooks to v3 in one pass/),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Update all to v3' }))
    await waitFor(() => expect(mocks.upgrade).toHaveBeenCalled())
    expect(
      await screen.findByText('Needs your decision on 1 sheet'),
    ).toBeTruthy()
    expect(screen.getByText(/Signed: amend it first/)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Review v3' })).toHaveLength(1)
    expect(screen.queryByText('EXP-1')).toBeNull()
    expect(mocks.toast.mock.calls[0]?.[0]).toBe(
      '1 of 3 notebooks updated to v3',
    )
  })
})
