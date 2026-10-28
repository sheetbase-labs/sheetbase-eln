import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecordModelNew } from './record-model-new'
import type * as modelsData from './models-data'

const mocks = vi.hoisted(() => ({
  fields: [] as unknown[],
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {}))
      href = href.replace(`$${key}`, encodeURIComponent(String(value)))
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
  useNavigate: () => mocks.navigate,
}))

vi.mock('./model-subtype-data', () => ({
  useModelTypes: () => ({ data: [], isLoading: false }),
  useTypeFields: () => ({ data: [], isLoading: false, isError: false }),
}))

vi.mock('./models-data', async (importOriginal) => {
  const actual = await importOriginal<typeof modelsData>()
  return {
    ...actual,
    useWorkspaceRecordModel: () => ({
      data: { name: 'Cell bank', identifier_prefix: 'CB', current_version: 1 },
      isLoading: false,
    }),
    useRecordModelFields: () => ({ data: mocks.fields, isLoading: false }),
    useModelRules: () => ({ data: [], isLoading: false }),
    useRecordModelProjects: () => ({
      data: [{ id: 'p1', title: 'Project A' }],
      isLoading: false,
    }),
    useRecordModelRecords: () => ({ data: [], isLoading: false }),
  }
})

const categoryField = {
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

const passageField = {
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
  mocks.fields = []
})

function renderForm() {
  mocks.fields = [categoryField, passageField]
  render(<RecordModelNew modelKey="cell_bank" />)
}

describe('RecordModelNew — generated form', () => {
  it('does not paint validation errors on a pristine form', () => {
    renderForm()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('accepts an embedded category option and enables Create', () => {
    renderForm()
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
    expect((create as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the outstanding errors once the person has interacted', () => {
    renderForm()
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
})
