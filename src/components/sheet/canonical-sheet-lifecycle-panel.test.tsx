import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as materializationData from '#/lib/sheet-materialization-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import type { SheetDefinitionConfiguration } from '#/lib/sheet-definition'
import { validSheetDefinitionConfiguration } from '../../../tests/fixtures/sheet-definition'

import {
  CanonicalSheetLifecyclePanel,
  lifecycleErrorText,
} from './canonical-sheet-lifecycle-panel'

const previewExtraction = vi.fn()
const extractDraft = vi.fn()
const fetchPinnedVersion = vi.fn(
  async (
    ..._args: unknown[]
  ): Promise<{
    id: string
    definitionId: string
    version: number
    configuration?: SheetDefinitionConfiguration
  } | null> => null,
)
const fetchDefinitionVersions = vi.fn(
  async (
    ..._args: unknown[]
  ): Promise<Array<{ id: string; version: number; lifecycle: string }>> => [],
)
vi.mock('#/components/v3/ui/object-link', async () => {
  const { objectPath } = await import('#/lib/navigation')
  return {
    ObjectLink: (props: { kind: string; id?: string; children?: string }) => (
      <a href={objectPath(props.kind, props.id ?? '') ?? undefined}>
        {props.children}
      </a>
    ),
  }
})

vi.mock('#/lib/dataset-explorer-data', () => ({
  fetchDatasetSummaries: vi.fn(async () => []),
}))

vi.mock('#/lib/sheet-definition-data', () => ({
  extractSheetDefinitionDraft: (...args: unknown[]) => extractDraft(...args),
  fetchSheetDefinitions: vi.fn(async () => []),
  fetchSheetDefinitionVersion: (...args: unknown[]) =>
    fetchPinnedVersion(...args),
  fetchSheetDefinitionVersions: (...args: unknown[]) =>
    fetchDefinitionVersions(...args),
  previewSheetDefinitionExtraction: (...args: unknown[]) =>
    previewExtraction(...args),
  publishSheetDefinitionVersion: vi.fn(),
  sheetDefinitionDataClient: {},
}))

vi.mock('#/lib/sheet-instance-data', () => ({
  applySheetInstanceDefinitionUpgrade: vi.fn(),
  previewSheetInstanceDefinitionUpgrade: vi.fn(),
}))

vi.mock('#/lib/sheet-composition-adoption', () => ({
  applySheetInstanceCompositionAdoption: vi.fn(),
  previewSheetInstanceCompositionAdoption: vi.fn(),
}))

vi.mock('#/lib/sheet-materialization-data', () => ({
  materializeSheetInstance: vi.fn(),
  previewSheetMaterialization: vi.fn(),
}))

function instance(): SheetInstance {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000002',
    projectId: '20000000-0000-4000-8000-000000000003',
    notebookRecordId: '20000000-0000-4000-8000-000000000004',
    sourceDefinitionVersionId: null,
    name: 'Assay observations',
    description: null,
    lifecycle: 'active',
    revision: 1,
    state: validSheetInstanceState(),
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
  }
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CanonicalSheetLifecyclePanel
        instance={instance()}
        onInstance={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

function renderPanelWithInstance(overrides: Partial<SheetInstance>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CanonicalSheetLifecyclePanel
        instance={{ ...instance(), ...overrides }}
        onInstance={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CanonicalSheetLifecyclePanel', () => {
  it('extracts bound structure and row identity from the pinned Definition without concrete Dataset values', async () => {
    const configuration = validSheetDefinitionConfiguration()
    fetchPinnedVersion.mockResolvedValue({
      id: 'pinned-version-1',
      definitionId: 'definition-1',
      version: 1,
      configuration,
    })
    previewExtraction.mockResolvedValue({})
    extractDraft.mockResolvedValue({
      definition: { id: 'extracted-1', name: 'Extracted sheet' },
      version: { id: 'extracted-version-1', revision: 1 },
    })
    renderPanelWithInstance({ sourceDefinitionVersionId: 'pinned-version-1' })
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Sources, extract, upgrade' }),
    )
    await user.click(screen.getByRole('button', { name: 'Extract draft' }))
    await screen.findByRole('link', { name: 'Review Sheet Definition' })
    expect(extractDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: expect.objectContaining({
          bindings: configuration.bindings.map((binding) => ({
            bindingId: binding.id,
            key: binding.key,
            parameter: configuration.parameters.find(
              (parameter) => parameter.id === binding.parameterId,
            ),
          })),
          columnIds: configuration.columns
            .filter((column) => column.source.kind !== 'calculated')
            .map((column) => column.id),
          joinIds: configuration.joins.map((join) => join.id),
          rowIdentity: configuration.rowIdentity,
        }),
      }),
    )
  })
  it('takes an extracted Definition directly to its governed configuration', async () => {
    const user = userEvent.setup()
    previewExtraction.mockResolvedValue({})
    extractDraft.mockResolvedValue({
      definition: { id: 'definition-1', name: 'Assay definition' },
      version: { id: 'version-1', revision: 1 },
    })
    renderPanel()

    await user.click(
      screen.getByRole('button', { name: 'Sources, extract, upgrade' }),
    )
    await user.type(screen.getByLabelText('Definition key'), 'assay_results')
    await user.click(screen.getByRole('button', { name: 'Extract draft' }))

    const continueLink = await screen.findByRole('link', {
      name: 'Review Sheet Definition',
    })
    expect(continueLink.getAttribute('href')).toContain(
      '/sheet-definitions/definition-1?version=version-1&returnTo=%2Fsheets%2F',
    )
    await waitFor(() => expect(extractDraft).toHaveBeenCalledTimes(1))
  })
  it('surfaces an upgrade badge when a newer published Definition version exists', async () => {
    fetchPinnedVersion.mockResolvedValue({
      id: 'pinned-version-1',
      definitionId: 'definition-1',
      version: 1,
    })
    fetchDefinitionVersions.mockResolvedValue([
      { id: 'pinned-version-1', version: 1, lifecycle: 'published' },
      { id: 'pinned-version-2', version: 2, lifecycle: 'published' },
    ])
    renderPanelWithInstance({ sourceDefinitionVersionId: 'pinned-version-1' })
    expect(await screen.findByText('Upgrade available · v2')).toBeTruthy()
  })
  it('stays silent when the pinned Definition version is current', async () => {
    fetchPinnedVersion.mockResolvedValue({
      id: 'pinned-version-2',
      definitionId: 'definition-1',
      version: 2,
    })
    fetchDefinitionVersions.mockResolvedValue([
      { id: 'pinned-version-1', version: 1, lifecycle: 'published' },
      { id: 'pinned-version-2', version: 2, lifecycle: 'published' },
    ])
    renderPanelWithInstance({ sourceDefinitionVersionId: 'pinned-version-2' })
    await waitFor(() => expect(fetchDefinitionVersions).toHaveBeenCalled())
    expect(screen.queryByText(/Upgrade available/)).toBeNull()
  })

  it('writes no Dataset until the confirmation is accepted, and none on cancel', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(
      screen.getByRole('button', { name: 'Sources, extract, upgrade' }),
    )
    await user.click(screen.getByRole('button', { name: 'Apply materialise' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(
      materializationData.previewSheetMaterialization,
    ).not.toHaveBeenCalled()
    expect(materializationData.materializeSheetInstance).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(materializationData.materializeSheetInstance).not.toHaveBeenCalled()
  })

  it('lands on the new dataset after materialising', async () => {
    const user = userEvent.setup()
    vi.mocked(
      materializationData.previewSheetMaterialization,
    ).mockResolvedValue({ previewDigest: 'digest-0123456789abcdef' } as never)
    vi.mocked(materializationData.materializeSheetInstance).mockResolvedValue({
      datasetId: 'dataset-9',
    } as never)
    renderPanel()

    await user.click(
      screen.getByRole('button', { name: 'Sources, extract, upgrade' }),
    )
    await user.click(screen.getByRole('button', { name: 'Apply materialise' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Apply materialise' }),
    )

    const link = await screen.findByRole('link', {
      name: 'Open the new dataset',
    })
    expect(link.getAttribute('href')).toBe('/datasets/dataset-9')
  })

  it('publishes no Definition until the extract-and-publish confirmation is accepted', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(
      screen.getByRole('button', { name: 'Sources, extract, upgrade' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Extract and publish' }),
    )

    const dialog = await screen.findByRole('alertdialog')
    expect(extractDraft).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(extractDraft).not.toHaveBeenCalled()
  })
})

describe('lifecycleErrorText', () => {
  it('points a local-only sheet at promotion instead of the server code', () => {
    expect(
      lifecycleErrorText('active Definition-backed Sheet Instance required'),
    ).toMatch(/promote a column into a Dataset Schema/)
    expect(
      lifecycleErrorText(
        'invalid extracted Definition configuration: local row identity must be one declared reference UUID column',
      ),
    ).toMatch(/promote a column into a Dataset Schema/)
  })

  it('leaves any other refusal as the server wrote it', () => {
    expect(lifecycleErrorText('stale revision')).toBe('stale revision')
  })
})
