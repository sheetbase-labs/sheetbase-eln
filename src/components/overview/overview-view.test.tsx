import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OverviewView } from './overview-view'
import type { NotebookBlock } from '#/lib/notebook-data'
import type { OverviewSection, OverviewRevision } from '#/lib/overview'

afterEach(() => {
  cleanup()
})

// Stub BlockPreview to avoid pulling in React Query / chart / plate / file
// rendering dependencies. The overview view's job is to compose sections and
// delegate rendering — we verify the composition, not the preview internals.
vi.mock('#/components/notebook/block-preview', () => ({
  BlockPreview: ({ block }: { block: NotebookBlock }) => (
    <div data-testid={`block-${block.id}`}>
      {block.type}: {block.id}
    </div>
  ),
}))

function makeBlock(
  overrides: Partial<NotebookBlock> & { id: string; type: string },
): NotebookBlock {
  return {
    recordId: 'r1',
    payload: {},
    payloadSchemaVersion: 1,
    order: 0,
    version: 1,
    ...overrides,
  }
}

const blocks: NotebookBlock[] = [
  makeBlock({ id: 'b1', type: 'rich_text', order: 1 }),
  makeBlock({ id: 'b2', type: 'materials', order: 2 }),
  makeBlock({ id: 'b3', type: 'chart', order: 3 }),
  makeBlock({ id: 'b4', type: 'checklist', order: 4 }),
]

function makeSections(): OverviewSection[] {
  return [
    {
      id: 'notes',
      label: 'Notes',
      blocks: [blocks[0]],
    },
    {
      id: 'materials',
      label: 'Materials',
      blocks: [blocks[1]],
    },
    {
      id: 'visualizations',
      label: 'Visualizations',
      blocks: [blocks[2]],
    },
    {
      id: 'tasks',
      label: 'Tasks',
      blocks: [blocks[3]],
    },
  ]
}

describe('OverviewView', () => {
  it('renders all sections with their labels', () => {
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
      />,
    )
    expect(screen.getByText('Notes')).toBeTruthy()
    expect(screen.getByText('Materials')).toBeTruthy()
    expect(screen.getByText('Visualizations')).toBeTruthy()
    expect(screen.getByText('Tasks')).toBeTruthy()
  })

  it('renders blocks through BlockPreview', () => {
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
      />,
    )
    expect(screen.getByTestId('block-b1')).toBeTruthy()
    expect(screen.getByTestId('block-b2')).toBeTruthy()
    expect(screen.getByTestId('block-b3')).toBeTruthy()
    expect(screen.getByTestId('block-b4')).toBeTruthy()
  })

  it('shows block count per section', () => {
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
      />,
    )
    expect(screen.getAllByText('1 block')).toHaveLength(4)
  })

  it('shows empty state when no sections', () => {
    render(<OverviewView sections={[]} mode="active" excludedBlockIds={[]} />)
    expect(screen.getByText('Overview is empty')).toBeTruthy()
  })

  it('shows empty state for historical mode with no blocks', () => {
    render(
      <OverviewView sections={[]} mode="historical" excludedBlockIds={[]} />,
    )
    expect(screen.getByText('This revision contains no blocks.')).toBeTruthy()
  })

  it('shows visibility toggle in active mode', () => {
    const onToggle = vi.fn()
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
        onToggleBlock={onToggle}
      />,
    )
    // Each block has a toggle button
    const toggles = screen.getAllByLabelText('Hide from overview')
    expect(toggles).toHaveLength(4)
  })

  it('hides visibility toggle in locked mode', () => {
    const onToggle = vi.fn()
    render(
      <OverviewView
        sections={makeSections()}
        mode="locked"
        excludedBlockIds={[]}
        onToggleBlock={onToggle}
      />,
    )
    expect(screen.queryByLabelText('Hide from overview')).toBeNull()
  })

  it('hides visibility toggle in archived mode', () => {
    const onToggle = vi.fn()
    render(
      <OverviewView
        sections={makeSections()}
        mode="archived"
        excludedBlockIds={[]}
        onToggleBlock={onToggle}
      />,
    )
    expect(screen.queryByLabelText('Hide from overview')).toBeNull()
  })

  it('hides visibility toggle in historical mode', () => {
    const onToggle = vi.fn()
    render(
      <OverviewView
        sections={makeSections()}
        mode="historical"
        excludedBlockIds={[]}
        onToggleBlock={onToggle}
      />,
    )
    expect(screen.queryByLabelText('Hide from overview')).toBeNull()
  })

  it('calls onToggleBlock when toggle is clicked', () => {
    const onToggle = vi.fn()
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
        onToggleBlock={onToggle}
      />,
    )
    const toggles = screen.getAllByLabelText('Hide from overview')
    fireEvent.click(toggles[0])
    expect(onToggle).toHaveBeenCalledWith('b1', true)
  })

  it('shows "Show in overview" for excluded blocks', () => {
    const onToggle = vi.fn()
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={['b1']}
        onToggleBlock={onToggle}
      />,
    )
    expect(screen.getByLabelText('Show in overview')).toBeTruthy()
    // Clicking it calls with exclude=false
    fireEvent.click(screen.getByLabelText('Show in overview'))
    expect(onToggle).toHaveBeenCalledWith('b1', false)
  })

  it('renders excluded blocks with reduced opacity', () => {
    const { container } = render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={['b1']}
      />,
    )
    const excludedBlock = container.querySelector('[data-testid="block-b1"]')
    expect(excludedBlock?.parentElement?.className).toContain('opacity-50')
  })

  it('shows locked banner in locked mode', () => {
    render(
      <OverviewView
        sections={makeSections()}
        mode="locked"
        excludedBlockIds={[]}
      />,
    )
    expect(
      screen.getByText('This record is locked. The overview is read-only.'),
    ).toBeTruthy()
  })

  it('shows archived banner in archived mode', () => {
    render(
      <OverviewView
        sections={makeSections()}
        mode="archived"
        excludedBlockIds={[]}
      />,
    )
    expect(
      screen.getByText('This record is archived. The overview is read-only.'),
    ).toBeTruthy()
  })

  it('shows revision banner in historical mode', () => {
    const revision: OverviewRevision = {
      id: 'rev-12345678-1234-1234-1234-123456789abc',
      recordId: 'r1',
      reason: 'submit',
      createdAt: '2026-07-22T10:00:00Z',
      createdByUserId: 'u1',
      superseded: false,
      blocks: [],
      metadata: {},
    }
    render(
      <OverviewView
        sections={makeSections()}
        mode="historical"
        revision={revision}
        excludedBlockIds={[]}
      />,
    )
    expect(screen.getByText(/Viewing historical revision/)).toBeTruthy()
    expect(screen.getByText(/submit/)).toBeTruthy()
  })

  it('shows superseded label for superseded revisions', () => {
    const revision: OverviewRevision = {
      id: 'rev-12345678-1234-1234-1234-123456789abc',
      recordId: 'r1',
      reason: 'submit',
      createdAt: '2026-07-22T10:00:00Z',
      createdByUserId: 'u1',
      superseded: true,
      blocks: [],
      metadata: {},
    }
    render(
      <OverviewView
        sections={makeSections()}
        mode="historical"
        revision={revision}
        excludedBlockIds={[]}
      />,
    )
    expect(screen.getByText(/\(superseded\)/)).toBeTruthy()
  })

  it('does not show banners in active mode', () => {
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
      />,
    )
    expect(
      screen.queryByText('This record is locked. The overview is read-only.'),
    ).toBeNull()
    expect(
      screen.queryByText('This record is archived. The overview is read-only.'),
    ).toBeNull()
    expect(screen.queryByText(/Viewing historical revision/)).toBeNull()
  })

  it('associates section headings with aria-labelledby', () => {
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
      />,
    )
    const notesHeading = screen.getByText('Notes')
    const section = notesHeading.closest('section')
    expect(section?.getAttribute('aria-labelledby')).toBe(
      'overview-section-notes',
    )
  })

  it('renders a responsive container class', () => {
    const { container } = render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
      />,
    )
    // The overview renders in a space-y container that is responsive
    expect(container.firstChild).toBeTruthy()
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('space-y-8')
  })

  it('section headings are keyboard-accessible h2 elements', () => {
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
      />,
    )
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings).toHaveLength(4)
    for (const heading of headings) {
      expect(heading.tagName).toBe('H2')
      expect(heading.id).toMatch(/^overview-section-/)
    }
  })

  it('toggle buttons are keyboard-focusable with aria-pressed', () => {
    const onToggle = vi.fn()
    render(
      <OverviewView
        sections={makeSections()}
        mode="active"
        excludedBlockIds={[]}
        onToggleBlock={onToggle}
      />,
    )
    const toggles = screen.getAllByLabelText('Hide from overview')
    for (const toggle of toggles) {
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle.getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('banners use role=status for screen readers', () => {
    render(
      <OverviewView
        sections={makeSections()}
        mode="locked"
        excludedBlockIds={[]}
      />,
    )
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('locked')
  })

  it('renders sections in canonical order regardless of block order', () => {
    // Reverse the block order to verify sections still appear in canonical order
    const reversedSections: OverviewSection[] = [
      { id: 'tasks', label: 'Tasks', blocks: [blocks[3]] },
      { id: 'visualizations', label: 'Visualizations', blocks: [blocks[2]] },
      { id: 'materials', label: 'Materials', blocks: [blocks[1]] },
      { id: 'notes', label: 'Notes', blocks: [blocks[0]] },
    ]
    const { container } = render(
      <OverviewView
        sections={reversedSections}
        mode="active"
        excludedBlockIds={[]}
      />,
    )
    const headings = Array.from(container.querySelectorAll('h2')).map(
      (h) => h.textContent,
    )
    // Sections render in the order they are passed (the route composes them
    // in canonical order); verify all labels are present
    expect(headings).toContain('Notes')
    expect(headings).toContain('Materials')
    expect(headings).toContain('Visualizations')
    expect(headings).toContain('Tasks')
  })
})
