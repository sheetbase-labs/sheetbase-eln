import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InstrumentGateSetting } from './instrument-gate-setting'
import { setInstrumentGateMode } from '#/lib/instrument-gate'
import type * as instrumentGateModule from '#/lib/instrument-gate'

vi.mock('#/components/v3/ui/sonner', () => ({ toast: vi.fn() }))
vi.mock('#/lib/instrument-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof instrumentGateModule>()
  return {
    ...actual,
    useInstrumentGateMode: () => 'warn' as const,
    setInstrumentGateMode: vi.fn(async () => {}),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderSetting(canManage: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <InstrumentGateSetting workspaceId="ws-1" canManage={canManage} />
    </QueryClientProvider>,
  )
}

describe('InstrumentGateSetting', () => {
  it('shows the current rule and saves a different one', async () => {
    const user = userEvent.setup()
    renderSetting(true)
    const select = screen.getByLabelText<HTMLSelectElement>(
      'When an instrument isn’t ready',
    )
    expect(select.value).toBe('warn')
    expect(screen.getByText(/marked with what was wrong/)).toBeTruthy()

    await user.selectOptions(select, 'block')

    await waitFor(() =>
      expect(setInstrumentGateMode).toHaveBeenCalledWith('ws-1', 'block'),
    )
    expect(select.value).toBe('block')
  })

  it('is read-only for someone who cannot manage instruments', () => {
    renderSetting(false)
    expect(
      screen.getByLabelText<HTMLSelectElement>('When an instrument isn’t ready')
        .disabled,
    ).toBe(true)
  })
})
