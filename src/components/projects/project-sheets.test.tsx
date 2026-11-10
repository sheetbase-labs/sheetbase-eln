import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient, dropSharedReads } from '#/lib/data-client'
import type { SheetInstanceWire } from '#/lib/sheet-instance-data'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const SHEET = '33333333-3333-4333-8333-333333333333'
const OTHER_SHEET = '44444444-4444-4444-8444-444444444444'

const rpcArgs = z.record(z.string(), z.json())

interface SheetFixtures {
  sheets: SheetInstanceWire[]
  calls: { name: string; args: z.infer<ReturnType<typeof z.json>> }[]
}

/** The stored sheet rows, and every RPC the tab sends. */
const fixtures: SheetFixtures = { sheets: [], calls: [] }

/** Keep the compiled DataClient real; fixture only the HTTP it sends. */
const fixtureFetch: typeof fetch = async (input, init) => {
  const request = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  const { pathname, searchParams } = new URL(request.url)

  if (request.method === 'POST' && pathname.startsWith('/api/db/rpc/')) {
    const name = pathname.slice('/api/db/rpc/'.length)

    fixtures.calls.push({ name, args: rpcArgs.parse(await request.json()) })

    return Response.json(fixtures.sheets[0] ?? null)
  }

  if (request.method === 'GET' && pathname === '/api/db/sheet_instances') {
    const lifecycle = searchParams.get('lifecycle')?.replace(/^eq\./, '')

    return Response.json(
      fixtures.sheets.filter(
        (row) => !lifecycle || row.lifecycle === lifecycle,
      ),
    )
  }

  throw new Error(`Unexpected request: ${request.method} ${request.url}`)
}

vi.stubGlobal('fetch', fixtureFetch)

const client = createDataClient(fixtureFetch)

const { ProjectSheets, sheetOrigin } = await import('./project-sheets')

afterEach(() => {
  cleanup()
  dropSharedReads()
})

beforeEach(() => {
  fixtures.sheets = []
  fixtures.calls = []
  dropSharedReads()
})

function sheet(over: Partial<SheetInstanceWire> = {}): SheetInstanceWire {
  return {
    id: SHEET,
    workspace_id: WORKSPACE,
    project_id: '55555555-5555-4555-8555-555555555555',
    notebook_record_id: null,
    source_definition_version_id: null,
    display_id: 'SH-0007',
    name: 'Cell count 14 Oct',
    description: null,
    lifecycle: 'active',
    revision: 3,
    state: {
      bindings: [],
      localFields: [],
      localValues: {},
      calculationOverrides: {},
      presentation: {
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
        filters: [],
        sorts: [],
      },
      provenance: { createdFrom: 'ad_hoc' },
    },
    duplicated_from_instance_id: null,
    created_at: '2026-10-14T08:00:00Z',
    updated_at: '2026-10-14T09:00:00Z',
    created_by_user_id: null,
    updated_by_user_id: null,
    ...over,
  }
}

function renderTab() {
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <ProjectSheets projectId="p-1" />
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

describe('ProjectSheets', () => {
  it('lists the project’s sheets with their origin', async () => {
    fixtures.sheets = [
      sheet(),
      sheet({
        id: OTHER_SHEET,
        name: 'Titre',
        display_id: null,
        source_definition_version_id: '66666666-6666-4666-8666-666666666666',
      }),
    ]
    renderTab()
    expect(
      (await screen.findAllByText('Cell count 14 Oct')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText('From a sheet definition').length,
    ).toBeGreaterThan(0)
  })

  it('renames with the sheet’s current revision', async () => {
    const user = userEvent.setup()
    fixtures.sheets = [sheet()]
    renderTab()
    await user.click(await screen.findByRole('button', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Renamed')
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }))
    await waitFor(() =>
      expect(fixtures.calls).toContainEqual({
        name: 'rename_sheet_instance',
        args: {
          p_instance_id: SHEET,
          p_expected_revision: 3,
          p_name: 'Renamed',
        },
      }),
    )
  })

  it('archives, and restores from the archived view', async () => {
    const user = userEvent.setup()
    fixtures.sheets = [sheet()]
    renderTab()
    await user.click(await screen.findByRole('button', { name: 'Archive' }))
    await waitFor(() =>
      expect(fixtures.calls).toContainEqual({
        name: 'archive_sheet_instance',
        args: { p_instance_id: SHEET, p_expected_revision: 3 },
      }),
    )

    fixtures.sheets = [
      sheet({ id: OTHER_SHEET, revision: 5, lifecycle: 'archived' }),
    ]
    dropSharedReads()
    await user.click(screen.getByRole('button', { name: 'Show archived' }))
    await user.click(await screen.findByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(fixtures.calls).toContainEqual({
        name: 'restore_sheet_instance',
        args: { p_instance_id: OTHER_SHEET, p_expected_revision: 5 },
      }),
    )
  })

  it('says what an empty project needs and offers New sheet', async () => {
    renderTab()
    expect(await screen.findByText('No sheets yet')).toBeTruthy()
    expect(
      screen
        .getAllByText('New sheet')
        .map((label) => label.closest('a')?.getAttribute('href')),
    ).toContain('/sheets/new?project=p-1')
  })

  it('names a sheet’s origin in plain words', () => {
    expect(
      sheetOrigin({
        sourceDefinitionVersionId: null,
        duplicatedFromInstanceId: 'x',
      }),
    ).toBe('Copy of another sheet')
    expect(
      sheetOrigin({
        sourceDefinitionVersionId: null,
        duplicatedFromInstanceId: null,
      }),
    ).toBe('Working sheet')
  })
})

// The singleton instance client is the one `ProjectSheets` uses by default.
void client
