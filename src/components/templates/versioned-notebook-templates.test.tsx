import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VersionedNotebookTemplatePanel } from './versioned-notebook-templates'

const { navigateMock, instantiateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  instantiateMock: vi.fn(),
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
            type: { kind: 'scalar' },
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
            type: { kind: 'scalar' },
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
    notebookTemplateDataClient: {},
  }
})

afterEach(() => {
  cleanup()
  instantiateMock.mockReset()
  navigateMock.mockReset()
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

  it('blocks submit when a required parameter is missing', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(screen.getAllByRole('button', { name: 'Create notebook' })[0])
    await user.click(screen.getByRole('button', { name: 'Create and open' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(instantiateMock).not.toHaveBeenCalled()
  })
})
