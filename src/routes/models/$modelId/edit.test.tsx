import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { z } from 'zod'

import { canonicalDatasetSchemaFieldSchema } from '#/lib/dataset-schema-definition-rpc'
import type { CanonicalDatasetSchemaField } from '#/lib/dataset-schema-definition-rpc'

const MODEL_ID = '00000000-0000-4000-8000-00000000d001'
const writes: Request[] = []
let revision = 1
let draftId = 'draft-1'
let fields: CanonicalDatasetSchemaField[] = []
let staleSave = false

function version() {
  return {
    id: draftId,
    schema_id: MODEL_ID,
    version: 1,
    revision,
    lifecycle: 'draft',
    published_at: null,
  }
}

const saveSchema = z.object({
  p_schema_version_id: z.string(),
  p_expected_revision: z.number(),
  p_fields: z.array(canonicalDatasetSchemaFieldSchema),
})

const fixtureFetch: typeof fetch = async (input, init) => {
  const request = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  const { pathname } = new URL(request.url)

  if (
    request.method === 'POST' &&
    pathname === '/api/db/rpc/replace_dataset_schema_version_fields'
  ) {
    writes.push(request.clone())
    const body = saveSchema.parse(await request.json())

    if (staleSave) {
      staleSave = false
      revision += 1
      fields = fields.map((field) => ({ ...field, label: 'Changed elsewhere' }))

      return Response.json(
        {
          error: {
            code: 'SB001',
            message: 'stale dataset schema version revision',
          },
        },
        { status: 409 },
      )
    }

    expect(body.p_expected_revision).toBe(revision)
    expect(body.p_schema_version_id).toBe(draftId)
    fields = body.p_fields
    revision += 1

    return Response.json(version())
  }

  if (request.method === 'GET') {
    switch (pathname) {
      case '/api/db/dataset_schema_definitions':
        return Response.json([
          {
            id: MODEL_ID,
            key: 'measurements',
            name: 'Measurements',
            parent_id: null,
            lifecycle: 'active',
          },
        ])
      case '/api/db/dataset_schema_versions':
        return Response.json([version()])
      case '/api/db/dataset_schema_version_fields':
        return Response.json(fields)
      case '/api/db/approval_requests':
      case '/api/db/workspace_settings':
        return Response.json([])
    }
  }

  throw new Error(`Unexpected request: ${request.method} ${request.url}`)
}

// Keep Router, Query and the singleton DataClient real; fixture only HTTP.
vi.stubGlobal('fetch', fixtureFetch)

const { Route } = await import('./edit')
const { dropSharedReads } = await import('#/lib/data-client')

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

beforeEach(() => {
  revision = 1
  draftId = 'draft-1'
  staleSave = false
  writes.length = 0
  fields = [
    {
      field_id: 'field-1',
      key: 'result',
      label: 'Result',
      description: null,
      logical_type: 'decimal',
      nullable: true,
      cardinality: 'one',
      lifecycle: 'active',
      display_order: 1,
      default_value: 0,
      quantity: {
        kind: 'concentration',
        dimension: 'mass/volume',
        storageUnit: 'mg/L',
        allowedInputUnits: ['mg/L', 'g/L'],
        preferredDisplayUnit: 'g/L',
      },
      validation: { min: 0, max: 100 },
    },
  ]
})

afterEach(() => {
  cleanup()
  client.clear()
  dropSharedReads()
})

afterAll(() => vi.unstubAllGlobals())

async function renderEditor() {
  const root = createRootRoute({
    beforeLoad: () => ({
      context: {
        workspace: { id: 'ws', role: 'owner' },
        user: { id: 'user-1', name: 'Scientist' },
      },
    }),
  })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/models/$modelId/edit',
    component: Route.options.component,
    validateSearch: Route.options.validateSearch,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [`/models/${MODEL_ID}/edit`],
    }),
  })

  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await screen.findByDisplayValue('Result')
  await waitFor(() => expect(client.isFetching()).toBe(0))

  return userEvent.setup()
}

async function savedFields(index = 0) {
  const request = writes.at(index)

  if (!request) throw new Error('Expected an autosave request')

  return saveSchema.parse(await request.clone().json())
}

describe('dataset model editor', () => {
  it('edits quantity metadata without dropping optional scientific settings or a zero default', async () => {
    const user = await renderEditor()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Default value').getAttribute('value')).toBe(
      '0',
    )
    fireEvent.change(screen.getByLabelText('Unit'), {
      target: { value: 'g/L' },
    })
    await waitFor(() => expect(writes).toHaveLength(1))
    expect((await savedFields()).p_fields[0]).toMatchObject({
      default_value: 0,
      quantity: {
        kind: 'concentration',
        dimension: 'mass/volume',
        storageUnit: 'g/L',
        allowedInputUnits: ['mg/L', 'g/L'],
        preferredDisplayUnit: 'g/L',
      },
      validation: { min: 0, max: 100 },
    })
    await screen.findByText('Saved · revision 2')
  })

  it('retains false defaults and clears incompatible contracts when the logical type changes', async () => {
    const user = await renderEditor()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Field type'), {
      target: { value: 'boolean' },
    })
    fireEvent.change(screen.getByLabelText('Default value'), {
      target: { value: 'false' },
    })
    await waitFor(() => expect(writes).toHaveLength(1))
    expect((await savedFields()).p_fields[0]).toMatchObject({
      logical_type: 'boolean',
      default_value: false,
      quantity: null,
      category: null,
      relationship: null,
      validation: {},
    })
    await screen.findByText('Saved · revision 2')
    await user.click(screen.getByRole('button', { name: 'Clear default' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect((await savedFields(1)).p_fields[0]?.default_value).toBeNull()
  })

  it('keeps category vocabulary metadata and option identities when an option label changes', async () => {
    const category = {
      kind: 'embedded',
      vocabularyId: 'vocabulary-1',
      options: [
        {
          id: 'option-1',
          key: 'pass',
          label: 'Pass',
          lifecycle: 'active',
          displayOrder: 1,
        },
        {
          id: 'option-2',
          key: 'old',
          label: 'Old',
          lifecycle: 'retired',
          displayOrder: 2,
        },
      ],
    } satisfies CanonicalDatasetSchemaField['category']

    fields = fields.map((field) => ({
      ...field,
      logical_type: 'category',
      quantity: null,
      validation: {},
      category,
      default_value: 'option-1',
    }))
    const user = await renderEditor()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(
      screen
        .getByLabelText('Default value')
        .querySelector('option[value="option-2"]'),
    ).toBeNull()
    fireEvent.change(screen.getByLabelText('Option 1 label'), {
      target: { value: 'Accepted' },
    })
    await waitFor(() => expect(writes).toHaveLength(1))
    expect((await savedFields()).p_fields[0]).toMatchObject({
      default_value: 'option-1',
      category: {
        ...category,
        options: [
          { ...category.options[0], label: 'Accepted' },
          category.options[1],
        ],
      },
    })
  })

  it('keeps reference target metadata and synchronizes relationship cardinality', async () => {
    fields = fields.map((field) => ({
      ...field,
      logical_type: 'reference',
      quantity: null,
      validation: {},
      default_value: null,
      relationship: {
        target: { kind: 'model', modelKey: 'sample', schemaId: 'schema-1' },
        cardinality: 'one',
      },
    }))
    const user = await renderEditor()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Number of values'), {
      target: { value: 'many' },
    })
    await waitFor(() => expect(writes).toHaveLength(1))
    expect((await savedFields()).p_fields[0]).toMatchObject({
      cardinality: 'many',
      relationship: {
        target: { kind: 'model', modelKey: 'sample', schemaId: 'schema-1' },
        cardinality: 'many',
      },
    })
    expect(
      screen.getByLabelText('Default value').hasAttribute('disabled'),
    ).toBe(true)
  })

  it('keeps local edits on a query refresh and resets the inspector when a different draft replaces it', async () => {
    const user = await renderEditor()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Field label'), {
      target: { value: 'Local result' },
    })
    dropSharedReads()
    await act(() =>
      client.invalidateQueries({ queryKey: ['ui-port', 'models'] }),
    )
    expect(screen.getByLabelText('Field label').getAttribute('value')).toBe(
      'Local result',
    )
    draftId = 'draft-2'
    fields = fields.map((field) => ({ ...field, label: 'Replacement result' }))
    dropSharedReads()
    await act(() =>
      client.invalidateQueries({ queryKey: ['ui-port', 'models'] }),
    )
    await screen.findByDisplayValue('Replacement result')
    expect(screen.queryByLabelText('Field label')).toBeNull()
    expect(writes).toHaveLength(0)
  })

  it('stops after a stale save and only overwrites after Keep mine using the newly read revision', async () => {
    staleSave = true
    const user = await renderEditor()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Field label'), {
      target: { value: 'My result' },
    })
    await user.click(await screen.findByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    const saved = await savedFields(1)
    expect(saved.p_expected_revision).toBe(2)
    expect(saved.p_fields[0]?.label).toBe('My result')
    await screen.findByText('Saved · revision 3')
  })
})
