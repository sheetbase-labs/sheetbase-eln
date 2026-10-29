import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import { choose } from '../../../../tests/unit/picker'

import { BulkRegisterDialog } from './bulk-register-dialog'

afterEach(cleanup)

const wire = (n: number, title: string) => ({
  id: `s-${n}`,
  identifier: `SMP-${n}`,
  title,
  kind: 'sample',
  status: 'available',
  properties: {},
  custom_fields: {},
  tags: [],
})

function mount(rpc: ReturnType<typeof vi.fn>, onRegistered = vi.fn()) {
  const client = {
    rpc,
    list: vi.fn(async () => []),
  } as unknown as DataClient
  const root = createRootRoute({
    component: () => (
      <BulkRegisterDialog
        open
        onOpenChange={() => {}}
        projects={[{ id: 'p-1', title: 'Gene therapy' }]}
        client={client}
        onRegistered={onRegistered}
      />
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { onRegistered }
}

describe('BulkRegisterDialog', () => {
  it('reads the pasted list, registers it in one call and names the result', async () => {
    const rpc = vi.fn(async () => [wire(1, 'Lysate A'), wire(2, 'Lysate B')])
    const { onRegistered } = mount(rpc)
    await screen.findByText('Register samples from a list')

    await choose(userEvent.setup(), /^Project/, /Gene therapy/)
    fireEvent.change(screen.getByLabelText(/^Samples/), {
      target: { value: 'Name\tQuantity\nLysate A\t500 µL\nLysate B\t1 mL' },
    })
    expect(screen.getByRole('status').textContent).toContain(
      '2 samples ready to register.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Register 2 samples' }))

    expect(await screen.findByText('Registered 2 samples')).toBeTruthy()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('register_samples', {
      p_project_id: 'p-1',
      p_samples: [
        expect.objectContaining({
          title: 'Lysate A',
          quantity: 500,
          quantityUnit: 'µL',
        }),
        expect.objectContaining({
          title: 'Lysate B',
          quantity: 1,
          quantityUnit: 'mL',
        }),
      ],
    })
    expect(onRegistered).toHaveBeenCalled()
    // Each new sample is a link to its page, and the labels are one action.
    expect(
      screen.getByRole('link', { name: 'SMP-1' }).getAttribute('href'),
    ).toBe('/samples/s-1')
    expect(screen.getByRole('button', { name: /Print 2 labels/ })).toBeTruthy()
  })

  it('names the unreadable line and holds the register button', async () => {
    const rpc = vi.fn()
    mount(rpc)
    await choose(userEvent.setup(), /^Project/, /Gene therapy/)
    fireEvent.change(screen.getByLabelText(/^Samples/), {
      target: { value: 'Name,Quantity\nGood,5 mL\nBad,lots' },
    })
    expect(screen.getByText('Fix these lines to continue')).toBeTruthy()
    expect(
      screen.getByText(/Line 3: Quantity "lots" is not a number\./),
    ).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /Register/ })
        .disabled,
    ).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says nothing was registered when the server refuses the list', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('boom')
    })
    mount(rpc)
    await choose(userEvent.setup(), /^Project/, /Gene therapy/)
    fireEvent.change(screen.getByLabelText(/^Samples/), {
      target: { value: 'One\nTwo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Register 2 samples' }))
    expect(await screen.findByText('Nothing was registered')).toBeTruthy()
  })
})
