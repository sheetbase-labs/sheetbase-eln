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
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient, dropSharedReads } from '#/lib/data-client'
import type { RecordWire } from '#/lib/notebook-data'

import { ScanSampleActions } from './scan-sample-actions'

/** Which sample the fixture answers with; `null` is a sample that is gone. */
let sampleRow: RecordWire | null = null

const rpcCalls: { name: string; args: z.infer<ReturnType<typeof z.json>> }[] =
  []

const rpcArgs = z.record(z.string(), z.json())

/** Keep the compiled DataClient real; fixture only the HTTP it sends. */
const fixtureFetch: typeof fetch = async (input, init) => {
  const request = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  const { pathname } = new URL(request.url)

  if (request.method === 'POST' && pathname.startsWith('/api/db/rpc/')) {
    const name = pathname.slice('/api/db/rpc/'.length)

    rpcCalls.push({ name, args: rpcArgs.parse(await request.json()) })

    if (name === 'transfer_sample') return Response.json(sampleRow)

    if (name === 'sample_release_check_status') {
      return Response.json({
        passed: false,
        ruleCount: 1,
        failedCount: 1,
        checks: [
          {
            key: 'p',
            label: 'Purity result',
            kind: 'measurement_required',
            passed: false,
            detail: 'missing',
          },
        ],
      })
    }

    return Response.json({})
  }

  const { pathname: resource } = new URL(request.url)

  if (resource === '/api/db/records') {
    return Response.json(sampleRow ? [sampleRow] : [])
  }

  // Every storage-location table and position read starts empty.
  if (resource.startsWith('/api/db/')) return Response.json([])

  throw new Error(`Unexpected request: ${request.method} ${request.url}`)
}

vi.stubGlobal('fetch', fixtureFetch)

const client = createDataClient(fixtureFetch)

afterEach(() => {
  cleanup()
  dropSharedReads()
})

beforeEach(() => {
  rpcCalls.length = 0
  dropSharedReads()
  sampleRow = sampleWire()
})

function sampleWire(overrides: Partial<RecordWire> = {}): RecordWire {
  return {
    id: 's-1',
    workspace_id: 'ws-1',
    project_id: null,
    folder_id: null,
    kind: 'sample',
    identifier: 'SMP-1',
    title: 'Lysate',
    status: 'available',
    tags: [],
    structure_version: 1,
    metadata_version: 5,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'u-1',
    updated_by_user_id: null,
    properties: {
      quantity: 12.5,
      quantityUnit: 'mL',
      storageLocation: 'Freezer 1',
    },
    custom_fields: {},
    locked_at: null,
    locked_by_revision_id: null,
    ...overrides,
  }
}

function mount(opts: { sample?: RecordWire | null; onChanged?: () => void }) {
  const onChanged = opts.onChanged
  sampleRow = opts.sample === undefined ? sampleRow : opts.sample

  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <ScanSampleActions
          sampleId="s-1"
          returnTo="/scan?code=SMP-1"
          client={client}
          onChanged={onChanged}
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

describe('ScanSampleActions', () => {
  it('shows the quantity and place, and the three bench actions', async () => {
    mount({})
    expect(await screen.findByText('12.5 mL · Freezer 1')).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Withdraw' })
        .disabled,
    ).toBe(false)
    expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy()
    expect(screen.getByText('Record reading')).toBeTruthy()
  })

  it('moves the sample in place and tells the scan to refresh', async () => {
    const onChanged = vi.fn()
    mount({ onChanged })
    await screen.findByText('12.5 mL · Freezer 1')
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(await within(dialog).findByLabelText('Where is it?'), {
      target: { value: 'Bench' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    await waitFor(() =>
      expect(rpcCalls).toContainEqual({
        name: 'transfer_sample',
        args: {
          p_record_id: 's-1',
          p_to_location: 'Bench',
          p_expected_metadata_version: 5,
          p_notes: null,
        },
      }),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('holds Withdraw for a quarantined sample and says why', async () => {
    mount({ sample: sampleWire({ status: 'quarantined' }) })
    await screen.findByText('12.5 mL · Freezer 1')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Withdraw' })
        .disabled,
    ).toBe(true)
    expect(
      screen.getByText(
        /Withdraw is unavailable while this sample is quarantined/,
      ),
    ).toBeTruthy()
  })

  it('says the sample could not be read rather than showing dead buttons', async () => {
    mount({ sample: null })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
  })

  it('shows the live release checks for a quarantined sample only', async () => {
    mount({ sample: sampleWire({ status: 'quarantined' }) })
    expect(await screen.findByText('Purity result')).toBeTruthy()
    expect(screen.getByText('0 of 1 checks pass')).toBeTruthy()
  })
})
