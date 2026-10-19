import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'

import { ReleaseChecksPanel } from './release-checks-panel'

afterEach(cleanup)

function mount(result: unknown) {
  const rpc = vi.fn(async () => result)
  const client = { rpc } as unknown as DataClient
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <ReleaseChecksPanel sampleId="s-1" client={client} />
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
  return rpc
}

describe('ReleaseChecksPanel', () => {
  it('names each check, what is missing, and where to add it', async () => {
    const rpc = mount({
      passed: false,
      ruleCount: 2,
      failedCount: 1,
      checks: [
        {
          key: 'purity',
          label: 'Purity result',
          kind: 'measurement_required',
          passed: false,
          detail: 'measurement Purity is missing or outside the required range',
        },
        {
          key: 'no-fail',
          label: 'No failed QC',
          kind: 'no_result',
          passed: true,
          detail: null,
        },
      ],
    })
    expect(await screen.findByText('1 of 2 checks pass')).toBeTruthy()
    expect(rpc).toHaveBeenCalledWith('sample_release_check_status', {
      p_record_id: 's-1',
    })
    const items = screen.getAllByRole('listitem')
    expect(items[0].textContent).toContain('Purity result')
    expect(items[0].textContent).toContain('Not met')
    expect(items[0].textContent).toContain('Purity is missing')
    expect(items[1].textContent).toContain('Pass')
    expect(
      screen
        .getByRole('link', { name: 'Record a reading' })
        .getAttribute('href'),
    ).toContain('/readings/new')
    expect(screen.getByText(/Release stays blocked/)).toBeTruthy()
  })

  it('says the sample can be released when every check passes', async () => {
    mount({
      passed: true,
      ruleCount: 1,
      failedCount: 0,
      checks: [
        {
          key: 'a',
          label: 'Purity result',
          kind: 'measurement_required',
          passed: true,
          detail: null,
        },
      ],
    })
    expect(await screen.findByText('All checks pass')).toBeTruthy()
    expect(screen.getByText('This sample can be released.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Record a reading' })).toBeNull()
  })

  it('says so when no check applies', async () => {
    mount({ passed: true, ruleCount: 0, failedCount: 0, checks: [] })
    expect(
      await screen.findByText('No release checks apply to this sample type.'),
    ).toBeTruthy()
  })

  it('reports a failed read instead of showing nothing', async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new Error('down')
      }),
    } as unknown as DataClient
    const root = createRootRoute({
      component: () => (
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <ReleaseChecksPanel sampleId="s-1" client={client} />
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
    expect(
      await screen.findByText(/release checks could not be read/),
    ).toBeTruthy()
  })
})
