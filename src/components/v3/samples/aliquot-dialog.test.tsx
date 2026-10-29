import userEvent from '@testing-library/user-event'
import { choose } from '../../../../tests/unit/picker'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SampleRecord } from '#/lib/samples'

import { AliquotDialog, planAliquots } from './aliquot-dialog'
import type { AliquotDialogInput } from './aliquot-dialog'

afterEach(cleanup)

describe('planAliquots', () => {
  it('waits for both numbers before judging anything', () => {
    expect(planAliquots('', '20', 100, 'µL').error).toBeNull()
    expect(planAliquots('4', '', 100, 'µL').total).toBeNull()
  })

  it('totals the split and says what stays behind', () => {
    const plan = planAliquots('4', '20', 100, 'µL')
    expect(plan).toMatchObject({ total: 80, remaining: 20, error: null })
  })

  it('refuses a split that overdraws, naming both amounts', () => {
    const plan = planAliquots('6', '20', 100, 'µL')
    expect(plan.error).toBe('6 × 20 µL is 120 µL, but only 100 µL is free.')
  })

  it('refuses fractions, zero and more tubes than a step allows', () => {
    expect(planAliquots('2.5', '1', 100, null).error).toMatch(/whole number/)
    expect(planAliquots('0', '1', 100, null).error).toMatch(/whole number/)
    expect(planAliquots('97', '1', 1000, null).error).toMatch(/1 to 96/)
    expect(planAliquots('2', '0', 100, null).error).toMatch(/above zero/)
  })
})

const SAMPLE = {
  id: 's-1',
  identifier: 'SMP-1',
  title: 'Master stock',
  quantity: 100,
  quantityUnit: 'µL',
  storageLocation: 'Freezer 1',
}
const EXPERIMENTS = [{ id: 'e-1', identifier: 'EXP-1', title: 'Titration' }]
const BALANCES = {
  sampleRecordId: 's-1',
  unit: 'µL',
  current: 100,
  used: 0,
  reserved: 0,
  free: 100,
}

function mount(props: Partial<React.ComponentProps<typeof AliquotDialog>>) {
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <AliquotDialog
          open
          onOpenChange={() => {}}
          sample={SAMPLE}
          busy={false}
          onSubmit={() => {}}
          experiments={EXPERIMENTS}
          balances={BALANCES}
          {...props}
        />
      </QueryClientProvider>
    ),
  })
  render(
    <RouterProvider
      router={createRouter({
        routeTree: root,
        history: createMemoryHistory({ initialEntries: ['/'] }),
      })}
    />,
  )
}

describe('AliquotDialog', () => {
  it('submits the split for the chosen experiment with the shared location', async () => {
    const onSubmit = vi.fn<(input: AliquotDialogInput) => void>()
    mount({ onSubmit })
    fireEvent.change(await screen.findByLabelText(/Number of tubes/), {
      target: { value: '4' },
    })
    fireEvent.change(screen.getByLabelText(/Amount in each/), {
      target: { value: '20' },
    })
    expect(screen.getByRole('status').textContent).toContain(
      '80 µL in total; 20 µL stays in SMP-1.',
    )
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Make 4 tubes',
    })
    // The experiment is still to choose.
    expect(submit.disabled).toBe(true)
    await choose(userEvent.setup(), /For experiment/, /Titration/)
    fireEvent.change(screen.getByLabelText(/Store tubes at/), {
      target: { value: 'Freezer 1 / Box 3' },
    })
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith({
      count: 4,
      quantityEach: 20,
      purposeExperimentId: 'e-1',
      unit: 'µL',
      newContainer: { title: undefined, storageLocation: 'Freezer 1 / Box 3' },
    })
  })

  it('holds the button and says why when the tubes would overdraw', async () => {
    mount({})
    fireEvent.change(await screen.findByLabelText(/Number of tubes/), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText(/Amount in each/), {
      target: { value: '20' },
    })
    expect(screen.getByRole('alert').textContent).toContain(
      'but only 100 µL is free',
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Make 10 tubes' })
        .disabled,
    ).toBe(true)
  })

  it('lists the new tubes as links once made', async () => {
    const created = [
      { id: 't-1', identifier: 'SMP-2', title: 'Master stock aliquot 1 of 2' },
      { id: 't-2', identifier: 'SMP-3', title: 'Master stock aliquot 2 of 2' },
    ] as SampleRecord[]
    mount({ created })
    expect(await screen.findByText('Made 2 tubes from SMP-1')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'SMP-2' }).getAttribute('href'),
    ).toBe('/samples/t-1')
    expect(screen.getByRole('button', { name: /Print 2 labels/ })).toBeTruthy()
  })

  it('shows the refusal when no tubes were made', async () => {
    mount({ error: 'Only 50 µL available. Enter 50 or less.' })
    expect(await screen.findByText('No tubes were made')).toBeTruthy()
  })
})
