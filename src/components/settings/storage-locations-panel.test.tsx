/**
 * Settings → Storage and labels, storage locations: the tree, what a person who
 * can only view sees, and the rule that a location holding samples stays put.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createDataClient, dropSharedReads } from '#/lib/data-client'
import { Toaster, toast } from '#/components/ui/sonner'

import { StorageLocationsPanel } from './storage-locations-panel'

afterEach(() => {
  toast.dismiss()
  cleanup()
  dropSharedReads()
})

const TABLES = {
  storage_sites: [
    { id: 's1', name: 'Cambridge lab', code: 'CAM', archived_at: null },
  ],
  storage_rooms: [
    { id: 'r1', site_id: 's1', name: 'Lab 2', code: 'L2', archived_at: null },
  ],
  storage_units: [
    {
      id: 'u1',
      room_id: 'r1',
      name: 'Freezer F-1',
      code: 'F-1',
      unit_type: 'freezer',
      temperature_min_c: '-85',
      temperature_max_c: '-75',
      archived_at: null,
    },
  ],
  storage_shelves: [
    {
      id: 'sh1',
      unit_id: 'u1',
      name: 'Shelf 1',
      position: 1,
      archived_at: null,
    },
  ],
  storage_racks: [
    {
      id: 'k1',
      shelf_id: 'sh1',
      name: 'Rack A',
      position: 1,
      archived_at: null,
    },
  ],
  storage_boxes: [
    {
      id: 'b1',
      rack_id: 'k1',
      name: 'Box 3',
      code: 'BX-3',
      rows: 9,
      cols: 9,
      archived_at: null,
    },
    {
      id: 'b2',
      rack_id: 'k1',
      name: 'Box 4',
      code: 'BX-4',
      rows: 9,
      cols: 9,
      archived_at: null,
    },
  ],
  storage_positions: [{ box_id: 'b1' }, { box_id: 'b1' }],
  records: [],
}

function client(empty = false) {
  const tables = new Map(Object.entries(TABLES))
  const bodySchema = z.json()
  const writes: { method: string; resource: string; query: string; body: z.infer<typeof bodySchema> }[] = []
  const unexpected: string[] = []

  const dataClient = createDataClient(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const resource = url.pathname.replace('/api/db/', '')
    const rows = tables.get(resource)
    const method = init?.method ?? 'GET'

    if (!rows || !['GET', 'POST', 'PATCH'].includes(method)) {
      unexpected.push(`${method} ${url}`)
      throw new Error(`Unexpected storage request: ${method} ${url}`)
    }

    if (method === 'GET') return Response.json(empty ? [] : rows)

    writes.push({ method, resource, query: url.search, body: bodySchema.parse(await new Response(init?.body).json()) })

    return Response.json(method === 'POST' ? [{}] : [])
  })

  return { dataClient, writes, unexpected }
}

function renderPanel(canManage: boolean, c = client()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StorageLocationsPanel
        workspaceId="ws"
        canManage={canManage}
        client={c.dataClient}
      />
      <Toaster />
    </QueryClientProvider>,
  )

  return c
}

describe('StorageLocationsPanel', () => {
  it('shows sites and rooms open, with the samples a freezer holds', async () => {
    renderPanel(true)
    expect(await screen.findByText('Cambridge lab')).toBeTruthy()
    expect(screen.getByText('Lab 2')).toBeTruthy()
    const freezer = screen.getByRole('treeitem', { name: /Freezer F-1/ })
    expect(freezer.textContent).toContain('2 samples')
    expect(freezer.textContent).toContain('Freezer')
  })

  it('opens a box to rename it, and refuses to archive one that holds samples', async () => {
    const user = userEvent.setup()
    const c = renderPanel(true)
    await screen.findByText('Cambridge lab')
    await user.click(screen.getByRole('button', { name: 'Expand Freezer F-1' }))
    await user.click(screen.getByRole('button', { name: 'Expand Shelf 1' }))
    await user.click(screen.getByRole('button', { name: 'Expand Rack A' }))
    await user.click(screen.getByRole('treeitem', { name: /Box 3/ }))

    const details = screen.getByRole('complementary', {
      name: 'Location details',
    })

    expect(details.textContent).toContain('2 samples stored here')

    const archive = screen.getByRole('button', {
      name: 'Archive box',
    })

    expect(archive.matches(':disabled')).toBe(true)
    expect(details.textContent).toContain('can’t be archived')

    await user.click(screen.getByRole('treeitem', { name: /Box 4/ }))

    const empty = screen.getByRole('button', {
      name: 'Archive box',
    })

    expect(empty.matches(':disabled')).toBe(false)
    await user.click(empty)
    await waitFor(() =>
      expect(c.writes).toEqual([{
        method: 'PATCH', resource: 'storage_boxes', query: '?id=eq.b2',
        body: { archived_at: expect.any(String) },
      }]),
    )
    expect(c.unexpected).toEqual([])
  })

  it('adds a freezer under a room', async () => {
    const user = userEvent.setup()
    const c = renderPanel(true)
    await user.click(await screen.findByRole('treeitem', { name: /Lab 2/ }))
    await user.click(screen.getByRole('button', { name: 'Add unit' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Name/), 'Freezer F-9')
    expect(within(dialog).getByLabelText<HTMLInputElement>(/Code/).value).toBe(
      'FREEZER-F-9',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Add unit' }))
    await waitFor(() =>
      expect(c.writes).toEqual([{
        method: 'POST', resource: 'storage_units', query: '',
        body: expect.objectContaining({
          room_id: 'r1',
          name: 'Freezer F-9',
          unit_type: 'freezer',
        }),
      }]),
    )
    expect(c.unexpected).toEqual([])
  })

  it('is read-only without manage access', async () => {
    const user = userEvent.setup()
    renderPanel(false)
    await user.click(await screen.findByRole('treeitem', { name: /Lab 2/ }))
    expect(screen.queryByRole('button', { name: 'New site' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByLabelText('Name').matches(':disabled')).toBe(true)
  })

  it('explains an empty workspace', async () => {
    renderPanel(true, client(true))
    expect(await screen.findByText('No storage locations yet')).toBeTruthy()
  })
})
