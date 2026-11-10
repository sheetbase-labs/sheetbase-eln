import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDataClient, dropSharedReads } from '#/lib/data-client'
import { extensionQueryKeys } from '#/lib/extensions/client'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import { RecordModelEditDialog } from './record-model-edit-dialog'
import { RecordModelEdit } from './record-model-edit'
import type { RecordModelVersion } from '#/lib/record-model-versions'

// The production singleton captures fetch when its module is initialised.
const draftTransport = vi.hoisted(() => {
  const transport = vi.fn<typeof fetch>()

  vi.stubGlobal('fetch', transport)

  return transport
})

const draftQueryClients = new Set<QueryClient>()

const note: ModelFieldDefinition = {
  id: 'f1',
  modelKey: 'cell_bank',
  fieldName: 'note',
  label: 'Note',
  description: null,
  logicalType: 'text',
  nullable: true,
  defaultValue: null,
  displayOrder: 0,
  unit: null,
  validation: {},
  lifecycle: 'active',
  options: [],
}

function mount(locked = false) {
  const requests: Request[] = []

  const client = createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://localhost'),
      init,
    )

    requests.push(request)

    if (request.method === 'GET') {
      expect(request.url).toContain(
        '/api/db/records?id=eq.rec-1&select=custom_fields,metadata_version,locked_at',
      )

      return Response.json([
        {
          custom_fields: { note: 'old' },
          metadata_version: 3,
          locked_at: locked ? '2026-11-05T10:00:00Z' : null,
        },
      ])
    }

    expect(request.url).toBe(
      'http://localhost/api/db/rpc/update_record_custom_fields',
    )

    return Response.json({})
  })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  queryClient.setQueryData([...extensionQueryKeys.extensions, 'points'], [])
  queryClient.setQueryData(['plugin-hooks', 'field-types', ''], [])
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <RecordModelEditDialog
        open
        onOpenChange={onOpenChange}
        recordId="rec-1"
        fields={[note]}
        stored={{ note: 'old' }}
        client={client}
      />
    </QueryClientProvider>,
  )

  return { onOpenChange, requests, queryClient }
}

afterEach(() => {
  cleanup()
  draftQueryClients.forEach((client) => client.clear())
  draftQueryClients.clear()
  draftTransport.mockReset()
  dropSharedReads()
  vi.clearAllMocks()
})

describe('RecordModelEditDialog', () => {
  it('keeps Save off until something changes, then sends only the change', async () => {
    const user = userEvent.setup()
    const { onOpenChange, requests, queryClient } = mount()
    const save = screen.getByRole('button', { name: 'Save details' })
    expect(save).toHaveProperty('disabled', true)

    await user.clear(screen.getByLabelText('Note'))
    await user.type(screen.getByLabelText('Note'), 'new')
    await user.click(save)

    await waitFor(() => expect(requests).toHaveLength(2))
    expect(await requests[1]?.json()).toEqual({
      p_record_id: 'rec-1',
      p_expected_metadata_version: 3,
      p_values: { note: 'new' },
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    queryClient.clear()
  })

  it('says why a locked record cannot be edited', async () => {
    const user = userEvent.setup()
    const { requests, queryClient } = mount(true)
    await user.type(screen.getByLabelText('Note'), '!')
    await user.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/record is locked/)).toBeTruthy()
    expect(requests).toHaveLength(1)
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
    queryClient.clear()
  })
})

const initialVersion: RecordModelVersion = {
  id: '00000000-0000-4000-8000-000000000102',
  model_id: '00000000-0000-4000-8000-000000000101',
  workspace_id: '00000000-0000-4000-8000-000000000103',
  version: 1,
  revision: 7,
  lifecycle: 'draft',
  reason: 'Define passage metadata',
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
  created_by_user_id: null,
  published_at: null,
  definition: {
    rules: [{ id: 'preserved-rule' }],
    fields: [
      {
        id: '00000000-0000-4000-8000-000000000104',
        field_name: 'passage',
        label: 'Passage',
        logical_type: 'integer',
        nullable: true,
        display_order: 1,
        lifecycle: 'active',
        default_value: null,
        validation: { min: 0, max: 100, scientificRule: 'retain' },
        cardinality: 'one',
      },
    ],
  },
}

function versionWithLabel(label: string, revision: number): RecordModelVersion {
  return {
    ...initialVersion,
    revision,
    definition: {
      ...initialVersion.definition,
      fields: initialVersion.definition.fields.map((field) => ({
        ...field,
        label,
      })),
    },
  }
}

type ResponseCompletion = { resolve?: (response: Response) => void }

function pendingResponse() {
  const pending: ResponseCompletion = {}

  const response = new Promise<Response>((resolve) => {
    pending.resolve = resolve
  })

  return {
    response,
    finish(value: Response) {
      if (!pending.resolve) throw new Error('Response resolver not initialised')
      pending.resolve(value)
    },
  }
}

async function mountDraft() {
  let serverVersion = initialVersion
  const writes: Request[] = []
  const reads: Request[] = []
  const pendingSaves: ReturnType<typeof pendingResponse>[] = []

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })

  draftQueryClients.add(queryClient)
  dropSharedReads()
  draftTransport.mockImplementation((input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://localhost'),
      init,
    )

    const url = new URL(request.url)

    if (request.method === 'POST') {
      expect(url.pathname).toBe(
        '/api/db/rpc/replace_record_model_version_definition',
      )
      const pending = pendingResponse()

      writes.push(request)
      pendingSaves.push(pending)

      return pending.response
    }

    reads.push(request)

    if (url.pathname === '/api/db/record_models') {
      return Promise.resolve(
        Response.json(
          url.searchParams.has('key')
            ? [
                {
                  id: initialVersion.model_id,
                  key: 'cell_bank',
                  name: 'Cell bank',
                  identifier_prefix: 'CB',
                  current_version: 1,
                },
              ]
            : [],
        ),
      )
    }

    if (url.pathname === '/api/db/record_model_versions') {
      return Promise.resolve(Response.json([serverVersion]))
    }

    return Promise.resolve(Response.json([]))
  })

  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <RecordModelEdit
          modelKey="cell_bank"
          role="steward"
          user={{ id: 'author', name: 'Author' }}
          workspaceId={initialVersion.workspace_id}
        />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await screen.findByRole('textbox', { name: 'Name' })

  return {
    writes,
    reads,
    refreshVersion: async (next: RecordModelVersion) => {
      serverVersion = next
      dropSharedReads()
      await act(async () => {
        await queryClient.invalidateQueries({
          queryKey: [
            'ui-port',
            'record-models',
            'versions',
            initialVersion.model_id,
          ],
        })
      })
    },
    finishSave: async (index: number, next: RecordModelVersion) => {
      serverVersion = next
      const pending = pendingSaves.at(index)

      if (!pending) throw new Error(`No pending save ${index}`)
      await act(async () => {
        pending.finish(Response.json(next))
      })
    },
  }
}

describe('RecordModelEdit revision-pinned draft controller', () => {
  it('adopts a newer server revision while clean through an HTTP refetch', async () => {
    const { writes, reads, refreshVersion } = await mountDraft()

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Passage',
    )
    await refreshVersion(versionWithLabel('Server passage', 8))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
        'value',
        'Server passage',
      ),
    )
    expect(screen.getByText(/Saved .* revision 8/)).toBeTruthy()
    expect(
      reads.filter(
        (request) =>
          new URL(request.url).pathname === '/api/db/record_model_versions' &&
          new URL(request.url).searchParams.has('model_id'),
      ),
    ).toHaveLength(2)
    expect(writes).toHaveLength(0)
  })

  it('preserves dirty local edits and locks instead of overwriting them on a newer server revision', async () => {
    const { writes, refreshVersion } = await mountDraft()

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Local passage' },
    })
    await screen.findByText('Unsaved changes')
    await refreshVersion(versionWithLabel('Their passage', 8))
    await screen.findByText(
      'Someone else saved this draft while you were editing.',
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Local passage',
    )
    expect(screen.getByRole('group')).toHaveProperty('disabled', true)
    expect(
      within(screen.getByRole('banner')).getByRole('button', {
        name: 'Submit for approval',
      }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByRole('button', { name: 'Use their version' }),
    ).toBeTruthy()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800))
    })
    expect(writes).toHaveLength(0)
  })

  it('retains edits made during an autosave and sends them next with the acknowledged revision', async () => {
    const { writes, finishSave } = await mountDraft()

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'First edit' },
    })
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 2000 })
    expect(await writes[0]?.clone().json()).toEqual({
      p_version_id: initialVersion.id,
      p_expected_revision: 7,
      p_definition: versionWithLabel('First edit', 8).definition,
      p_reason: initialVersion.reason,
    })
    await screen.findByText('Saving…')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Second edit while saving' },
    })
    expect(writes).toHaveLength(1)
    await finishSave(0, versionWithLabel('First edit', 8))
    await screen.findByText('Unsaved changes')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Second edit while saving',
    )
    expect(
      within(screen.getByRole('banner')).getByRole('button', {
        name: 'Submit for approval',
      }),
    ).toHaveProperty('disabled', true)
    await waitFor(() => expect(writes).toHaveLength(2), { timeout: 2000 })
    expect(await writes[1]?.clone().json()).toEqual({
      p_version_id: initialVersion.id,
      p_expected_revision: 8,
      p_definition: versionWithLabel('Second edit while saving', 9).definition,
      p_reason: initialVersion.reason,
    })
    await finishSave(1, versionWithLabel('Second edit while saving', 9))
    await screen.findByText(/Saved .* revision 9/)
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Second edit while saving',
    )
    expect(writes).toHaveLength(2)
  })
})
