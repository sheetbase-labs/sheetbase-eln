/**
 * SCI-006 Template Library component tests: list loading/empty/error/active/
 * archived states, filters, inspector rendering, use-template action flow,
 * and keyboard accessibility.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TemplateActions,
  TemplateFilters,
  TemplateInspector,
  TemplateList,
} from './template-library'
import type { TemplateProject } from './template-library'
import type { NotebookRecord, NotebookBlock } from '#/lib/notebook-data'

// jsdom does not implement ResizeObserver; radix tabs read it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Stub the router Link as a plain anchor so no route tree is required for
// inspector tests that render linked-record / open-record links.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: { to: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

afterEach(() => cleanup())

function template(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: 't-1',
    projectId: 'p-1',
    kind: 'notebook_template',
    identifier: 'NBK-2026-0001',
    title: 'Stability Study',
    status: 'validated',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
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

const projects: TemplateProject[] = [
  { id: 'p-1', key: 'vs', title: 'Virus Stability' },
]

const blocks: NotebookBlock[] = [
  {
    id: 'b-1',
    recordId: 't-1',
    type: 'rich_text',
    payload: {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Objective' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Test stability.' }],
          },
        ],
      },
    },
    order: 1,
    version: 1,
    payloadSchemaVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdByUserId: 'u-1',
  } as NotebookBlock,
]

describe('TemplateList', () => {
  it('shows a loading indicator while templates are loading', () => {
    render(
      <TemplateList
        templates={[]}
        isLoading
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText(/loading templates/i)).toBeTruthy()
    expect(
      screen.getByText(/loading templates/i).getAttribute('aria-busy'),
    ).toBe('true')
  })

  it('shows an empty state when there are no templates', () => {
    render(
      <TemplateList
        templates={[]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText(/no protocol templates found/i)).toBeTruthy()
  })

  it('shows an error state with a retry button', () => {
    const onRetry = vi.fn()
    render(
      <TemplateList
        templates={[]}
        isLoading={false}
        error={new Error('boom')}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/could not load templates/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('renders active templates with title, identifier, type and a Ready indicator', () => {
    render(
      <TemplateList
        templates={[
          template({
            id: 't-1',
            title: 'Stability Study',
            status: 'validated',
          }),
          template({
            id: 't-2',
            identifier: 'NBK-2026-0002',
            title: 'Cell Viability',
            status: 'draft',
          }),
        ]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('Stability Study')).toBeTruthy()
    expect(screen.getByText('NBK-2026-0001')).toBeTruthy()
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Cell Viability')).toBeTruthy()
  })

  it('renders archived templates with an Archived badge and no Ready indicator', () => {
    render(
      <TemplateList
        templates={[
          template({
            id: 't-arch',
            identifier: 'PRT-2026-0003',
            title: 'Old ELISA',
            kind: 'protocol_template',
            status: 'active',
            archivedAt: '2026-02-01T00:00:00Z',
          }),
        ]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('Old ELISA')).toBeTruthy()
    expect(screen.getAllByText('Archived').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Ready')).toBeNull()
  })

  it('selects a template on click and reports the id', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <TemplateList
        templates={[template({ id: 't-1' })]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={onSelect}
        onRetry={vi.fn()}
      />,
    )
    await user.click(screen.getByText('Stability Study'))
    expect(onSelect).toHaveBeenCalledWith('t-1')
  })

  it('marks the selected template with aria-pressed', () => {
    render(
      <TemplateList
        templates={[template({ id: 't-1' })]}
        isLoading={false}
        error={null}
        selectedId="t-1"
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    const row = screen.getByText('Stability Study').closest('[role="button"]')
    expect(row?.getAttribute('aria-pressed')).toBe('true')
  })

  it('exposes the list with a role="list"', () => {
    render(
      <TemplateList
        templates={[template({ id: 't-1' })]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByRole('list')).toBeTruthy()
  })
})

describe('TemplateFilters', () => {
  it('renders accessible search and status controls', () => {
    render(
      <TemplateFilters
        statusFilter="all"
        onStatusChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/search templates/i)).toBeTruthy()
    expect(screen.queryByLabelText(/filter by type/i)).toBeNull()
    expect(screen.getByLabelText(/filter by status/i)).toBeTruthy()
  })

  it('forwards search changes to onSearchChange', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    render(
      <TemplateFilters
        statusFilter="all"
        onStatusChange={vi.fn()}
        search=""
        onSearchChange={onSearchChange}
      />,
    )
    await user.type(screen.getByLabelText(/search templates/i), 'stab')
    expect(onSearchChange).toHaveBeenCalled()
  })
})

describe('TemplateInspector', () => {
  it('renders the inspector header with template type and title', () => {
    render(
      <TemplateInspector
        template={template({ id: 't-1' })}
        blocks={blocks}
        blocksLoading={false}
        projects={projects}
        onInstantiate={vi.fn()}
        isInstantiating={false}
        instantiationError={null}
        instantiationSuccess={null}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Stability Study' }),
    ).toBeTruthy()
    expect(screen.getAllByText('Notebook').length).toBeGreaterThanOrEqual(1)
  })

  it('shows details and a use-template form on the Details tab for an instantiable template', () => {
    render(
      <TemplateInspector
        template={template({ id: 't-1', status: 'validated' })}
        blocks={blocks}
        blocksLoading={false}
        projects={projects}
        onInstantiate={vi.fn()}
        isInstantiating={false}
        instantiationError={null}
        instantiationSuccess={null}
      />,
    )
    expect(screen.getByRole('tab', { name: /details/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /preview/i })).toBeTruthy()
    expect(screen.getByText('NBK-2026-0001')).toBeTruthy()
    expect(screen.getByLabelText(/new record title/i)).toBeTruthy()
    expect(screen.getByLabelText(/target project/i)).toBeTruthy()
  })

  it('shows a warning for a draft template and no use-template form', () => {
    render(
      <TemplateInspector
        template={template({ id: 't-1', status: 'draft' })}
        blocks={blocks}
        blocksLoading={false}
        projects={projects}
        onInstantiate={vi.fn()}
        isInstantiating={false}
        instantiationError={null}
        instantiationSuccess={null}
      />,
    )
    expect(screen.getByText(/must be validated/i)).toBeTruthy()
    expect(screen.queryByLabelText(/new record title/i)).toBeNull()
  })

  it('shows a warning for an archived template', () => {
    render(
      <TemplateInspector
        template={template({
          id: 't-1',
          status: 'validated',
          archivedAt: '2026-02-01T00:00:00Z',
        })}
        blocks={blocks}
        blocksLoading={false}
        projects={projects}
        onInstantiate={vi.fn()}
        isInstantiating={false}
        instantiationError={null}
        instantiationSuccess={null}
      />,
    )
    expect(
      screen.getByText(/archived and cannot be instantiated/i),
    ).toBeTruthy()
    expect(screen.queryByLabelText(/new record title/i)).toBeNull()
  })

  it('calls onInstantiate with the title and project id on submit', async () => {
    const user = userEvent.setup()
    const onInstantiate = vi.fn()
    render(
      <TemplateInspector
        template={template({ id: 't-1', status: 'validated' })}
        blocks={blocks}
        blocksLoading={false}
        projects={projects}
        onInstantiate={onInstantiate}
        isInstantiating={false}
        instantiationError={null}
        instantiationSuccess={null}
      />,
    )
    await user.click(screen.getByRole('button', { name: /use template/i }))
    expect(onInstantiate).toHaveBeenCalledWith('Stability Study', 'p-1')
  })

  it('shows an instantiation error in an alert', () => {
    render(
      <TemplateInspector
        template={template({ id: 't-1', status: 'validated' })}
        blocks={blocks}
        blocksLoading={false}
        projects={projects}
        onInstantiate={vi.fn()}
        isInstantiating={false}
        instantiationError="You do not have permission to instantiate this template."
        instantiationSuccess={null}
      />,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/permission to instantiate/i)).toBeTruthy()
  })

  it('shows a loading indicator on the Preview tab while blocks are loading', async () => {
    const user = userEvent.setup()
    render(
      <TemplateInspector
        template={template({ id: 't-1' })}
        blocks={[]}
        blocksLoading
        projects={projects}
        onInstantiate={vi.fn()}
        isInstantiating={false}
        instantiationError={null}
        instantiationSuccess={null}
      />,
    )
    // Switch to the Preview tab to see the loading state.
    await user.click(screen.getByRole('tab', { name: /preview/i }))
    expect(screen.getByText(/loading blocks/i)).toBeTruthy()
  })

  it('shows an empty hint on the Preview tab when the template has no blocks', async () => {
    const user = userEvent.setup()
    render(
      <TemplateInspector
        template={template({ id: 't-1' })}
        blocks={[]}
        blocksLoading={false}
        projects={projects}
        onInstantiate={vi.fn()}
        isInstantiating={false}
        instantiationError={null}
        instantiationSuccess={null}
      />,
    )
    await user.click(screen.getByRole('tab', { name: /preview/i }))
    expect(screen.getByText(/no content blocks/i)).toBeTruthy()
  })

  it('renders block content on the Preview tab', async () => {
    const user = userEvent.setup()
    render(
      <TemplateInspector
        template={template({ id: 't-1' })}
        blocks={blocks}
        blocksLoading={false}
        projects={projects}
        onInstantiate={vi.fn()}
        isInstantiating={false}
        instantiationError={null}
        instantiationSuccess={null}
      />,
    )
    await user.click(screen.getByRole('tab', { name: /preview/i }))
    expect(screen.getByText('Objective')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// TPL-001: grid/list views, favourites, ownership, actions, version pinning,
// archived versions, thumbnails from actual content, and instantiation
// pinned to the selected version.
// ---------------------------------------------------------------------------

describe('TPL-001 TemplateFilters — view, favourites and ownership', () => {
  it('renders a grid/list view toggle', () => {
    render(
      <TemplateFilters
        statusFilter="all"
        onStatusChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        view="list"
        onViewChange={vi.fn()}
      />,
    )
    const group = screen.getByRole('group', { name: /template view/i })
    expect(group).toBeTruthy()
    expect(screen.getByRole('button', { name: /list view/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /grid view/i })).toBeTruthy()
  })

  it('calls onViewChange when the grid toggle is clicked', async () => {
    const user = userEvent.setup()
    const onViewChange = vi.fn()
    render(
      <TemplateFilters
        statusFilter="all"
        onStatusChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        view="list"
        onViewChange={onViewChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /grid view/i }))
    expect(onViewChange).toHaveBeenCalledWith('grid')
  })

  it('renders an ownership filter and a favourites toggle', () => {
    render(
      <TemplateFilters
        statusFilter="all"
        onStatusChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        ownership="all"
        onOwnershipChange={vi.fn()}
        favouritesOnly={false}
        onFavouritesOnlyChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/filter by ownership/i)).toBeTruthy()
    expect(screen.getByText(/favourites/i)).toBeTruthy()
  })

  it('forwards favourites toggle changes', async () => {
    const user = userEvent.setup()
    const onFavouritesOnlyChange = vi.fn()
    render(
      <TemplateFilters
        statusFilter="all"
        onStatusChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        favouritesOnly={false}
        onFavouritesOnlyChange={onFavouritesOnlyChange}
      />,
    )
    const checkbox = screen
      .getByText(/favourites/i)
      .closest('label')!
      .querySelector('input[type="checkbox"]')!
    await user.click(checkbox)
    expect(onFavouritesOnlyChange).toHaveBeenCalledWith(true)
  })

  it('forwards ownership changes', async () => {
    const user = userEvent.setup()
    const onOwnershipChange = vi.fn()
    render(
      <TemplateFilters
        statusFilter="all"
        onStatusChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        ownership="all"
        onOwnershipChange={onOwnershipChange}
      />,
    )
    await user.selectOptions(
      screen.getByLabelText(/filter by ownership/i),
      'mine',
    )
    expect(onOwnershipChange).toHaveBeenCalledWith('mine')
  })
})

describe('TPL-001 TemplateList — grid view, favourites and ownership', () => {
  it('renders a grid of cards in grid view', () => {
    render(
      <TemplateList
        templates={[
          template({ id: 't-1', title: 'Grid One' }),
          template({
            id: 't-2',
            identifier: 'NBK-2026-0002',
            title: 'Grid Two',
          }),
        ]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        view="grid"
        blockPreviews={{
          't-1': [blocks[0]],
        }}
      />,
    )
    expect(screen.getByText('Grid One')).toBeTruthy()
    expect(screen.getByText('Grid Two')).toBeTruthy()
    // Thumbnail rendered from actual block content (the heading "Objective").
    expect(screen.getAllByText('Objective').length).toBeGreaterThanOrEqual(1)
  })

  it('renders a "No content" thumbnail when a template has no preview blocks', () => {
    render(
      <TemplateList
        templates={[template({ id: 't-1', title: 'Empty Grid' })]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        view="grid"
        blockPreviews={{}}
      />,
    )
    expect(screen.getByText(/no content/i)).toBeTruthy()
  })

  it('renders a favourite toggle button for each template', () => {
    const onToggleFavourite = vi.fn()
    render(
      <TemplateList
        templates={[template({ id: 't-1' })]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onToggleFavourite={onToggleFavourite}
        favourites={new Set(['t-1'])}
      />,
    )
    const toggle = screen.getByRole('button', {
      name: /remove from favourites/i,
    })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('calls onToggleFavourite with the template id and does not select the row', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onToggleFavourite = vi.fn()
    render(
      <TemplateList
        templates={[template({ id: 't-1' })]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={onSelect}
        onRetry={vi.fn()}
        onToggleFavourite={onToggleFavourite}
      />,
    )
    await user.click(screen.getByRole('button', { name: /add to favourites/i }))
    expect(onToggleFavourite).toHaveBeenCalledWith('t-1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('labels the current user as "You" in the owner line', () => {
    render(
      <TemplateList
        templates={[template({ id: 't-1', createdByUserId: 'u-me' })]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        currentUserId="u-me"
      />,
    )
    expect(screen.getByText(/^You$/)).toBeTruthy()
  })

  it('labels another user with an anonymised handle', () => {
    render(
      <TemplateList
        templates={[template({ id: 't-1', createdByUserId: 'abcdef123456' })]}
        isLoading={false}
        error={null}
        selectedId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        currentUserId="u-me"
      />,
    )
    expect(screen.getByText(/User 123456/)).toBeTruthy()
  })
})

describe('TPL-001 TemplateActions — permissions and dependencies', () => {
  function actions(
    overrides: Partial<Parameters<typeof TemplateActions>[0]> = {},
  ) {
    return (
      <TemplateActions
        template={template({ id: 't-1', status: 'validated' })}
        usageCount={0}
        canManage
        isArchiving={false}
        isDuplicating={false}
        actionError={null}
        onArchive={vi.fn()}
        onDuplicate={vi.fn()}
        onExport={vi.fn()}
        {...overrides}
      />
    )
  }

  it('renders duplicate, export and archive actions', () => {
    render(actions())
    expect(screen.getByRole('button', { name: /duplicate/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /export/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /archive/i })).toBeTruthy()
  })

  it('disables archive when the user cannot manage the template', () => {
    render(actions({ canManage: false }))
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /archive/i })
        .disabled,
    ).toBe(true)
    expect(screen.getByText(/only the template author/i)).toBeTruthy()
  })

  it('disables archive for an already-archived template', () => {
    render(
      actions({
        template: template({
          id: 't-arch',
          status: 'validated',
          archivedAt: '2026-02-01T00:00:00Z',
        }),
      }),
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /archive/i })
        .disabled,
    ).toBe(true)
    expect(screen.getByText(/already archived/i)).toBeTruthy()
  })

  it('shows a dependency warning when the template is in use', () => {
    render(actions({ usageCount: 3 }))
    expect(screen.getByRole('note')).toBeTruthy()
    expect(screen.getByText(/used 3 times/i)).toBeTruthy()
  })

  it('does not show a dependency warning when usage is zero', () => {
    render(actions({ usageCount: 0 }))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('disables duplicate while a duplication is in progress', () => {
    render(actions({ isDuplicating: true }))
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /duplicating/i })
        .disabled,
    ).toBe(true)
  })

  it('shows an action error in an alert', () => {
    render(actions({ actionError: 'You do not have permission.' }))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/permission/i)).toBeTruthy()
  })

  it('invokes onArchive, onDuplicate and onExport on click', async () => {
    const user = userEvent.setup()
    const onArchive = vi.fn()
    const onDuplicate = vi.fn()
    const onExport = vi.fn()
    render(
      actions({
        onArchive,
        onDuplicate,
        onExport,
      }),
    )
    await user.click(screen.getByRole('button', { name: /archive/i }))
    expect(onArchive).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /duplicate/i }))
    expect(onDuplicate).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /export/i }))
    expect(onExport).toHaveBeenCalledTimes(1)
  })
})

describe('TPL-001 TemplateInspector — version, author, usage, links, pinning', () => {
  function inspector(
    overrides: Partial<Parameters<typeof TemplateInspector>[0]> = {},
  ) {
    return (
      <TemplateInspector
        template={template({ id: 't-1', status: 'validated' })}
        blocks={blocks}
        blocksLoading={false}
        projects={projects}
        onInstantiate={vi.fn()}
        isInstantiating={false}
        instantiationError={null}
        instantiationSuccess={null}
        usageCount={0}
        linkedRecords={[]}
        currentUserId="u-1"
        role="member"
        onArchive={vi.fn()}
        onDuplicate={vi.fn()}
        onExport={vi.fn()}
        isArchiving={false}
        isDuplicating={false}
        actionError={null}
        {...overrides}
      />
    )
  }

  it('shows the template version (metadata + structure) in the details tab', () => {
    render(
      inspector({
        template: template({
          id: 't-1',
          status: 'validated',
          metadataVersion: 4,
          structureVersion: 2,
        }),
      }),
    )
    expect(screen.getByText(/v4 \(structure v2\)/i)).toBeTruthy()
  })

  it('shows the author as "You" when the template was created by the current user', () => {
    render(
      inspector({
        template: template({ id: 't-1', createdByUserId: 'u-1' }),
        currentUserId: 'u-1',
      }),
    )
    expect(screen.getAllByText(/^You$/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows the usage count in the details tab', () => {
    render(inspector({ usageCount: 5 }))
    expect(screen.getByText(/5 records/i)).toBeTruthy()
  })

  it('lists linked records instantiated from the template', () => {
    render(
      inspector({
        linkedRecords: [
          {
            id: 'r-1',
            identifier: 'EXP-2026-0001',
            title: 'Run A',
            kind: 'experiment',
            status: 'draft',
            projectId: 'p-1',
          },
        ],
      }),
    )
    expect(screen.getByText('Run A')).toBeTruthy()
    expect(screen.getByText(/EXP-2026-0001/)).toBeTruthy()
  })

  it('shows an empty hint when no records have been instantiated', () => {
    render(inspector({ linkedRecords: [] }))
    expect(screen.getByText(/no records have been instantiated/i)).toBeTruthy()
  })

  it('shows a version-pinning note on the use-template form', () => {
    render(
      inspector({
        template: template({
          id: 't-1',
          status: 'validated',
          metadataVersion: 3,
        }),
      }),
    )
    expect(screen.getByText(/pinned to version v3/i)).toBeTruthy()
  })

  it('keeps the use-template form disabled for an archived version', () => {
    render(
      inspector({
        template: template({
          id: 't-1',
          status: 'validated',
          archivedAt: '2026-02-01T00:00:00Z',
        }),
      }),
    )
    expect(
      screen.getByText(/archived and cannot be instantiated/i),
    ).toBeTruthy()
    expect(screen.queryByLabelText(/new record title/i)).toBeNull()
  })

  it('renders the duplicate/export/archive actions inside the inspector', () => {
    render(inspector())
    expect(screen.getByRole('button', { name: /duplicate/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /export/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /archive/i })).toBeTruthy()
  })

  it('disables archive when the current user cannot manage the template', () => {
    render(
      inspector({
        template: template({ id: 't-1', createdByUserId: 'someone-else' }),
        currentUserId: 'u-1',
        role: 'member',
      }),
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /archive/i })
        .disabled,
    ).toBe(true)
  })

  it('enables archive for a workspace owner even when they are not the author', () => {
    render(
      inspector({
        template: template({ id: 't-1', createdByUserId: 'someone-else' }),
        currentUserId: 'u-1',
        role: 'owner',
      }),
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /archive/i })
        .disabled,
    ).toBe(false)
  })

  it('marks scientific review as approved for a validated template', () => {
    render(
      inspector({ template: template({ id: 't-1', status: 'validated' }) }),
    )
    expect(screen.getByText('Approved')).toBeTruthy()
  })
})
