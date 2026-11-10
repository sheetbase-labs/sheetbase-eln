import {
  act,
  cleanup,
  render as plainRender,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import type { AddedFieldValues } from '#/lib/built-in-models'
import type { FieldGroup, ModelType } from '#/lib/model-subtypes'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { dropSharedReads } from '#/lib/data-client'

import { AddedFields } from './added-fields'
import { addedFieldColumns, withAddedColumns } from './added-field-columns'
import { groupAddedFields } from './added-field-values'

interface AddedFieldsFixture {
  fields: { data: ModelFieldDefinition[] }
  values: { data: AddedFieldValues }
  family: { types: ModelType[]; groups: FieldGroup[] }
}

const fixture: AddedFieldsFixture = {
  fields: { data: [] },
  values: { data: { customFields: {}, locked: false, modelVersionId: null } },
  family: { types: [], groups: [] },
}

const { fields, values, family } = fixture

const queryClients = new Set<QueryClient>()

// The real singleton DataClient captures fetch during module initialisation.
const transport = vi.hoisted(() => {
  const fetch = vi.fn<typeof globalThis.fetch>()

  vi.stubGlobal('fetch', fetch)

  return fetch
})

function fieldWire(definition: ModelFieldDefinition) {
  return {
    ...definition,
    kind: definition.modelKey,
    field_name: definition.fieldName,
    display_order: definition.displayOrder,
    logical_type: definition.logicalType,
    default_value: definition.defaultValue,
  }
}

async function render(ui: ReactElement) {
  dropSharedReads()
  vi.stubGlobal('fetch', transport)
  transport.mockImplementation((input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    )

    switch (url.pathname) {
      case '/api/db/records':
        return Promise.resolve(
          Response.json([
            {
              custom_fields: values.data.customFields,
              locked_at: values.data.locked ? '2026-11-05T10:00:00Z' : null,
              model_version_id: values.data.modelVersionId,
            },
          ]),
        )
      case '/api/db/record_models':
        return Promise.resolve(
          Response.json(
            url.searchParams.has('key')
              ? []
              : family.types.map((type) => ({
                  ...type,
                  identifier_prefix: type.prefix,
                  parent_key: type.parentKey,
                })),
          ),
        )
      case '/api/db/record_model_versions':
        return Promise.resolve(
          Response.json(
            url.searchParams.has('id')
              ? [
                  {
                    definition: {
                      fields: family.groups.flatMap((group) =>
                        group.modelKey === 'cell_culture'
                          ? group.fields.map(fieldWire)
                          : [],
                      ),
                    },
                  },
                ]
              : family.types.flatMap((type) =>
                  type.versionIds.map((id) => ({
                    id,
                    model_id: type.id,
                    version: 1,
                    lifecycle: 'published',
                  })),
                ),
          ),
        )
      case '/api/db/record_field_definitions':
        return Promise.resolve(Response.json(fields.data.map(fieldWire)))
      default:
        return Promise.resolve(Response.json([]))
    }
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  queryClients.add(client)

  const result = plainRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  )

  await act(async () => {
    await waitFor(() => expect(client.isFetching()).toBe(0))
  })

  return result
}

function field(
  overrides: Partial<ModelFieldDefinition> & { fieldName: string },
): ModelFieldDefinition {
  return {
    id: overrides.fieldName,
    modelKey: 'experiment',
    label: overrides.fieldName,
    description: null,
    displayOrder: 1,
    logicalType: 'text',
    nullable: true,
    defaultValue: null,
    unit: null,
    validation: {},
    lifecycle: 'active',
    options: [],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  queryClients.forEach((client) => client.clear())
  queryClients.clear()
  fields.data = []
  values.data = { customFields: {}, locked: false, modelVersionId: null }
  family.types = []
  family.groups = []
  vi.unstubAllGlobals()
})

describe('groupAddedFields', () => {
  it('puts unheaded fields under the model’s own heading, first', () => {
    const groups = groupAddedFields(
      [
        field({ fieldName: 'medium', section: 'Culture' }),
        field({ fieldName: 'site' }),
        field({ fieldName: 'passage', section: 'Culture' }),
      ],
      'Experiment details',
    )

    expect(
      groups.map((g) => [g.heading, g.fields.map((f) => f.fieldName)]),
    ).toEqual([
      ['Experiment details', ['site']],
      ['Culture', ['medium', 'passage']],
    ])
  })
})

describe('list columns', () => {
  it('offers only the fields marked as columns, before the last column', () => {
    const columns = addedFieldColumns<{ id: string }>(
      [
        field({ fieldName: 'passage', label: 'Passage', showInList: true }),
        field({ fieldName: 'medium', showInList: false }),
      ],
      () => ({ passage: 7 }),
    )

    expect(columns.map((c) => c.id)).toEqual(['custom:passage'])

    const base: RegistryColumn<{
      id: string
    }>[] = [{ id: 'name' }, { id: 'status' }]

    expect(withAddedColumns(base, columns).map((c) => c.id)).toEqual([
      'name',
      'custom:passage',
      'status',
    ])
    expect(withAddedColumns(base, [])).toBe(base)
  })
})

describe('AddedFields', () => {
  it('renders nothing while the model has no added fields', async () => {
    const { container } = await render(
      <AddedFields modelKey="experiment" objectId="r1" />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('shows each value under its heading, with an Edit action', async () => {
    fields.data = [
      field({
        fieldName: 'passage',
        label: 'Cell passage',
        section: 'Culture',
      }),
    ]
    values.data = {
      customFields: { passage: '12' },
      locked: false,
      modelVersionId: null,
    }
    await render(<AddedFields modelKey="experiment" objectId="r1" />)
    expect(screen.getByRole('heading', { name: 'Culture' })).toBeTruthy()
    expect(screen.getByText('Cell passage')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('says why a signed record’s details cannot be edited', async () => {
    fields.data = [field({ fieldName: 'passage', label: 'Cell passage' })]
    values.data = { customFields: {}, locked: true, modelVersionId: null }
    await render(<AddedFields modelKey="experiment" objectId="r1" />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByText(/is signed/)).toBeTruthy()
  })

  it('leaves out fields the page lays out itself', async () => {
    fields.data = [field({ fieldName: 'certificate', label: 'Certificate' })]

    const { container } = await render(
      <AddedFields
        modelKey="material"
        objectId="r1"
        exclude={['certificate']}
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('shows a subtyped record’s type and its fields under the subtype’s name', async () => {
    const culture = {
      id: 'm1',
      key: 'cell_culture',
      name: 'Cell culture',
      prefix: 'CCX',
      parentKey: 'experiment',
      lifecycle: 'active',
      publishedVersionId: 'v1',
      versionIds: ['v1'],
    }

    family.types = [culture]
    family.groups = [
      { modelKey: 'experiment', modelName: 'Experiment', fields: [] },
      {
        modelKey: 'cell_culture',
        modelName: 'Cell culture',
        fields: [field({ fieldName: 'cell_line', label: 'Cell line' })],
      },
    ]
    values.data = {
      customFields: { cell_line: 'CHO-K1' },
      locked: false,
      modelVersionId: 'v1',
    }
    await render(<AddedFields modelKey="experiment" objectId="r1" />)
    expect(screen.getByRole('heading', { name: 'Cell culture' })).toBeTruthy()
    expect(screen.getByText('Type')).toBeTruthy()
    expect(screen.getAllByText('Cell culture')).toHaveLength(2)
    expect(screen.getByText('CHO-K1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change type' })).toBeTruthy()
  })
})
