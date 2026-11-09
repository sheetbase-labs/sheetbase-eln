import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BenchCalculatorDialog } from './bench-calculator-dialog'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('BenchCalculatorDialog', () => {
  // Unmount and let any scheduled React work run now, so none outlives the
  // test environment on a loaded runner.
  afterEach(async () => {
    cleanup()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('works out the mass to weigh out and inserts it with its workings', async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    renderWithClient(
      <BenchCalculatorDialog
        open
        onOpenChange={() => {}}
        onInsert={onInsert}
      />,
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Molecular weight (g/mol)' }),
      '58.44',
    )
    await user.type(screen.getByRole('textbox', { name: 'Volume' }), '500')
    await user.type(
      screen.getByRole('textbox', { name: 'Concentration' }),
      '150',
    )
    const result = await screen.findByRole('status', { name: 'Result' })
    expect(result.textContent).toContain('4.383 g')
    await user.click(
      screen.getByRole('button', { name: 'Insert into notebook' }),
    )
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({ value: 4.383, unit: 'g' }),
    )
  })

  it('gives the stock and diluent volumes for a dilution', async () => {
    const user = userEvent.setup()
    renderWithClient(<BenchCalculatorDialog open onOpenChange={() => {}} />)
    await user.click(screen.getByRole('tab', { name: 'Dilution' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Stock concentration' }),
      '10',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Final concentration' }),
      '1',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Final volume' }),
      '500',
    )
    expect(
      (await screen.findAllByRole('status'))
        .map((n) => n.textContent)
        .join(' '),
    ).toContain('Add 50 µL of stock to 450 µL of diluent.')
  })

  it('offers no insert action outside a notebook', async () => {
    renderWithClient(<BenchCalculatorDialog open onOpenChange={() => {}} />)
    // Let the dialog finish opening before the test ends, so no scheduled
    // update outlives the test environment.
    await screen.findByRole('tab', { name: 'Dilution' })
    expect(
      screen.queryByRole('button', { name: 'Insert into notebook' }),
    ).toBeNull()
  })
})
