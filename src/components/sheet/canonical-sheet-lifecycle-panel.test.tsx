import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'

import { CanonicalSheetLifecyclePanel } from './canonical-sheet-lifecycle-panel'

const previewExtraction = vi.fn()
const extractDraft = vi.fn()

vi.mock('#/lib/dataset-explorer-data', () => ({
  fetchDatasetSummaries: vi.fn(async () => []),
}))

vi.mock('#/lib/sheet-definition-data', () => ({
  extractSheetDefinitionDraft: (...args: unknown[]) => extractDraft(...args),
  fetchSheetDefinitions: vi.fn(async () => []),
  fetchSheetDefinitionVersions: vi.fn(async () => []),
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

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CanonicalSheetLifecyclePanel', () => {
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
      name: 'Continue in Configure',
    })
    expect(continueLink.getAttribute('href')).toBe(
      '/configure?kind=definition&id=definition-1',
    )
    await waitFor(() => expect(extractDraft).toHaveBeenCalledTimes(1))
  })
})
