import { choose } from '../../../../tests/unit/picker'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { SampleQuantityBalances } from '#/lib/samples'

import {
  QuantityKeypad,
  ReserveDialog,
  WithdrawDialog,
  describeWithdrawError,
  parseQuantityInput,
  validateQuantity,
} from './withdraw-dialog'
import type {
  ExperimentOption,
  ReserveDialogInput,
  WithdrawDialogInput,
  WithdrawDialogProps,
} from './withdraw-dialog'

afterEach(cleanup)

const SAMPLE = {
  id: 's-1',
  identifier: 'SMP-2231',
  title: 'Harvest lot HL-0934',
  quantity: 4600,
  quantityUnit: 'mL',
}

const BALANCES: SampleQuantityBalances = {
  sampleRecordId: 's-1',
  unit: 'mL',
  current: 4600,
  used: 10400,
  reserved: 3000,
  free: 1600,
}

/** A sample whose unit is unknown: the balance is the only unit source. */
const NO_UNIT_SAMPLE = {
  id: 's-2',
  identifier: 'SMP-2232',
  title: 'Dry pellet lot',
  quantity: 40,
  quantityUnit: null,
}

const GRAM_BALANCES: SampleQuantityBalances = {
  sampleRecordId: 's-2',
  unit: 'g',
  current: 40,
  used: 10,
  reserved: 5,
  free: 35,
}

const EXPERIMENTS: ExperimentOption[] = [
  { id: 'exp-1', identifier: 'EXP-0145', title: '50 L confirmation run' },
]

function renderDialog(
  onSubmit: (input: WithdrawDialogInput) => void = vi.fn(),
  overrides: Partial<Pick<WithdrawDialogProps, 'sample' | 'balances'>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WithdrawDialog
        open
        onOpenChange={() => {}}
        sample={overrides.sample ?? SAMPLE}
        busy={false}
        onSubmit={onSubmit}
        experiments={EXPERIMENTS}
        balances={overrides.balances ?? BALANCES}
      />
    </QueryClientProvider>,
  )
}

describe('parseQuantityInput', () => {
  it('accepts plain and thousands-separated values', () => {
    expect(parseQuantityInput('3450')).toBe(3450)
    expect(parseQuantityInput('3,450')).toBe(3450)
    expect(parseQuantityInput('3.5')).toBe(3.5)
  })

  it('returns null for empty and non-numeric input', () => {
    expect(parseQuantityInput('')).toBeNull()
    expect(parseQuantityInput('abc')).toBeNull()
  })
})

describe('validateQuantity', () => {
  it('reports the available amount when the withdrawal overdraws', () => {
    const result = validateQuantity('5000', 4600, 'mL')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Only 4,600 mL left. Enter 4,600 or less.')
    expect(result.remainingAfter).toBe(-400)
  })

  it('allows an amount within the free balance and reports the remainder', () => {
    const result = validateQuantity('3450', 4600, 'mL')
    expect(result.valid).toBe(true)
    expect(result.error).toBeNull()
    expect(result.remainingAfter).toBe(1150)
  })

  it('uses the free wording for reservations', () => {
    expect(validateQuantity('5000', 4600, 'mL', 'free').error).toBe(
      'Only 4,600 mL free. Enter 4,600 or less.',
    )
  })

  it('is invalid for zero or negative amounts', () => {
    expect(validateQuantity('0', 4600, 'mL').valid).toBe(false)
    expect(validateQuantity('-1', 4600, 'mL').valid).toBe(false)
  })
})

describe('describeWithdrawError', () => {
  it('parses the server free amount into the correction message', () => {
    const error = new DataClientError(
      'SB006',
      'insufficient free quantity: available 2, reserved 0, withdrawing 5',
      400,
    )
    expect(describeWithdrawError(error, 'mL')).toBe(
      'Only 2 mL available. Enter 2 or less.',
    )
  })

  it('parses the consume available amount too', () => {
    const error = new DataClientError(
      'SB006',
      'insufficient quantity: have 2, consuming 5',
      400,
    )
    expect(describeWithdrawError(error, 'mL')).toBe(
      'Only 2 mL available. Enter 2 or less.',
    )
  })

  it('explains a concurrent edit', () => {
    const error = new DataClientError('SB001', 'metadata version mismatch', 409)
    expect(describeWithdrawError(error, 'mL')).toMatch(/edited by someone else/)
  })
})

describe('QuantityKeypad', () => {
  it('appends digits and a single decimal point, and backspaces', async () => {
    const onKey = vi.fn()
    const user = userEvent.setup()
    render(<QuantityKeypad onKey={onKey} />)
    await user.click(screen.getByRole('button', { name: '3' }))
    await user.click(screen.getByRole('button', { name: 'Backspace' }))
    expect(onKey).toHaveBeenNthCalledWith(1, '3')
    expect(onKey).toHaveBeenNthCalledWith(2, 'backspace')
  })
})

describe('WithdrawDialog', () => {
  it('shows the available amount and refuses an over-withdrawal inline', async () => {
    const user = userEvent.setup()
    renderDialog()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/1,600 mL available/)).toBeTruthy()

    await user.type(
      within(dialog).getByRole('textbox', { name: /Volume/ }),
      '2000',
    )
    expect(
      within(dialog).getByText('Only 1,600 mL left. Enter 1,600 or less.'),
    ).toBeTruthy()
    expect(
      within(dialog)
        .getByRole('button', { name: 'Withdraw' })
        .hasAttribute('disabled') ||
        within(dialog)
          .getByRole('button', { name: 'Withdraw' })
          .getAttribute('aria-disabled') === 'true',
    ).toBe(true)
  })

  it('submits quantity, unit, purpose, notes and the derived container', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderDialog(onSubmit)
    const dialog = screen.getByRole('dialog')

    await user.type(
      within(dialog).getByRole('textbox', { name: /Volume/ }),
      '1000',
    )
    await choose(user, /Purpose/, /EXP-0145/)
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Into/ }),
      'new',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: /New container label/ }),
      'Aliquot A',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: /Notes/ }),
      'Filter run',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }))

    expect(onSubmit).toHaveBeenCalledWith({
      quantity: 1000,
      unit: 'mL',
      purposeExperimentId: 'exp-1',
      notes: 'Filter run',
      newContainer: { title: 'Aliquot A' },
    })
  })

  it('keeps the purpose required', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderDialog(onSubmit)
    const dialog = screen.getByRole('dialog')
    await user.type(
      within(dialog).getByRole('textbox', { name: /Volume/ }),
      '100',
    )
    expect(
      within(dialog)
        .getByRole('button', { name: 'Withdraw' })
        .hasAttribute('disabled') ||
        within(dialog)
          .getByRole('button', { name: 'Withdraw' })
          .getAttribute('aria-disabled') === 'true',
    ).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('withdraws in the balance unit when the sample stores none', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderDialog(onSubmit, {
      sample: NO_UNIT_SAMPLE,
      balances: GRAM_BALANCES,
    })
    const dialog = screen.getByRole('dialog')
    const unit = within(dialog).getByRole<HTMLSelectElement>('combobox', {
      name: /Unit/,
    })
    expect(unit.value).toBe('g')
    expect(unit.disabled).toBe(true)

    await user.type(
      within(dialog).getByRole('textbox', { name: /Volume/ }),
      '5',
    )
    await choose(user, /Purpose/, /EXP-0145/)
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 5, unit: 'g' }),
    )
  })
})

function renderReserveDialog(
  onSubmit: (input: ReserveDialogInput) => void = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ReserveDialog
        open
        onOpenChange={() => {}}
        sample={SAMPLE}
        busy={false}
        onSubmit={onSubmit}
        experiments={EXPERIMENTS}
        balances={BALANCES}
      />
    </QueryClientProvider>,
  )
}

describe('ReserveDialog', () => {
  it('refuses a reservation above the free balance', async () => {
    const user = userEvent.setup()
    renderReserveDialog()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/1,600 mL free/)).toBeTruthy()
    await user.type(
      within(dialog).getByRole('textbox', { name: /Volume/ }),
      '2000',
    )
    expect(
      within(dialog).getByText('Only 1,600 mL free. Enter 1,600 or less.'),
    ).toBeTruthy()
    expect(
      within(dialog)
        .getByRole('button', { name: 'Reserve' })
        .hasAttribute('disabled') ||
        within(dialog)
          .getByRole('button', { name: 'Reserve' })
          .getAttribute('aria-disabled') === 'true',
    ).toBe(true)
  })

  it('submits the planned experiment, amount and notes', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    renderReserveDialog(onSubmit)
    const dialog = screen.getByRole('dialog')
    await user.type(
      within(dialog).getByRole('textbox', { name: /Volume/ }),
      '1000',
    )
    await choose(user, /For/, /EXP-0145/)
    await user.click(within(dialog).getByRole('button', { name: 'Reserve' }))
    expect(onSubmit).toHaveBeenCalledWith({
      experimentId: 'exp-1',
      quantity: 1000,
      unit: 'mL',
      planned: true,
      notes: undefined,
    })
  })
})
