/**
 * VIEW-02 plate_map block preview tests. Verifies the PlateMapBlockPreview
 * renders inside the shared representation frame (Live vs Snapshot badge),
 * resolves well→record links honestly (active/archived/missing), surfaces
 * linked-record context on well click with a stable-ID open action, and —
 * in frozen mode — reconstructs the pinned spec with no live reads.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BlockPreview } from './block-preview'
import { BlockEditor } from './block-editor'
import type { NotebookBlock } from '#/lib/notebook-data'
import { dropSharedReads } from '#/lib/data-client'
import type { PlateMapSpec } from '#/lib/plate-map'
import { PLATE_MAP_SPEC_VERSION } from '#/lib/plate-map'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

let archivedAt: string | null = null
let missing = false

beforeEach(() => {
  dropSharedReads()
  archivedAt = null
  missing = false
  transport.mockReset()
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (url.pathname !== '/api/db/records')
      throw new Error(`Unexpected request: ${url.pathname}`)

    return Response.json(
      missing
        ? []
        : [
            {
              id: RECORD_ID,
              workspace_id: 'ws-1',
              project_id: null,
              folder_id: null,
              kind: 'sample',
              identifier: 'SMP-991',
              title: 'Assay sample',
              status: 'active',
              tags: [],
              structure_version: 1,
              metadata_version: 1,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
              archived_at: archivedAt,
              deleted_at: null,
              created_by_user_id: 'u1',
              updated_by_user_id: null,
              properties: {},
              locked_at: null,
              locked_by_revision_id: null,
            },
          ],
    )
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  )
}

const RECORD_ID = '00000000-0000-4000-8000-000000000991'

function specWithSample(): PlateMapSpec {
  return {
    specVersion: PLATE_MAP_SPEC_VERSION,
    format: '96_well',
    rows: 8,
    cols: 12,
    wells: [
      {
        wellCode: 'A1',
        row: 0,
        col: 0,
        role: 'sample',
        sampleRef: {
          recordId: RECORD_ID,
          identifier: 'SMP-991',
          title: 'Assay sample',
        },
        replicate: 1,
      },
    ],
    validation: {},
  }
}

function makeBlock(payload: NotebookBlock['payload']): NotebookBlock {
  return {
    id: 'block-plate',
    recordId: 'experiment-1',
    type: 'plate_map',
    payload,
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }
}

describe('PlateMapBlockPreview — live representation', () => {
  it('names volume inputs and groups required-role controls in the editor', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <BlockEditor
        block={makeBlock({ spec: specWithSample() })}
        save={vi.fn(async () => ({ ok: true }))}
      />,
    )
    await user.click(screen.getByRole('button', { name: /A1 · Sample/ }))
    const volume = screen.getByRole('spinbutton', { name: 'Volume' })
    await user.type(volume, '12.5')
    expect(screen.getByRole('spinbutton', { name: 'Volume' })).toHaveProperty(
      'value',
      '12.5',
    )
    expect(
      within(
        screen.getByRole('spinbutton', { name: 'Volume' }).parentElement!,
      ).getByRole('textbox', { name: 'Unit' }),
    ).toHaveProperty('value', 'µL')
    await user.click(screen.getByText('Validation config'))
    expect(screen.getByRole('group', { name: 'Required roles' })).toBeTruthy()
  })

  it('renders inside a live frame and resolves the linked sample', async () => {
    archivedAt = null
    renderWithQuery(
      <BlockPreview
        block={makeBlock({ title: 'Titration plate', spec: specWithSample() })}
      />,
    )
    expect(screen.getByText('Titration plate')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
    await waitFor(() => {
      expect(transport).toHaveBeenCalledWith(
        `/api/db/records?id=eq.${RECORD_ID}`,
        expect.objectContaining({ method: 'GET' }),
      )
    })
    // Canonical open affordance carries the stable record ID.
    const sampleLink = screen.getByRole('link', { name: 'SMP-991' })
    expect(sampleLink.getAttribute('href')).toContain(RECORD_ID)
  })

  it('selects a well to show linked-record context with an open action', async () => {
    archivedAt = null
    const user = userEvent.setup()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({ title: 'Titration plate', spec: specWithSample() })}
      />,
    )
    await waitFor(() => {
      expect(transport).toHaveBeenCalled()
    })
    await user.click(screen.getByRole('button', { name: /A1 · Sample/ }))
    expect(screen.getByText(/Well A1/)).toBeTruthy()
    expect(screen.getByText(/Replicate 1/)).toBeTruthy()
    const open = screen.getByRole('link', { name: 'Open sample record' })
    expect(open.getAttribute('href')).toContain(RECORD_ID)
  })

  it('marks archived samples honestly', async () => {
    archivedAt = '2026-02-01T00:00:00Z'
    const user = userEvent.setup()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({ title: 'Titration plate', spec: specWithSample() })}
      />,
    )
    await waitFor(() => {
      expect(transport).toHaveBeenCalled()
    })
    await user.click(screen.getByRole('button', { name: /A1 · Sample/ }))
    expect(screen.getByText(/archived/)).toBeTruthy()
  })

  it('marks unresolvable samples as missing without hiding the snapshot', async () => {
    missing = true
    const user = userEvent.setup()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({ title: 'Titration plate', spec: specWithSample() })}
      />,
    )
    await waitFor(() => {
      expect(transport).toHaveBeenCalled()
    })
    await user.click(screen.getByRole('button', { name: /A1 · Sample/ }))
    expect(screen.getByText(/missing — deleted or inaccessible/)).toBeTruthy()
    // The stored observation stays visible even though the record is gone.
    expect(screen.getByRole('link', { name: 'SMP-991' })).toBeTruthy()
  })

  it('prompts for configuration on an empty draft', () => {
    renderWithQuery(<BlockPreview block={makeBlock({})} />)
    expect(screen.getByText(/No plate map configured/)).toBeTruthy()
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('PlateMapBlockPreview — frozen reconstruction', () => {
  it('renders the pinned spec with no live reads', async () => {
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Submitted plate',
          spec: specWithSample(),
        })}
        frozen
      />,
    )
    expect(screen.getByText('Submitted plate')).toBeTruthy()
    expect(screen.getByText('Snapshot')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
    // No live record reads in historical mode — not even after settling.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /A1 · Sample/ })).toBeTruthy()
    })
    expect(transport).not.toHaveBeenCalled()
  })

  it('selects wells from snapshot state in frozen mode', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Submitted plate',
          spec: specWithSample(),
        })}
        frozen
      />,
    )
    await user.click(screen.getByRole('button', { name: /A1 · Sample/ }))
    expect(screen.getByText(/Well A1/)).toBeTruthy()
    expect(screen.getByText(/active \(snapshot\)/)).toBeTruthy()
    expect(transport).not.toHaveBeenCalled()
  })
})
