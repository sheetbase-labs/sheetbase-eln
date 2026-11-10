import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDataClient, onRowsChanged } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { choose } from '../../../tests/unit/picker'

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

function mount(
  rpc: (
    name: string | undefined,
    args: Parameters<DataClient['rpc']>[1],
  ) => Promise<ReturnType<typeof wire>[] | Response>,
  onRegistered: NonNullable<
    Parameters<typeof BulkRegisterDialog>[0]['onRegistered']
  > = vi.fn(),
) {
  const client = createDataClient(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (init?.method === 'POST') {
      const result = await rpc(
        url.pathname.split('/').at(-1),
        await new Request(url, init).json(),
      )

      return result instanceof Response ? result : Response.json(result)
    }

    return Response.json([])
  })

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

  it('keeps the source line identity when an earlier issue is repaired', async () => {
    mount(vi.fn())
    const input = await screen.findByLabelText(/^Samples/)
    fireEvent.change(input, {
      target: { value: 'Name,Quantity\nA,lots\nB,many' },
    })
    const second = screen.getByText(/Line 3: Quantity "many"/)
    fireEvent.change(input, {
      target: { value: 'Name,Quantity\nA,1 mL\nB,many' },
    })
    expect(screen.getByText(/Line 3: Quantity "many"/)).toBe(second)
    expect(screen.queryByText(/Line 2:/)).toBeNull()
  })

  it('preserves tiny quantities, zero, duplicates and per-line places', async () => {
    const rpc = vi.fn(async () => [wire(1, 'A'), wire(2, 'A')])
    const { onRegistered } = mount(rpc)
    await choose(userEvent.setup(), /^Project/, /Gene therapy/)
    fireEvent.change(screen.getByLabelText(/^Samples/), {
      target: {
        value: 'Name,Quantity,Location\nA,0.000001 µL,Freezer\nA,0 mg,',
      },
    })
    fireEvent.change(screen.getByLabelText(/Location for rows without one/), {
      target: { value: '  Bench  ' },
    })
    expect(screen.getByText('Some names repeat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Register 2 samples' }))
    await screen.findByText('Registered 2 samples')
    expect(rpc).toHaveBeenCalledWith('register_samples', {
      p_project_id: 'p-1',
      p_samples: [
        {
          title: 'A',
          quantity: 0.000001,
          quantityUnit: 'µL',
          storageLocation: 'Freezer',
        },
        {
          title: 'A',
          quantity: 0,
          quantityUnit: 'mg',
          storageLocation: 'Bench',
        },
      ],
    })
    expect(onRegistered).toHaveBeenCalledTimes(1)
  })

  it('leaves retry to the person and calls the refresh owner only after success', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ code: '42501', message: 'refused' }, { status: 403 }),
      )
      .mockResolvedValueOnce([wire(1, 'One')])

    const { onRegistered } = mount(rpc)
    await choose(userEvent.setup(), /^Project/, /Gene therapy/)
    fireEvent.change(screen.getByLabelText(/^Samples/), {
      target: { value: 'One' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Register 1 sample' }))
    await screen.findByText('Nothing was registered')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(onRegistered).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Register 1 sample' }))
    await screen.findByText('Registered 1 sample')
    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1))
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0])
  })

  it('keeps the native file filter without turning it into a validation policy', async () => {
    mount(vi.fn())
    const input = await screen.findByLabelText('Sample list file')
    expect(input.getAttribute('accept')).toBe(
      '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain',
    )
  })

  it('announces the canonical write before calling the registry refresh owner', async () => {
    const order: string[] = []

    const stop = onRowsChanged((path) => {
      if (path === '/rpc/register_samples') order.push('rows changed')
    })

    try {
      const rpc = vi.fn(async () => {
        order.push('request')

        return [wire(1, 'One')]
      })

      mount(
        rpc,
        vi.fn(() => order.push('registered')),
      )
      await choose(userEvent.setup(), /^Project/, /Gene therapy/)
      fireEvent.change(screen.getByLabelText(/^Samples/), {
        target: { value: 'One' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Register 1 sample' }))
      await screen.findByText('Registered 1 sample')
      expect(order).toEqual(['request', 'rows changed', 'registered'])
    } finally {
      stop()
    }
  })
})
