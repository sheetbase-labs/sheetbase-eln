import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'

import {
  AddedFields,
  addedFieldColumns,
  groupAddedFields,
  withAddedColumns,
} from './added-fields'

const fields = vi.hoisted(() => ({ data: [] as unknown[] }))
const values = vi.hoisted(() => ({
  data: {
    customFields: {},
    locked: false,
    modelVersionId: null as string | null,
  },
}))
const family = vi.hoisted(() => ({
  types: [] as unknown[],
  options: [] as unknown[],
  groups: [] as unknown[],
}))

vi.mock('./model-subtype-data', () => ({
  usePickableTypes: () => ({
    types: family.types,
    options: family.options,
    isLoading: false,
  }),
  useTypeFields: () => ({ data: family.groups, isLoading: false }),
}))

vi.mock('./built-in-model-data', () => ({
  builtInModelQueryKeys: {
    all: ['all'],
    values: (key: string, id: string) => ['values', key, id],
  },
  useBuiltInModelFields: () => ({ data: fields.data, isLoading: false }),
  useAddedFieldValues: () => ({
    data: values.data,
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  }
})

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
  fields.data = []
  values.data = { customFields: {}, locked: false, modelVersionId: null }
  family.types = []
  family.options = []
  family.groups = []
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
    const base = [{ id: 'name' }, { id: 'status' }] as RegistryColumn<{
      id: string
    }>[]
    expect(withAddedColumns(base, columns).map((c) => c.id)).toEqual([
      'name',
      'custom:passage',
      'status',
    ])
    expect(withAddedColumns(base, [])).toBe(base)
  })
})

describe('AddedFields', () => {
  it('renders nothing while the model has no added fields', () => {
    const { container } = render(
      <AddedFields modelKey="experiment" objectId="r1" />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows each value under its heading, with an Edit action', () => {
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
    render(<AddedFields modelKey="experiment" objectId="r1" />)
    expect(screen.getByRole('heading', { name: 'Culture' })).toBeTruthy()
    expect(screen.getByText('Cell passage')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('says why a signed record’s details cannot be edited', () => {
    fields.data = [field({ fieldName: 'passage', label: 'Cell passage' })]
    values.data = { customFields: {}, locked: true, modelVersionId: null }
    render(<AddedFields modelKey="experiment" objectId="r1" />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByText(/is signed/)).toBeTruthy()
  })

  it('leaves out fields the page lays out itself', () => {
    fields.data = [field({ fieldName: 'certificate', label: 'Certificate' })]
    const { container } = render(
      <AddedFields
        modelKey="material"
        objectId="r1"
        exclude={['certificate']}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows a subtyped record’s type and its fields under the subtype’s name', () => {
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
    family.options = [{ type: culture, depth: 1 }]
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
    render(<AddedFields modelKey="experiment" objectId="r1" />)
    expect(screen.getByRole('heading', { name: 'Cell culture' })).toBeTruthy()
    expect(screen.getByText('Type')).toBeTruthy()
    expect(screen.getAllByText('Cell culture')).toHaveLength(2)
    expect(screen.getByText('CHO-K1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change type' })).toBeTruthy()
  })
})
