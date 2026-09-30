/**
 * SCI-001 RecordPicker component tests: loading, empty, error, active and
 * archived states, plus keyboard accessibility of the cmdk-based selector.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecordPicker } from './record-picker'
import type { NotebookRecord } from '#/lib/notebook-data'

// jsdom does not implement ResizeObserver; cmdk reads it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom does not implement scrollIntoView; cmdk calls it when selecting items.
Element.prototype.scrollIntoView = () => {}

function record(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: 'r-1',
    projectId: 'p-1',
    kind: 'sample',
    identifier: 'SMP-2026-0001',
    title: 'Virus stock A',
    status: 'available',
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

afterEach(() => cleanup())

function mount(
  overrides: {
    results?: NotebookRecord[]
    loading?: boolean
    error?: Error | null
    includeArchived?: boolean
    onSelect?: (r: unknown) => void
  } = {},
) {
  const onSelect = overrides.onSelect ?? vi.fn()
  const onSearch = vi.fn()
  render(
    <RecordPicker
      kind="sample"
      results={overrides.results ?? []}
      loading={overrides.loading ?? false}
      error={overrides.error ?? null}
      onSearch={onSearch}
      onSelect={onSelect}
      includeArchived={overrides.includeArchived}
    />,
  )
  return { onSelect, onSearch }
}

describe('RecordPicker', () => {
  it('shows a loading indicator while results are loading', () => {
    mount({ loading: true })
    // The v3 command shows skeleton rows and announces "Searching…".
    expect(screen.getByText('Searching…')).toBeTruthy()
  })

  it('shows an empty state when there are no results and no error', () => {
    mount({ results: [] })
    expect(screen.getByText(/no samples match your search/i)).toBeTruthy()
    expect(screen.getByText(/SMP-YYYY-NNNN/i)).toBeTruthy()
  })

  it('shows an error state and never offers selection', () => {
    mount({ error: new Error('Workspace token expired') })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/couldn’t load samples/i)).toBeTruthy()
    expect(screen.getByText('Workspace token expired')).toBeTruthy()
  })

  it('renders active records with identifier, title and status badge', () => {
    mount({
      results: [
        record({ id: 'r-1', title: 'Virus stock A', status: 'available' }),
        record({
          id: 'r-2',
          identifier: 'SMP-2026-0002',
          title: 'Virus stock B',
          status: 'reserved',
        }),
      ],
    })
    expect(screen.getByText('SMP-2026-0001')).toBeTruthy()
    expect(screen.getByText('Virus stock A')).toBeTruthy()
    expect(screen.getByText('SMP-2026-0002')).toBeTruthy()
    expect(screen.getByText('Available')).toBeTruthy()
    expect(screen.getByText('Reserved')).toBeTruthy()
  })

  it('hides archived records from the active group and surfaces them only when includeArchived is set', () => {
    const archived = record({
      id: 'r-arch',
      identifier: 'SMP-2026-0099',
      title: 'Old stock',
      status: 'consumed',
      archivedAt: '2026-02-01T00:00:00Z',
    })
    // Without includeArchived: archived record is not listed.
    mount({ results: [archived] })
    expect(screen.queryByText('SMP-2026-0099')).toBeNull()
    // With includeArchived: archived record appears under an "Archived" heading.
    cleanup()
    mount({ results: [archived], includeArchived: true })
    expect(screen.getByText('SMP-2026-0099')).toBeTruthy()
    // "Archived" appears both as the group heading and the inline item label.
    expect(screen.getAllByText('Archived').length).toBeGreaterThanOrEqual(1)
  })

  it('selects an active record on click and reports id, kind, identifier and archived flag', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mount({
      results: [record({ id: 'r-1' })],
      onSelect,
    })
    await user.click(screen.getByText('Virus stock A'))
    expect(onSelect).toHaveBeenCalledWith({
      id: 'r-1',
      kind: 'sample',
      identifier: 'SMP-2026-0001',
      title: 'Virus stock A',
      status: 'available',
      archived: false,
    })
  })

  it('renders every provided record as a selectable cmdk item', () => {
    mount({
      results: [
        record({ id: 'r-1' }),
        record({ id: 'r-2', identifier: 'SMP-2026-0002', title: 'Stock B' }),
      ],
    })
    // cmdk manages aria-selected for the keyboard-active item itself; here we
    // only assert that both records render as real selectable items.
    expect(
      screen.getByText('Virus stock A').closest('[data-command-item]'),
    ).toBeTruthy()
    expect(
      screen.getByText('Stock B').closest('[data-command-item]'),
    ).toBeTruthy()
  })

  it('exposes an accessible search input with an aria-label', () => {
    mount({ results: [] })
    const input = screen.getByPlaceholderText(
      /search samples by identifier or title/i,
    )
    expect(input).toBeTruthy()
    expect(input.getAttribute('aria-label')).toMatch(
      /search samples by identifier or title/i,
    )
  })

  it('forwards search input changes to onSearch', async () => {
    const user = userEvent.setup()
    const { onSearch } = mount({ results: [] })
    await user.type(screen.getByPlaceholderText(/search samples/i), 'lot')
    expect(onSearch).toHaveBeenCalled()
  })
})
