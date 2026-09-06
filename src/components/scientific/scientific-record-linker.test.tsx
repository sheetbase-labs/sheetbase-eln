/**
 * SCI-001 ScientificRecordLinker component tests: open/close, search-driven
 * picker, link creation via the create_record_link RPC, error display, and
 * archived/unavailable summary rendering. The DataClient is mocked so no
 * PostgREST is required.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScientificRecordLinker } from './scientific-record-linker'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import type { NotebookLink } from '#/lib/notebook-data'

// jsdom polyfills for cmdk.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView = () => {}

function sampleWire(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    project_id: 'p-1',
    kind: 'sample',
    identifier: 'SMP-2026-0001',
    title: 'Virus stock A',
    status: 'available',
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'u-1',
    updated_by_user_id: null,
    properties: {},
    ...overrides,
  }
}

function mockClient(
  overrides: {
    list?: DataClient['list']
    rpc?: DataClient['rpc']
  } = {},
): DataClient {
  return {
    list: overrides.list ?? vi.fn().mockResolvedValue([]),
    rpc: overrides.rpc ?? vi.fn().mockResolvedValue({}),
    insert: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    remove: vi.fn().mockResolvedValue([]),
  }
}

function link(overrides: Partial<NotebookLink> = {}): NotebookLink {
  return {
    id: 'l-1',
    sourceRecordId: 'src-1',
    targetRecordId: 'r-1',
    targetKind: 'sample',
    targetIdentifier: 'SMP-2026-0001',
    linkType: 'sample',
    createdAt: '2026-01-01T00:00:00Z',
    createdByUserId: null,
    ...overrides,
  }
}

let queryClient: QueryClient

function mount(
  props: {
    client?: DataClient
    links?: NotebookLink[]
    onLinked?: () => void
  } = {},
) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ScientificRecordLinker
        sourceRecordId="src-1"
        links={props.links ?? []}
        client={props.client ?? mockClient()}
        onLinked={props.onLinked}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => cleanup())
beforeEach(() => {
  queryClient = new QueryClient()
})

describe('ScientificRecordLinker', () => {
  it('renders a collapsed "Link record" button by default', () => {
    mount()
    expect(screen.getByRole('button', { name: /link record/i })).toBeTruthy()
    // Picker is not mounted until opened.
    expect(screen.queryByPlaceholderText(/search samples/i)).toBeNull()
  })

  it('opens the picker on click and loads sample search results', async () => {
    const user = userEvent.setup()
    const list = vi.fn().mockResolvedValue([sampleWire()])
    mount({ client: mockClient({ list }) })
    await user.click(screen.getByRole('button', { name: /link record/i }))
    const input = await screen.findByPlaceholderText(
      /search samples by identifier or title/i,
    )
    expect(input).toBeTruthy()
    // The sample result is fetched and rendered.
    await waitFor(() => {
      expect(screen.getByText('Virus stock A')).toBeTruthy()
    })
  })

  it('creates a link via the create_record_link RPC with the protocol link type for protocols', async () => {
    const user = userEvent.setup()
    const list = vi.fn().mockResolvedValue([
      {
        ...sampleWire({
          id: 'r-proto',
          kind: 'protocol_template',
          identifier: 'PRT-2026-0001',
          title: 'Virus stability protocol',
          status: 'active',
        }),
      },
    ])
    const rpc = vi.fn().mockResolvedValue({})
    mount({ client: mockClient({ list, rpc }) })
    await user.click(screen.getByRole('button', { name: /link record/i }))
    // Switch to the Protocol kind tab.
    await user.click(screen.getByRole('tab', { name: 'Protocol' }))
    await screen.findByText('Virus stability protocol')
    await user.click(screen.getByText('Virus stability protocol'))
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('create_record_link', {
        p_source_record_id: 'src-1',
        p_target_kind: 'protocol_template',
        p_target_identifier: 'PRT-2026-0001',
        p_link_type: 'protocol',
        p_target_record_id: 'r-proto',
      })
    })
  })

  it('shows a friendly error when link creation fails', async () => {
    const user = userEvent.setup()
    const list = vi.fn().mockResolvedValue([sampleWire()])
    const rpc = vi
      .fn()
      .mockRejectedValue(
        new DataClientError('SB002', 'record link crosses workspaces', 422),
      )
    mount({ client: mockClient({ list, rpc }) })
    await user.click(screen.getByRole('button', { name: /link record/i }))
    await screen.findByText('Virus stock A')
    await user.click(screen.getByText('Virus stock A'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/record link crosses workspaces/i)).toBeTruthy()
  })

  it('says already linked when the server rejects a duplicate link', async () => {
    const user = userEvent.setup()
    const list = vi.fn().mockResolvedValue([sampleWire()])
    const rpc = vi
      .fn()
      .mockRejectedValue(
        new DataClientError(
          '23505',
          'duplicate key value violates unique constraint "uq_record_links_source_target_type"',
          409,
        ),
      )
    mount({ client: mockClient({ list, rpc }) })
    await user.click(screen.getByRole('button', { name: /link record/i }))
    await screen.findByText('Virus stock A')
    await user.click(screen.getByText('Virus stock A'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('This record is already linked.')).toBeTruthy()
  })

  it('renders an existing linked scientific record as a summary', async () => {
    const list = vi.fn().mockImplementation((resource: string) => {
      if (resource === 'record_field_definitions') return Promise.resolve([])
      // fetchRecordById
      return Promise.resolve([sampleWire()])
    })
    mount({
      client: mockClient({ list }),
      links: [link()],
    })
    await waitFor(() => {
      expect(screen.getByText('Virus stock A')).toBeTruthy()
    })
  })

  it('renders an unavailable note when a linked record cannot be resolved', async () => {
    const list = vi.fn().mockResolvedValue([])
    mount({
      client: mockClient({ list }),
      links: [
        link({ targetRecordId: 'missing', targetIdentifier: 'SMP-2026-0099' }),
      ],
    })
    await waitFor(() => {
      expect(screen.getByText(/SMP-2026-0099 — unavailable/i)).toBeTruthy()
    })
  })
})
