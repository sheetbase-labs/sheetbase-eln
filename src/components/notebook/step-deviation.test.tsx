import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dropSharedReads } from '#/lib/data-client'
import type { ProtocolDeviation } from '#/lib/protocol-deviations'
import type { NotebookBlock } from '#/lib/notebook-data'

import { StepDeviation } from './step-deviation'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

let rows: ProtocolDeviation[] = []
let reason = ''

afterEach(cleanup)

beforeEach(() => {
  dropSharedReads()
  rows = []
  reason = ''
  transport.mockReset()
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (url.pathname === '/api/db/protocol_deviations')
      return Response.json(rows)

    if (url.pathname === '/api/db/rpc/record_protocol_deviation_reason') {
      rows = [{ ...deviation, reason }]

      return Response.json(rows[0])
    }

    throw new Error(`Unexpected request: ${url.pathname}`)
  })
})

const block = {
  id: '00000000-0000-4000-8000-000000000001',
  payload: {
    text: 'Hold 14 days',
    stepNumber: 1,
    sourceProtocolRevisionId: 'rev',
    sourceStepBlockId: 'step',
  },
}

const deviation: ProtocolDeviation = {
  id: '00000000-0000-4000-8000-000000000002',
  frozen_text: 'Hold 14 days',
  recorded_text: 'Hold 21 days',
  reason: null,
  reason_by_user_id: null,
  record_id: '00000000-0000-4000-8000-000000000003',
  block_id: block.id,
  protocol_version_id: null,
  reason_at: null,
  created_by_user_id: 'sam',
  created_at: '2026-11-09T00:00:00Z',
}

function renderStep(
  save = vi.fn().mockResolvedValue({ ok: true }),
  readOnly = false,
  payload: NotebookBlock['payload'] = block.payload,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData(['user-names', ['sam']], { sam: 'sam' })
  render(
    <QueryClientProvider client={client}>
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
    rows = []
    renderStep(undefined, false, { text: 'free step' })
    expect(screen.queryByRole('button')).toBeNull()
    expect(transport).not.toHaveBeenCalled()
  })

  it('saves the new text, then attaches the reason to the deviation it created', async () => {
    const user = userEvent.setup()
    reason = 'Fridge was down'

    const save = renderStep(
      vi.fn(async () => {
        rows = [deviation]
        dropSharedReads()

        return { ok: true }
      }),
    )

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
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/record_protocol_deviation_reason',
        expect.objectContaining({
          body: JSON.stringify({
            p_deviation_id: deviation.id,
            p_reason: 'Fridge was down',
          }),
        }),
      ),
    )
  })

  it('will not record a deviation whose text is unchanged', async () => {
    const user = userEvent.setup()
    rows = []
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
    rows = [deviation]
    reason = 'Out of stock'
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
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/record_protocol_deviation_reason',
        expect.objectContaining({
          body: JSON.stringify({
            p_deviation_id: deviation.id,
            p_reason: 'Out of stock',
          }),
        }),
      ),
    )
  })

  it('shows the reason read-only once recorded, with no actions on a locked notebook', async () => {
    rows = [
      { ...deviation, reason: 'Fridge was down', reason_by_user_id: 'sam' },
    ]
    renderStep(undefined, true)
    expect(await screen.findByText(/Why: Fridge was down \(sam\)/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
