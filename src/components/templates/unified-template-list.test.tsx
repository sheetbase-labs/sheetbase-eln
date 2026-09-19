/**
 * TPL-001 unified Template Library tests: one table carrying both the
 * canonical notebook catalogue and protocol_template records with a Type
 * column, typed row selection, per-catalogue favourites, status pills from
 * the shared vocabulary, and the compact notebook-template inspector.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render as testingLibraryRender,
  screen,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  NotebookTemplateInspector,
  UnifiedTemplateFilters,
  UnifiedTemplateTable,
} from './unified-template-list'
import type { UnifiedTemplateRow } from './unified-template-list'
import type { NotebookRecord } from '#/lib/notebook-data'
import type {
  NotebookTemplate,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'

// jsdom does not implement ResizeObserver; radix tabs read it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => cleanup())

function render(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return testingLibraryRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  )
}

function protocolRecord(
  overrides: Partial<NotebookRecord> = {},
): NotebookRecord {
  return {
    id: 'prt-1',
    projectId: 'p-1',
    kind: 'protocol_template',
    identifier: 'PRT-2026-0001',
    title: 'Titration Assay',
    status: 'active',
    tags: ['titration'],
    structureVersion: 1,
    metadataVersion: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u-1',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
    ...overrides,
  }
}

function notebookTemplate(
  overrides: Partial<NotebookTemplate> = {},
): NotebookTemplate {
  return {
    id: 'nbk-1',
    workspaceId: 'w-1',
    key: 'stability_study_ich',
    name: 'Stability Study (ICH)',
    description: 'ICH Q1A long-term + accelerated',
    lifecycle: 'active',
    revision: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-02T00:00:00Z',
    ...overrides,
  }
}

function notebookVersion(
  overrides: Partial<NotebookTemplateVersion> = {},
): NotebookTemplateVersion {
  return {
    id: 'nbv-1',
    templateId: 'nbk-1',
    version: 3,
    lifecycle: 'published',
    configuration: {
      formatVersion: 1,
      parameters: [],
      placements: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          kind: 'narrative',
          order: 1,
          blockType: 'rich_text',
          payload: {},
        },
      ],
    },
    revision: 1,
    publishedAt: '2026-02-01T00:00:00Z',
    createdByUserId: 'u-2',
    ...overrides,
  }
}

function rows(): UnifiedTemplateRow[] {
  const record = protocolRecord()
  const template = notebookTemplate()
  const latest = notebookVersion()
  return [
    {
      type: 'protocol',
      record,
      id: record.id,
      identifier: record.identifier,
      title: record.title,
      subline: 'titration',
      versionLabel: 'v2',
      statusKey: 'active',
      blocks: 4,
      used: 31,
      updatedAt: record.updatedAt,
      ownerId: record.createdByUserId,
    },
    {
      type: 'notebook',
      template,
      latest,
      id: template.id,
      identifier: template.key,
      title: template.name,
      subline: template.description,
      versionLabel: 'v3',
      statusKey: 'published',
      blocks: 1,
      used: 14,
      updatedAt: template.updatedAt,
      ownerId: 'u-2',
    },
  ]
}

function tableProps(overrides: Record<string, unknown> = {}) {
  return {
    rows: rows(),
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    selectedId: null,
    onSelect: vi.fn(),
    isFavourite: () => false,
    onToggleFavourite: vi.fn(),
    view: 'list' as const,
    ...overrides,
  }
}

describe('UnifiedTemplateTable', () => {
  it('renders both catalogues in one table with a Type column', () => {
    render(<UnifiedTemplateTable {...tableProps()} />)

    expect(screen.getByText('PRT-2026-0001')).toBeTruthy()
    expect(screen.getByText('stability_study_ich')).toBeTruthy()
    expect(screen.getByText('Titration Assay')).toBeTruthy()
    expect(screen.getByText('Stability Study (ICH)')).toBeTruthy()
    // Paper anatomy: Type column distinguishes the two catalogues.
    expect(screen.getByText('Notebook')).toBeTruthy()
    expect(screen.getByText('Protocol')).toBeTruthy()
    expect(screen.getByText('v3')).toBeTruthy()
    expect(screen.getByText('31')).toBeTruthy()
    expect(screen.getByText('14')).toBeTruthy()
  })

  it('selects a row with its catalogue type for deep links', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<UnifiedTemplateTable {...tableProps({ onSelect })} />)

    await user.click(
      screen.getByRole('button', { name: /^Stability Study \(ICH\)/ }),
    )
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notebook', id: 'nbk-1' }),
    )

    await user.click(
      screen.getByRole('button', { name: /^Titration Assay/ }),
    )
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'protocol', id: 'prt-1' }),
    )
  })

  it('fires the favourite toggle from the row star', async () => {
    const user = userEvent.setup()
    const onToggleFavourite = vi.fn()
    render(
      <UnifiedTemplateTable {...tableProps({ onToggleFavourite })} />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Favourite Titration Assay' }),
    )
    expect(onToggleFavourite).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'protocol', id: 'prt-1' }),
    )
  })

  it('marks the selected row', () => {
    render(<UnifiedTemplateTable {...tableProps({ selectedId: 'nbk-1' })} />)
    const title = screen.getByRole('button', {
      name: /^Stability Study \(ICH\)/,
    })
    expect(title.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows an empty state when no rows match', () => {
    render(<UnifiedTemplateTable {...tableProps({ rows: [] })} />)
    expect(
      screen.getByText('No templates match the current filters.'),
    ).toBeTruthy()
  })

  it('renders grid cards in grid view', () => {
    render(
      <UnifiedTemplateTable {...tableProps({ view: 'grid' as const })} />,
    )
    expect(screen.getByText('Titration Assay')).toBeTruthy()
    expect(screen.getByText('Stability Study (ICH)')).toBeTruthy()
    expect(screen.getByText('1 placements')).toBeTruthy()
  })
})

describe('UnifiedTemplateFilters', () => {
  function filterProps(overrides: Record<string, unknown> = {}) {
    return {
      search: '',
      onSearchChange: vi.fn(),
      typeFilter: 'all' as const,
      onTypeChange: vi.fn(),
      statusFilter: 'all' as const,
      onStatusChange: vi.fn(),
      ownership: 'all' as const,
      onOwnershipChange: vi.fn(),
      favouritesOnly: false,
      onFavouritesOnlyChange: vi.fn(),
      view: 'list' as const,
      onViewChange: vi.fn(),
      purposeFilter: 'all',
      onPurposeChange: vi.fn(),
      purposeOptions: [],
      needsFilter: 'all' as const,
      onNeedsChange: vi.fn(),
      count: 12,
      ...overrides,
    }
  }

  it('shows the unified count and filter controls', () => {
    render(<UnifiedTemplateFilters {...filterProps()} />)
    expect(screen.getByText('12 templates')).toBeTruthy()
    expect(screen.getByLabelText('Filter by type')).toBeTruthy()
    expect(screen.getByLabelText('Filter by status')).toBeTruthy()
    expect(screen.getByLabelText('Filter by owner')).toBeTruthy()
  })

  it('toggles the favourites-only filter', async () => {
    const user = userEvent.setup()
    const onFavouritesOnlyChange = vi.fn()
    render(
      <UnifiedTemplateFilters
        {...filterProps({ onFavouritesOnlyChange })}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Favourites/ }))
    expect(onFavouritesOnlyChange).toHaveBeenCalledWith(true)
  })

  it('switches between list and grid views', async () => {
    const user = userEvent.setup()
    const onViewChange = vi.fn()
    render(<UnifiedTemplateFilters {...filterProps({ onViewChange })} />)
    await user.click(screen.getByRole('button', { name: 'Grid view' }))
    expect(onViewChange).toHaveBeenCalledWith('grid')
  })
})

describe('NotebookTemplateInspector', () => {
  it('summarises the template and offers create from a published version', async () => {
    const user = userEvent.setup()
    const onInstantiate = vi.fn()
    render(
      <NotebookTemplateInspector
        template={notebookTemplate()}
        versions={[notebookVersion()]}
        usedCount={14}
        currentUserId="u-1"
        canEdit
        onInstantiate={onInstantiate}
      />,
    )

    expect(screen.getByText('Notebook template')).toBeTruthy()
    expect(screen.getByText('Stability Study (ICH)')).toBeTruthy()
    expect(screen.getByText('Records created')).toBeTruthy()
    expect(screen.getByText('14')).toBeTruthy()

    await user.click(
      screen.getByRole('button', { name: 'Create notebook' }),
    )
    expect(onInstantiate).toHaveBeenCalledWith('nbv-1')
  })

  it('disables create when no published version exists', () => {
    render(
      <NotebookTemplateInspector
        template={notebookTemplate()}
        versions={[notebookVersion({ lifecycle: 'draft', publishedAt: null })]}
        usedCount={0}
        canEdit={false}
        onInstantiate={vi.fn()}
      />,
    )
    const button = screen.getByRole('button', { name: 'Create notebook' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByText('You have read-only access to this template.'),
    ).toBeTruthy()
  })
})
