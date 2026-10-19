import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StepDeviation } from './step-deviation'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  record: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))
vi.mock('#/lib/protocol-deviations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchStepDeviations: (...args: unknown[]) => mocks.fetch(...args),
  recordDeviationReason: (...args: unknown[]) => mocks.record(...args),
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign((...args: unknown[]) => mocks.toast(...args), {
    error: vi.fn(),
  }),
}))

afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())

const block = {
  id: '00000000-0000-4000-8000-000000000001',
  payload: {
    text: 'Hold 14 days',
    stepNumber: 1,
    sourceProtocolRevisionId: 'rev',
    sourceStepBlockId: 'step',
  },
}
const deviation = {
  id: '00000000-0000-4000-8000-000000000002',
  frozen_text: 'Hold 14 days',
  recorded_text: 'Hold 21 days',
  reason: null,
  reason_by_user_id: null,
}

function renderStep(
  save = vi.fn().mockResolvedValue({ ok: true }),
  readOnly = false,
  payload: Record<string, unknown> = block.payload,
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StepDeviation
        block={{ id: block.id, payload }}
        save={save}
        readOnly={readOnly}
      />
    </QueryClientProvider>,
  )
  return save
}

describe('StepDeviation', () => {
  it('renders nothing for a step that is not from a protocol', () => {
    mocks.fetch.mockResolvedValue([])
    renderStep(undefined, false, { text: 'free step' })
    expect(screen.queryByRole('button')).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('saves the new text, then attaches the reason to the deviation it created', async () => {
    const user = userEvent.setup()
    mocks.fetch.mockResolvedValueOnce([])
    mocks.fetch.mockResolvedValue([{ ...deviation }])
    mocks.record.mockResolvedValue({ ...deviation, reason: 'Fridge was down' })
    const save = renderStep()
    await user.click(
      await screen.findByRole('button', { name: 'Record a deviation' }),
    )
    const text = screen.getByLabelText(/What was done instead/)
    await user.clear(text)
    await user.type(text, 'Hold 21 days')
    await user.type(screen.getByLabelText(/^Why/), 'Fridge was down')
    await user.click(screen.getByRole('button', { name: 'Record deviation' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Hold 21 days', stepNumber: 1 }),
      ),
    )
    await waitFor(() =>
      expect(mocks.record).toHaveBeenCalledWith(
        expect.anything(),
        deviation.id,
        'Fridge was down',
      ),
    )
  })

  it('will not record a deviation whose text is unchanged', async () => {
    const user = userEvent.setup()
    mocks.fetch.mockResolvedValue([])
    renderStep()
    await user.click(
      await screen.findByRole('button', { name: 'Record a deviation' }),
    )
    await user.type(screen.getByLabelText(/^Why/), 'Because')
    expect(
      screen
        .getByRole('button', { name: 'Record deviation' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('asks for the missing reason on a deviation made without one', async () => {
    const user = userEvent.setup()
    mocks.fetch.mockResolvedValue([deviation])
    mocks.record.mockResolvedValue({ ...deviation, reason: 'Out of stock' })
    renderStep()
    expect(
      await screen.findByText(/differs from the protocol and has no reason/),
    ).toBeTruthy()
    await user.type(
      screen.getByLabelText(/Why was it done differently/),
      'Out of stock',
    )
    await user.click(screen.getByRole('button', { name: 'Record the reason' }))
    await waitFor(() =>
      expect(mocks.record).toHaveBeenCalledWith(
        expect.anything(),
        deviation.id,
        'Out of stock',
      ),
    )
  })

  it('shows the reason read-only once recorded, with no actions on a locked notebook', async () => {
    mocks.fetch.mockResolvedValue([
      { ...deviation, reason: 'Fridge was down', reason_by_user_id: 'sam' },
    ])
    renderStep(undefined, true)
    expect(await screen.findByText(/Why: Fridge was down \(sam\)/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
