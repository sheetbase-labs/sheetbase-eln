import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VersionedNotebookTemplatePanel } from './versioned-notebook-templates'

const {
  navigateMock,
  instantiateMock,
  previewUpgradeMock,
  applyUpgradeMock,
  PLACEMENT,
  MAPPED_PARAM,
  COLUMN,
  REPLACEMENT,
} = vi.hoisted(() => {
  const RECORD = '55555555-5555-4555-8555-555555555555'
  const PLACEMENT = '66666666-6666-4666-8666-666666666666'
  const MAPPED_PARAM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const DEF_PARAM = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  const INSTANCE = '77777777-7777-4777-8777-777777777777'
  const COLUMN = '88888888-8888-4888-8888-888888888888'
  const REPLACEMENT = '99999999-9999-4999-8999-999999999999'
  const DEFINITION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const SOURCE_VER = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const TARGET_VER = 'cccccccc-dddd-4eee-8fff-000000000000'
  return {
    navigateMock: vi.fn(),
    instantiateMock: vi.fn(),
    previewUpgradeMock: vi.fn(async () => ({
      recordId: RECORD,
      sourceVersionId: '33333333-3333-4333-8333-333333333333',
      targetVersionId: '33333333-3333-4333-8333-333333333333',
      automatic: [],
      conflicts: [
        {
          id: `placement:${PLACEMENT}`,
          kind: 'sheet-definition-conflict',
          placementId: PLACEMENT,
          instanceId: INSTANCE,
          allowedOutcomes: ['keep', 'retarget'],
          instancePreview: {
            source: {
              instanceId: INSTANCE,
              instanceRevision: 3,
              definitionId: DEFINITION,
              versionId: SOURCE_VER,
              version: 1,
            },
            target: {
              definitionId: DEFINITION,
              versionId: TARGET_VER,
              version: 2,
            },
            automaticChanges: [],
            conflicts: [
              {
                id: `column-removed:${COLUMN}`,
                kind: 'column-removed',
                sourceId: COLUMN,
                targetCandidates: [REPLACEMENT],
                allowedOutcomes: ['retain-local', 'map', 'defer'],
                instanceReferences: {
                  localField: true,
                  localValueCount: 1,
                  calculationIds: [],
                  calculationOverride: false,
                  presentation: false,
                },
              },
            ],
            preserved: {
              localFieldIds: [COLUMN],
              localValueRowCount: 1,
              instanceCalculationIds: [],
              calculationOverrideIds: [],
              presentationOwnedByInstance: true,
              bindingProvenanceRevalidated: true,
              writeOwnershipFromTarget: true,
            },
          },
        },
      ],
    })),
    applyUpgradeMock: vi.fn(async () => ({})),
    RECORD,
    PLACEMENT,
    MAPPED_PARAM,
    DEF_PARAM,
    INSTANCE,
    COLUMN,
    REPLACEMENT,
    DEFINITION,
    SOURCE_VER,
    TARGET_VER,
  }
})

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
  const mappedParam = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const defParam = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  const placement = '66666666-6666-4666-8666-666666666666'
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
          {
            id: mappedParam,
            key: 'alpha_optional',
            label: 'Mapped optional',
            required: false,
            type: { kind: 'scalar', valueType: 'text' },
            constraints: {},
          },
          {
            id: '12121212-1212-4121-8121-121212121212',
            key: 'reference_sample',
            label: 'Reference sample',
            required: false,
            type: { kind: 'record', modelKey: 'sample' },
            constraints: {},
          },
        ],
        placements: [
          {
            id: placement,
            kind: 'sheet',
            order: 1,
            definitionVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            parameterMappings: [
              {
                templateParameterId: mappedParam,
                definitionParameterId: defParam,
              },
            ],
          },
        ],
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
    notebookTemplateDataClient: {
      list: vi.fn(async (resource: string) => {
        if (resource !== 'records') return []
        return [
          {
            id: '13131313-1313-4131-8131-131313131313',
            workspace_id: '99999999-9999-4999-8999-999999999999',
            project_id: null,
            folder_id: null,
            kind: 'sample',
            identifier: 'SAM-001',
            title: 'Reference sample',
            status: 'available',
            tags: [],
            structure_version: 1,
            metadata_version: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            archived_at: null,
            deleted_at: null,
            created_by_user_id: 'user-1',
            updated_by_user_id: null,
            locked_at: null,
            locked_by_revision_id: null,
          },
        ]
      }),
    },
  }
})

afterEach(() => {
  cleanup()
  instantiateMock.mockReset()
  navigateMock.mockReset()
  previewUpgradeMock.mockClear()
  applyUpgradeMock.mockClear()
})

function mount(
  props: Partial<ComponentProps<typeof VersionedNotebookTemplatePanel>> = {},
) {
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
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('VersionedNotebookTemplatePanel', () => {
  it('does not invent a URL-backed selection when controlled without one', async () => {
    const onSelectedTemplateIdChange = vi.fn()
    mount({
      selectedTemplateId: null,
      onSelectedTemplateIdChange,
    })
    await screen.findByText('Alpha template')
    expect(onSelectedTemplateIdChange).not.toHaveBeenCalled()
  })

  it('honours controlled selectedTemplateId and notifies on Open', async () => {
    const user = userEvent.setup()
    const onSelectedTemplateIdChange = vi.fn()
    mount({
      selectedTemplateId: '22222222-2222-4222-8222-222222222222',
      onSelectedTemplateIdChange,
    })
    await screen.findByText('Beta template')
    expect(screen.getByRole('button', { name: 'v1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'v2' })).toBeNull()
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0])
    expect(onSelectedTemplateIdChange).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    )
  })

  it('renders parameter inputs from createVersionId even after selecting another template version', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Open' })[1])
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    expect(await screen.findByLabelText(/Alpha required/)).toBeTruthy()
    expect(screen.queryByLabelText(/Beta required/)).toBeNull()
  })

  it('submits scalar parameters with typed integer/decimal/boolean values', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    await user.clear(screen.getByLabelText(/Alpha required/))
    await user.type(screen.getByLabelText(/Alpha decimal/), '1.25')
    await user.type(screen.getByLabelText(/Alpha boolean/), 'true')
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

  it('submits a selected governed Record parameter to the instantiation contract', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    await user.selectOptions(
      await screen.findByLabelText(/Reference sample/),
      '13131313-1313-4131-8131-131313131313',
    )
    await user.type(screen.getByLabelText(/Alpha decimal/), '1.25')
    await user.type(screen.getByLabelText(/Alpha boolean/), 'true')
    instantiateMock.mockResolvedValueOnce({
      record: { id: 'rec-1', project_id: 'project-1', identifier: 'NB-1' },
      templateVersionId: '33333333-3333-4333-8333-333333333333',
      idempotent: false,
    })

    await user.click(screen.getByRole('button', { name: 'Create and open' }))

    expect(instantiateMock.mock.calls[0][0].parameterInputs).toContainEqual({
      parameterId: '12121212-1212-4121-8121-121212121212',
      kind: 'record',
      recordId: '13131313-1313-4131-8131-131313131313',
    })
  })

  it('blocks submit when a scalar parameter fails validation', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    await user.clear(screen.getByLabelText(/Alpha required/))
    await user.type(screen.getByLabelText(/Alpha required/), '100')
    await user.type(screen.getByLabelText(/Alpha decimal/), '1.25')
    await user.type(screen.getByLabelText(/Alpha boolean/), 'true')
    await user.click(screen.getByRole('button', { name: 'Create and open' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(instantiateMock).not.toHaveBeenCalled()
  })

  it('blocks submit when a required parameter is missing', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    await user.clear(screen.getByLabelText(/Alpha boolean/))
    await user.click(screen.getByRole('button', { name: 'Create and open' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(instantiateMock).not.toHaveBeenCalled()
  })

  it('omits optional scalar template parameters without a default', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    await user.type(screen.getByLabelText(/Alpha decimal/), '1.25')
    await user.type(screen.getByLabelText(/Alpha boolean/), 'true')
    instantiateMock.mockResolvedValueOnce({
      record: { id: 'rec-1', project_id: 'project-1', identifier: 'NB-1' },
      templateVersionId: '33333333-3333-4333-8333-333333333333',
      idempotent: false,
    })
    await user.click(screen.getByRole('button', { name: 'Create and open' }))
    const payload = instantiateMock.mock.calls[0][0]
    expect(
      payload.parameterInputs.some(
        (item: { parameterId: string }) => item.parameterId === MAPPED_PARAM,
      ),
    ).toBe(false)
  })

  it('previews conflicted upgrades, collects nested Sheet decisions, and submits parameters', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0])
    await user.type(screen.getByLabelText('Notebook record ID'), 'record-123')
    await user.type(screen.getByLabelText('Expected structure version'), '2')
    await user.click(screen.getByRole('button', { name: 'Preview upgrade' }))
    expect(await screen.findByText(`placement:${PLACEMENT}`)).toBeTruthy()
    await user.selectOptions(
      document.getElementById(
        `template-upgrade-conflict-placement:${PLACEMENT}`,
      )!,
      'retarget',
    )
    await user.selectOptions(
      document.getElementById(`upgrade-conflict-column-removed:${COLUMN}`)!,
      'map',
    )
    await user.selectOptions(
      document.getElementById(
        `upgrade-conflict-column-removed:${COLUMN}-target`,
      )!,
      REPLACEMENT,
    )
    await user.click(screen.getByRole('button', { name: 'Apply upgrade' }))
    expect(previewUpgradeMock).toHaveBeenCalledWith(
      'record-123',
      '33333333-3333-4333-8333-333333333333',
    )
    expect(applyUpgradeMock).toHaveBeenCalledWith({
      recordId: 'record-123',
      expectedStructureVersion: 2,
      targetVersionId: '33333333-3333-4333-8333-333333333333',
      decisions: [
        {
          conflictId: `placement:${PLACEMENT}`,
          outcome: 'retarget',
          instanceDecisions: [
            {
              conflictId: `column-removed:${COLUMN}`,
              outcome: 'map',
              targetId: REPLACEMENT,
            },
          ],
        },
      ],
      parameterInputs: [],
    })
  })
})

describe('REUSE-01 VersionedNotebookTemplatePanel — facets and requirement previews', () => {
  it('previews instantiation needs for every catalogue entry', async () => {
    mount()
    await screen.findByText('Alpha template')
    expect(
      await screen.findByText('3 required · 2 optional · 1 placement'),
    ).toBeTruthy()
    expect(screen.getByText('1 required · 0 placements')).toBeTruthy()
  })

  it('breaks down required parameters for the selected version', async () => {
    mount()
    expect(await screen.findByText('Alpha required')).toBeTruthy()
    expect(screen.getByText(/scalar · integer/)).toBeTruthy()
  })

  it('filters the catalogue by latest lifecycle', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.selectOptions(
      screen.getByLabelText(/filter by lifecycle/i),
      'draft',
    )
    expect(screen.queryByText('Alpha template')).toBeNull()
    expect(
      screen.getByText(/no notebook templates match the current filters/i),
    ).toBeTruthy()
    await user.selectOptions(
      screen.getByLabelText(/filter by lifecycle/i),
      'published',
    )
    expect(await screen.findByText('Alpha template')).toBeTruthy()
  })

  it('filters the catalogue by instantiation needs', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.selectOptions(
      screen.getByLabelText(/filter by instantiation needs/i),
      'none',
    )
    expect(screen.queryByText('Alpha template')).toBeNull()
    await user.selectOptions(
      screen.getByLabelText(/filter by instantiation needs/i),
      'has-required',
    )
    expect(await screen.findByText('Alpha template')).toBeTruthy()
    expect(await screen.findByText('Beta template')).toBeTruthy()
  })

  it('previews needs in the create-notebook dialog', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    expect(await screen.findByText(/this version needs:/i)).toBeTruthy()
  })
})

describe('REUSE-02 VersionedNotebookTemplatePanel — composition depth', () => {
  it('pre-fills declared defaults visibly on open', { timeout: 30000 }, async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    // Generous timeout: under parallel CI workers the dialog's async version
    // load can exceed the default 1s findBy budget (flake, see #165).
    expect(
      await screen.findByDisplayValue('5', undefined, { timeout: 5000 }),
    ).toBeTruthy()
    expect(screen.getByPlaceholderText('Default: 5')).toBeTruthy()
  })

  it('names missing required parameters and blocks creation fail-closed', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    expect(
      await screen.findByText(/Missing required: Alpha decimal, Alpha boolean/),
    ).toBeTruthy()
    // tsc resolves getByRole to HTMLElement (no .disabled), so the
    // assertion below is load-bearing despite the lint rule.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const createButton = screen.getByRole('button', {
      name: 'Create and open',
    }) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)
    expect(instantiateMock).not.toHaveBeenCalled()
  })

  it('enables creation once every required input resolves', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    await user.type(screen.getByLabelText(/Alpha decimal/), '1.25')
    await user.type(screen.getByLabelText(/Alpha boolean/), 'true')
    expect(screen.queryByText(/Missing required:/)).toBeNull()
    instantiateMock.mockResolvedValueOnce({
      record: { id: 'rec-1', project_id: 'project-1', identifier: 'NB-1' },
      templateVersionId: '33333333-3333-4333-8333-333333333333',
      composition: [],
      idempotent: false,
    })
    await user.click(screen.getByRole('button', { name: 'Create and open' }))
    expect(instantiateMock).toHaveBeenCalledTimes(1)
  })

  it('previews composed sheet parts with governed pins and mapped inputs', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alpha template')
    await user.click(
      screen.getAllByRole('button', { name: 'Create notebook' })[0],
    )
    expect(await screen.findByText('Composed sheets')).toBeTruthy()
    expect(screen.getByText(/governed pin aaaaaaaa/)).toBeTruthy()
    expect(screen.getByText(/Mapped optional \(optional\)/)).toBeTruthy()
    expect(screen.getByText(/no part mutates another/i)).toBeTruthy()
  })
})
