import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VersionedNotebookTemplatePanel } from './versioned-notebook-templates'

const { navigateMock, instantiateMock, previewUpgradeMock, applyUpgradeMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  instantiateMock: vi.fn(),
  previewUpgradeMock: vi.fn(async () => ({ automatic: [], conflicts: [] })),
  applyUpgradeMock: vi.fn(async () => ({})),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('#/lib/object-dependencies', () => ({
  discoverObjectDependencies: vi.fn(async () => ({ dependencies: [] })),
}))

vi.mock('#/lib/sheet-definition-data', () => ({
  fetchSheetDefinitions: vi.fn(async () => []),
  fetchSheetDefinitionVersions: vi.fn(async () => []),
  sheetDefinitionDataClient: {},
}))

vi.mock('#/lib/notebook-template-data', () => {
  const parameterIdA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const parameterIdB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const templates = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: '99999999-9999-4999-8999-999999999999',
      key: 'alpha',
      name: 'Alpha template',
      description: null,
      lifecycle: 'active',
      revision: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      workspaceId: '99999999-9999-4999-8999-999999999999',
      key: 'beta',
      name: 'Beta template',
      description: null,
      lifecycle: 'active',
      revision: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]
  const versions = [
    {
      id: '33333333-3333-4333-8333-333333333333',
      templateId: templates[0].id,
      version: 2,
      lifecycle: 'published',
      configuration: {
        formatVersion: 1,
        parameters: [
          {
            id: parameterIdA,
            key: 'alpha_required',
            label: 'Alpha required',
            required: true,
            type: { kind: 'scalar', valueType: 'integer' },
            defaultValue: 5,
            constraints: { min: 1, max: 10 },
          },
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            key: 'alpha_decimal',
            label: 'Alpha decimal',
            required: true,
            type: { kind: 'scalar', valueType: 'decimal' },
            constraints: { min: 0.5, max: 3.5 },
          },
          {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            key: 'alpha_boolean',
            label: 'Alpha boolean',
            required: true,
            type: { kind: 'scalar', valueType: 'boolean' },
            constraints: {},
          },
        ],
        placements: [],
      },
      revision: 2,
      publishedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      templateId: templates[1].id,
      version: 1,
      lifecycle: 'published',
      configuration: {
        formatVersion: 1,
        parameters: [
          {
            id: parameterIdB,
            key: 'beta_required',
            label: 'Beta required',
            required: true,
            type: { kind: 'scalar', valueType: 'text' },
            constraints: { minLength: 1 },
          },
        ],
        placements: [],
      },
      revision: 1,
      publishedAt: '2026-01-01T00:00:00Z',
    },
  ]
  return {
    fetchNotebookTemplates: vi.fn(async () => templates),
    fetchAllNotebookTemplateVersions: vi.fn(async () => versions),
    createNotebookTemplate: vi.fn(),
    createNotebookTemplateVersion: vi.fn(),
    publishNotebookTemplateVersion: vi.fn(),
    retireNotebookTemplateVersion: vi.fn(),
    retargetNotebookTemplateSheetPlacement: vi.fn(),
    instantiateNotebookTemplateVersion: instantiateMock,
    previewNotebookTemplateUpgrade: previewUpgradeMock,
    applyNotebookTemplateUpgrade: applyUpgradeMock,
    notebookTemplateDataClient: {},
  }
})

afterEach(() => {
  cleanup()
  instantiateMock.mockReset()
  navigateMock.mockReset()
  previewUpgradeMock.mockClear()
  applyUpgradeMock.mockClear()
})

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <VersionedNotebookTemplatePanel
        workspaceId="99999999-9999-4999-8999-999999999999"
        canEdit
        projects={[
          {
            id: 'project-1',
            key: 'p1',
            title: 'Project one',
          },
        ]}
      />
    </QueryClientProvider>,
  )
}

describe('VersionedNotebookTemplatePanel', () => {
  it('renders parameter inputs from createVersionId even after selecting another template version', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Open' })[1])
    await user.click(screen.getAllByRole('button', { name: 'Create notebook' })[0])
    expect(await screen.findByLabelText('Alpha required')).toBeTruthy()
    expect(screen.queryByLabelText('Beta required')).toBeNull()
  })

  it('submits scalar parameters with typed integer/decimal/boolean values', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(screen.getAllByRole('button', { name: 'Create notebook' })[0])
    await user.clear(screen.getByLabelText('Alpha required'))
    await user.type(screen.getByLabelText('Alpha decimal'), '1.25')
    await user.type(screen.getByLabelText('Alpha boolean'), 'true')
    instantiateMock.mockResolvedValueOnce({
      record: { id: 'rec-1', project_id: 'project-1', identifier: 'NB-1' },
      templateVersionId: '33333333-3333-4333-8333-333333333333',
      idempotent: false,
    })
    await user.click(screen.getByRole('button', { name: 'Create and open' }))
    expect(instantiateMock).toHaveBeenCalledTimes(1)
    const payload = instantiateMock.mock.calls[0][0]
    expect(payload.parameterInputs).toEqual(
      expect.arrayContaining([
        {
          parameterId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          kind: 'scalar',
          value: 5,
        },
        {
          parameterId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          kind: 'scalar',
          value: 1.25,
        },
        {
          parameterId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          kind: 'scalar',
          value: true,
        },
      ]),
    )
  })

  it('blocks submit when a scalar parameter fails validation', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(screen.getAllByRole('button', { name: 'Create notebook' })[0])
    await user.clear(screen.getByLabelText('Alpha required'))
    await user.type(screen.getByLabelText('Alpha required'), '100')
    await user.type(screen.getByLabelText('Alpha decimal'), '1.25')
    await user.type(screen.getByLabelText('Alpha boolean'), 'true')
    await user.click(screen.getByRole('button', { name: 'Create and open' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(instantiateMock).not.toHaveBeenCalled()
  })

  it('blocks submit when a required parameter is missing', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(screen.getAllByRole('button', { name: 'Create notebook' })[0])
    await user.clear(screen.getByLabelText('Alpha boolean'))
    await user.click(screen.getByRole('button', { name: 'Create and open' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(instantiateMock).not.toHaveBeenCalled()
  })

  it('previews and applies explicit notebook template upgrades', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0])
    await user.type(screen.getByLabelText('Notebook record ID'), 'record-123')
    await user.type(screen.getByLabelText('Expected structure version'), '2')
    await user.click(screen.getByRole('button', { name: 'Preview upgrade' }))
    await user.click(screen.getByRole('button', { name: 'Apply upgrade' }))
    expect(previewUpgradeMock).toHaveBeenCalledWith(
      'record-123',
      '33333333-3333-4333-8333-333333333333',
    )
    expect(applyUpgradeMock).toHaveBeenCalledWith({
      recordId: 'record-123',
      expectedStructureVersion: 2,
      targetVersionId: '33333333-3333-4333-8333-333333333333',
      decisions: [],
      parameterInputs: [],
    })
  })
})
