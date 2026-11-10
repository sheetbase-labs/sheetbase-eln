import userEvent from '@testing-library/user-event'
import { choose } from '../../../tests/unit/picker'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PoolSamplesResult } from '#/lib/samples'

import { PoolDialog } from './pool-dialog'
import type { PoolDialogInput } from './pool-dialog'
import { planPool } from './quantity-plans'
import type { PoolRow } from './quantity-plans'
import { quantitySample, quantityTestClients } from './quantity-test-fixtures'

afterEach(cleanup)

const row = (patch: Partial<PoolRow>): PoolRow => ({
  id: 's-1',
  identifier: 'SMP-1',
  title: 'Lysate A',
  free: 500,
  unit: 'µL',
  metadataVersion: 1,
  take: '',
  ...patch,
})

describe('planPool', () => {
  it('waits for every amount before judging', () => {
    const plan = planPool([row({ take: '100' }), row({ id: 's-2', take: '' })])
    expect(plan).toMatchObject({ total: null, error: null })
  })

  it('totals the amounts in the shared unit', () => {
    const plan = planPool([
      row({ take: '100' }),
      row({ id: 's-2', identifier: 'SMP-2', take: '50.5' }),
    ])

    expect(plan).toMatchObject({ total: 150.5, unit: 'µL', error: null })
  })

  it('names the sample that would be overdrawn', () => {
    const plan = planPool([
      row({ take: '100' }),
      row({ id: 's-2', identifier: 'SMP-2', free: 20, take: '30' }),
    ])

    expect(plan.error).toBe('SMP-2 has only 20 µL free; take 20 µL or less.')
  })

  it('refuses mixed units, zero and a pool of one', () => {
    expect(
      planPool([row({ take: '1' }), row({ id: 's-2', unit: 'mL', take: '1' })])
        .error,
    ).toMatch(/different units \(µL, mL\)/)
    expect(
      planPool([row({ take: '0' }), row({ id: 's-2', take: '1' })]).error,
    ).toMatch(/above zero/)
    expect(planPool([row({ take: '5' })]).error).toMatch(/at least one more/)
  })

  it('keeps row order, ignores absent units and retains the existing tolerance', () => {
    expect(
      planPool([
        row({ take: '0x10', unit: null }),
        row({ id: 's-2', take: '1e-12' }),
      ]),
    ).toMatchObject({
      amounts: [16, 1e-12],
      total: 16 + 1e-12,
      unit: 'µL',
      error: null,
    })
    expect(
      planPool([
        row({ take: '0.1', free: 0.1 - 5e-10 }),
        row({ take: '0.2', unit: '' }),
      ]).error,
    ).toBeNull()
    expect(
      planPool([row({ take: '0.1', free: 0.1 - 2e-9 }), row({ take: '0.2' })])
        .error,
    ).not.toBeNull()
  })

  it('preserves first-refusal order and native overflowing totals', () => {
    expect(planPool([row({ take: '' }), row({ take: '-1' })])).toMatchObject({
      total: null,
      error: null,
    })
    expect(planPool([row({ take: '-1' }), row({ take: '' })]).error).toMatch(
      /above zero/,
    )
    expect(
      planPool([
        row({ take: '1e308', free: null }),
        row({ take: '1e308', free: null }),
      ]),
    ).toMatchObject({ amounts: [1e308, 1e308], total: Infinity, error: null })
  })
})

const SAMPLE = {
  id: 's-1',
  identifier: 'SMP-1',
  title: 'Lysate A',
  quantity: 500,
  quantityUnit: 'µL',
  storageLocation: 'Freezer 1',
  metadataVersion: 3,
}

const OTHER = row({
  id: 's-2',
  identifier: 'SMP-2',
  title: 'Lysate B',
  free: 300,
  metadataVersion: 7,
})

const EXPERIMENTS = [{ id: 'e-1', identifier: 'EXP-1', title: 'Titration' }]

const BALANCES = {
  sampleRecordId: 's-1',
  unit: 'µL',
  current: 500,
  used: 0,
  reserved: 0,
  free: 500,
}

async function mount(props: Partial<React.ComponentProps<typeof PoolDialog>>) {
  const { client, queryClient } = await quantityTestClients()

  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <PoolDialog
          open
          client={client}
          onOpenChange={() => {}}
          sample={SAMPLE}
          busy={false}
          onSubmit={() => {}}
          experiments={EXPERIMENTS}
          balances={BALANCES}
          initialRows={[OTHER]}
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

describe('PoolDialog', () => {
  it('keeps source identity, order and metadata versions for native numeric spellings', async () => {
    const onSubmit = vi.fn<(input: PoolDialogInput) => void>()
    await mount({ onSubmit, defaultExperimentId: 'e-1' })
    fireEvent.change(
      await screen.findByLabelText('Amount to take from SMP-1'),
      { target: { value: '0x10' } },
    )
    fireEvent.change(screen.getByLabelText('Amount to take from SMP-2'), {
      target: { value: '1e-12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pool samples' }))
    expect(onSubmit).toHaveBeenCalledWith({
      sources: [
        { recordId: 's-1', quantity: 16, expectedMetadataVersion: 3 },
        { recordId: 's-2', quantity: 1e-12, expectedMetadataVersion: 7 },
      ],
      purposeExperimentId: 'e-1',
      unit: 'µL',
      newContainer: { title: undefined, storageLocation: undefined },
      place: undefined,
    })
  })

  it('does not submit a valid plan while busy', async () => {
    const onSubmit = vi.fn<(input: PoolDialogInput) => void>()
    await mount({ onSubmit, defaultExperimentId: 'e-1', busy: true })
    fireEvent.change(
      await screen.findByLabelText('Amount to take from SMP-1'),
      { target: { value: '10' } },
    )
    fireEvent.change(screen.getByLabelText('Amount to take from SMP-2'), {
      target: { value: '20' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pooling…' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits an amount per sample for the chosen experiment', async () => {
    const onSubmit = vi.fn<(input: PoolDialogInput) => void>()
    await mount({ onSubmit })
    fireEvent.change(
      await screen.findByLabelText('Amount to take from SMP-1'),
      {
        target: { value: '200' },
      },
    )
    fireEvent.change(screen.getByLabelText('Amount to take from SMP-2'), {
      target: { value: '100' },
    })
    expect(screen.getByRole('status').textContent).toContain(
      'The pool will hold 300 µL.',
    )

    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Pool samples',
    })

    expect(submit.disabled).toBe(true)
    await choose(userEvent.setup(), /For experiment/, /Titration/)
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: 'Lysate pool' },
    })
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith({
      sources: [
        { recordId: 's-1', quantity: 200, expectedMetadataVersion: 3 },
        { recordId: 's-2', quantity: 100, expectedMetadataVersion: 7 },
      ],
      purposeExperimentId: 'e-1',
      unit: 'µL',
      newContainer: { title: 'Lysate pool', storageLocation: undefined },
      place: undefined,
    })
  })

  it('holds the button and says why when a sample would be overdrawn', async () => {
    await mount({})
    fireEvent.change(
      await screen.findByLabelText('Amount to take from SMP-1'),
      {
        target: { value: '100' },
      },
    )
    fireEvent.change(screen.getByLabelText('Amount to take from SMP-2'), {
      target: { value: '400' },
    })
    expect(screen.getByRole('alert').textContent).toContain(
      'SMP-2 has only 300 µL free',
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pool samples' })
        .disabled,
    ).toBe(true)
  })

  it('drops a sample from the pool', async () => {
    await mount({})
    fireEvent.click(await screen.findByRole('button', { name: 'Remove SMP-2' }))
    expect(screen.queryByLabelText('Amount to take from SMP-2')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('at least one more')
  })

  it('links the new pool once made', async () => {
    const created: PoolSamplesResult = {
      pool: quantitySample({
        id: 'p-1',
        identifier: 'SMP-9',
        title: 'Lysate pool',
        properties: { quantity: 300, quantityUnit: 'µL' },
      }),
      sources: [
        quantitySample({ identifier: 'SMP-1' }),
        quantitySample({ identifier: 'SMP-2' }),
      ],
    }

    await mount({ created })
    expect(await screen.findByText('Made SMP-9')).toBeTruthy()
    expect(screen.getByText('Pooled from SMP-1, SMP-2.')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'SMP-9' }).getAttribute('href'),
    ).toBe('/samples/p-1')
  })

  it('shows the refusal when no pool was made', async () => {
    await mount({ error: 'Only 50 µL available.' })
    expect(await screen.findByText('The pool was not made')).toBeTruthy()
  })
})
