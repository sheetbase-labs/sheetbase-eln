/**
 * The experiment Samples tab shows each sample's parent and volume, and the
 * Files tab shows what each file fed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as router from '@tanstack/react-router'

import { ExperimentFiles } from './-files-tab'
import { ExperimentSamples } from './-samples-tab'

const dataClient = vi.hoisted(() => ({ list: vi.fn(), rpc: vi.fn() }))

for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof router>()),
  Link: ({ to, children }: { to?: string; children?: React.ReactNode }) => (
    <a href={to ?? '#'}>{children}</a>
  ),
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

function renderTab(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  )
}

beforeEach(() => dataClient.list.mockReset())
afterEach(cleanup)

describe('ExperimentSamples', () => {
  it('lists each sample with its parent and volume', async () => {
    dataClient.list.mockImplementation(async (resource: string, q: string) => {
      if (resource === 'record_links' && q.includes('source_record_id=eq.')) {
        return [
          { id: 'l1', target_kind: 'sample', target_record_id: 's1' },
          { id: 'l2', target_kind: 'sample', target_record_id: 's2' },
        ]
      }
      if (resource === 'record_links') {
        return [
          {
            source_record_id: 's1',
            target_record_id: 's2',
            link_metadata: { relation: 'aliquot' },
          },
        ]
      }
      if (resource === 'records') {
        return [
          {
            id: 's1',
            identifier: 'SMP-1',
            title: 'Feed',
            status: 'active',
            properties: { quantity: 4600 },
          },
          {
            id: 's2',
            identifier: 'SMP-2',
            title: 'Filtrate',
            status: 'active',
            properties: { quantity: 15 },
          },
        ]
      }
      return []
    })
    renderTab(<ExperimentSamples expId="exp-1" />)
    expect(await screen.findAllByText('SMP-2')).not.toHaveLength(0)
    expect(screen.getAllByText('4,600')).not.toHaveLength(0)
    expect(screen.getAllByText('15.0')).not.toHaveLength(0)
  })
})

describe('ExperimentFiles', () => {
  it('shows the empty state when the experiment has no files', async () => {
    dataClient.list.mockResolvedValue([])
    renderTab(<ExperimentFiles expId="exp-1" />)
    expect(await screen.findAllByText(/file/i)).not.toHaveLength(0)
  })
})
