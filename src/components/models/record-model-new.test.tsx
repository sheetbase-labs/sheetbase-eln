import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import { dropSharedReads } from '#/lib/data-client'
import { RecordModelNew } from './record-model-new'
import { RecordModelEdit } from './record-model-edit'
import type { RecordModelVersion } from '#/lib/record-model-versions'

const queryClients = new Set<QueryClient>()

// The real singleton DataClient captures fetch during module initialisation.
const transport = vi.hoisted(() => {
  const fetch = vi.fn<typeof globalThis.fetch>()

  vi.stubGlobal('fetch', fetch)

  return fetch
})

const categoryField: ModelFieldDefinition = {
  id: 'f1',
  modelKey: 'cell_bank',
  fieldName: 'cell_line',
  label: 'Cell line',
  description: null,
  displayOrder: 1,
  logicalType: 'category',
  nullable: false,
  defaultValue: null,
  unit: null,
  quantity: null,
  validation: {},
  cardinality: 'one',
  categorySource: { kind: 'embedded' },
  relationship: null,
  lifecycle: 'active',
  options: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      key: 'cho_k1',
      label: 'CHO-K1',
      displayOrder: 0,
      lifecycle: 'active',
    },
  ],
}

const passageField: ModelFieldDefinition = {
  id: 'f2',
  modelKey: 'cell_bank',
  fieldName: 'passage',
  label: 'Passage',
  description: null,
  displayOrder: 2,
  logicalType: 'integer',
  nullable: false,
  defaultValue: null,
  unit: null,
  quantity: null,
  validation: {},
  cardinality: 'one',
  categorySource: null,
  relationship: null,
  lifecycle: 'active',
  options: [],
}

afterEach(() => {
  cleanup()
  queryClients.forEach((client) => client.clear())
  queryClients.clear()
  vi.unstubAllGlobals()
})

async function renderForm(
  initialDraft?: RecordModelVersion,
  saveDraft?: typeof fetch,
) {
  let draft = initialDraft
  dropSharedReads()
  vi.stubGlobal('fetch', transport)
  transport.mockImplementation((input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    )

    switch (url.pathname) {
      case '/api/db/rpc/replace_record_model_version_definition':
        return saveDraft
          ? saveDraft(input, init)
          : Promise.resolve(Response.json(null))
      case '/api/db/record_models':
        return Promise.resolve(
          Response.json(
            url.searchParams.has('key')
              ? [
                  {
                    id: draft?.model_id ?? 'm1',
                    name: 'Cell bank',
                    identifier_prefix: 'CB',
                    current_version: 1,
                  },
                ]
              : [],
          ),
        )
      case '/api/db/record_model_versions':
        return Promise.resolve(
          Response.json(
            url.searchParams.has('model_id')
              ? draft
                ? [draft]
                : [{ id: 'v1' }]
              : [
                  {
                    definition: {
                      fields: [categoryField, passageField].map((field) => ({
                        ...field,
                        field_name: field.fieldName,
                        logical_type: field.logicalType,
                        display_order: field.displayOrder,
                        default_value: field.defaultValue,
                        category_source: field.categorySource,
                      })),
                    },
                  },
                ],
          ),
        )
      case '/api/db/projects':
        return Promise.resolve(
          Response.json([{ id: 'p1', key: 'project_a', title: 'Project A' }]),
        )
      default:
        return Promise.resolve(Response.json([]))
    }
  })

  const router = createRouter({
    routeTree: createRootRoute({
      component: () =>
        initialDraft ? (
          <RecordModelEdit
            modelKey="cell_bank"
            role="steward"
            user={{ id: 'author', name: 'Author' }}
            workspaceId={initialDraft.workspace_id}
          />
        ) : (
          <RecordModelNew modelKey="cell_bank" />
        ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  queryClients.add(client)
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  if (initialDraft) await screen.findByRole('table', { name: 'Draft fields' })
  else await screen.findByLabelText('Cell line')

  return {
    client,
    receiveDraft: (next: RecordModelVersion) => {
      draft = next
      client.setQueryData(
        ['ui-port', 'record-models', 'versions', next.model_id],
        [next],
      )
    },
  }
}

describe('RecordModelNew — generated form', () => {
  it('does not paint validation errors on a pristine form', async () => {
    await renderForm()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('accepts an embedded category option and enables Create', async () => {
    await renderForm()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'QA3 validation probe' },
    })
    fireEvent.change(screen.getByLabelText('Cell line'), {
      target: { value: 'cho_k1' },
    })
    fireEvent.change(screen.getByLabelText('Passage'), {
      target: { value: '12' },
    })
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    const create = screen.getByRole('button', { name: 'Create Cell bank' })
    expect(create).toHaveProperty('disabled', false)
  })

  it('shows the outstanding errors once the person has interacted', async () => {
    await renderForm()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'QA3 validation probe' },
    })
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(2)
    expect(alerts.map((node) => node.textContent)).toEqual([
      'That value is not allowed.',
      'That value is not allowed.',
    ])
  })

  it('clears the creating state after the data client rejects a creation', async () => {
    await renderForm()
    const original = transport.getMockImplementation()

    if (!original) throw new Error('Missing fixture transport')

    transport.mockImplementation((input, init) =>
      (input instanceof Request ? input.url : String(input)).includes(
        '/rpc/create_model_record',
      )
        ? Promise.reject(new Error('Creation refused'))
        : original(input, init),
    )
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Bank' },
    })
    fireEvent.change(screen.getByLabelText('Cell line'), {
      target: { value: 'cho_k1' },
    })
    fireEvent.change(screen.getByLabelText('Passage'), {
      target: { value: '12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Cell bank' }))
    await screen.findByText('Creation refused')
    expect(
      screen.getByRole('button', { name: 'Create Cell bank' }),
    ).toHaveProperty('disabled', false)
  })
})

const draftVersion: RecordModelVersion = {
  id: '00000000-0000-4000-8000-000000000002',
  model_id: '00000000-0000-4000-8000-000000000001',
  workspace_id: '00000000-0000-4000-8000-000000000003',
  version: 1,
  revision: 1,
  lifecycle: 'draft',
  reason: 'Initial definition',
  created_at: '2026-10-01T12:00:00Z',
  created_by_user_id: null,
  published_at: null,
  definition: {
    rules: [{ id: 'preserved-rule' }],
    fields: [
      {
        id: '00000000-0000-4000-8000-000000000004',
        field_name: 'passage',
        label: 'Passage',
        logical_type: 'integer',
        nullable: true,
        display_order: 1,
        lifecycle: 'active',
        default_value: null,
        validation: { min: 0, max: 100, scientificRule: 'keep-me' },
        cardinality: 'one',
      },
    ],
  },
}

describe('RecordModelEdit revision-pinned working copy', () => {
  it('autosaves the edited fields with the pinned revision and retains definition metadata', async () => {
    const writes: unknown[] = []

    const saved: RecordModelVersion = {
      ...draftVersion,
      revision: 2,
      updated_at: '2026-10-01T12:01:00Z',
      definition: {
        ...draftVersion.definition,
        fields: draftVersion.definition.fields.map((field) => ({
          ...field,
          label: 'Edited passage',
        })),
      },
    }

    const { receiveDraft } = await renderForm(
      draftVersion,
      async (input, init) => {
        const request = new Request(
          new URL(
            input instanceof Request ? input.url : String(input),
            'http://localhost',
          ),
          init,
        )

        const body: unknown = await request.json()

        writes.push(body)

        return Response.json(saved)
      },
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Edited passage' },
    })
    await waitFor(() => expect(writes).toHaveLength(1), { timeout: 2000 })
    await screen.findByText(/Saved .* revision 2/)
    expect(writes[0]).toEqual({
      p_version_id: draftVersion.id,
      p_expected_revision: 1,
      p_definition: saved.definition,
      p_reason: draftVersion.reason,
    })
    act(() => receiveDraft(saved))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Edited passage',
    )
  })

  it('adopts clean incoming revisions, but retains dirty fields and locks on a remote conflict', async () => {
    const { receiveDraft } = await renderForm(draftVersion)

    const received: RecordModelVersion = {
      ...draftVersion,
      revision: 2,
      definition: {
        fields: draftVersion.definition.fields.map((field) => ({
          ...field,
          label: 'Remote passage',
        })),
      },
    }

    act(() => receiveDraft(received))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
        'value',
        'Remote passage',
      ),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'My passage' },
    })
    act(() => receiveDraft({ ...received, revision: 3 }))
    await screen.findByText(
      'Nothing of yours was written over theirs. Reload to see their version, then make your change again.',
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'My passage',
    )
    expect(screen.getByRole('group')).toHaveProperty('disabled', true)
  })
})
