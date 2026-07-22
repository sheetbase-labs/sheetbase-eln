/**
 * SCI-006 Template Library component tests: list loading/empty/error/active/
 * archived states, filters, inspector rendering, use-template action flow,
 * and keyboard accessibility.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
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
    expect(screen.getByText(/no templates found/i)).toBeTruthy()
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
    expect(screen.getAllByText('Notebook').length).toBeGreaterThanOrEqual(1)
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
    const button = screen.getByText('Stability Study').closest('button')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
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
  it('renders accessible search, type and status controls', () => {
    render(
      <TemplateFilters
        kindFilter="all"
        onKindChange={vi.fn()}
        statusFilter="all"
        onStatusChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/search templates/i)).toBeTruthy()
    expect(screen.getByLabelText(/filter by type/i)).toBeTruthy()
    expect(screen.getByLabelText(/filter by status/i)).toBeTruthy()
  })

  it('forwards search changes to onSearchChange', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    render(
      <TemplateFilters
        kindFilter="all"
        onKindChange={vi.fn()}
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
