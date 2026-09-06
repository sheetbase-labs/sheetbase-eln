/**
 * KNOW-01 — RelationshipPanel component tests.
 *
 * Section rendering, honest row states and stable-ID destinations, with the
 * live query hook mocked at the module boundary.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as Relationships from '#/lib/relationships'
import { useRelationships } from '#/lib/relationships'
import type { RelationshipRow } from '#/lib/relationships'
import {
  PinnedRelationshipPanel,
  RelationshipList,
  RelationshipPanel,
} from './relationship-panel'

// Stub the router Link as a plain anchor so no route tree is required.
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

vi.mock('#/lib/relationships', async (importOriginal) => {
  const actual = await importOriginal<typeof Relationships>()
  return { ...actual, useRelationships: vi.fn() }
})

const mockedHook = vi.mocked(useRelationships)

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const outgoing: RelationshipRow[] = [
  {
    linkId: 'out-1',
    direction: 'outgoing',
    linkType: 'sample',
    label: 'uses',
    otherRecordId: 'rec-2',
    state: 'available',
    title: 'Cell line',
    identifier: 'SMP-2',
    destination: '/samples?selected=rec-2',
    createdAt: '2026-08-03T00:00:00Z',
    createdByUserId: 'user-1',
    duplicateCount: 1,
  },
  {
    linkId: 'out-arch',
    direction: 'outgoing',
    linkType: 'general',
    label: 'related to',
    otherRecordId: 'rec-3',
    state: 'archived',
    title: 'Old run',
    identifier: 'EXP-3',
    destination: null,
    createdAt: '2026-08-03T00:00:00Z',
    createdByUserId: null,
    duplicateCount: 1,
  },
]

const incoming: RelationshipRow[] = [
  {
    linkId: 'in-1',
    direction: 'incoming',
    linkType: 'general',
    label: 'related to',
    otherRecordId: 'rec-hidden',
    state: 'permission-restricted',
    title: 'Restricted record',
    identifier: null,
    destination: null,
    createdAt: '2026-08-03T00:00:00Z',
    createdByUserId: null,
    duplicateCount: 1,
  },
]

describe('RelationshipList', () => {
  it('renders outgoing and incoming sections with counts', () => {
    render(<RelationshipList outgoing={outgoing} incoming={incoming} />)
    expect(screen.getByText('Outgoing (2)')).toBeTruthy()
    expect(screen.getByText('Incoming (1)')).toBeTruthy()
  })

  it('links available rows to their stable-ID destinations', () => {
    render(<RelationshipList outgoing={outgoing} incoming={[]} />)
    const link = screen.getByRole('link', { name: /Cell line/ })
    expect(link.getAttribute('href')).toBe('/samples?selected=rec-2')
    expect(screen.getByText('SMP-2')).toBeTruthy()
    expect(screen.getByText('uses')).toBeTruthy()
  })

  it('renders restricted rows honestly with no link and no identifier', () => {
    render(<RelationshipList outgoing={[]} incoming={incoming} />)
    expect(screen.getByText('Restricted record')).toBeTruthy()
    expect(screen.getByText('Permission restricted')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders archived rows distinctly without navigation', () => {
    render(<RelationshipList outgoing={[outgoing[1]]} incoming={[]} />)
    expect(screen.getByText('Old run')).toBeTruthy()
    expect(screen.getByText('Archived')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('RelationshipPanel', () => {
  it('shows a loading hint while fetching', () => {
    mockedHook.mockReturnValue({ outgoing: [], incoming: [], isLoading: true })
    render(<RelationshipPanel recordId="rec-1" />)
    expect(screen.getByText(/Loading relationships/)).toBeTruthy()
  })

  it('stays silent when there are no relationships', () => {
    mockedHook.mockReturnValue({
      outgoing: [],
      incoming: [],
      isLoading: false,
    })
    const { container } = render(<RelationshipPanel recordId="rec-1" />)
    expect(container.textContent).toBe('')
  })

  it('renders both sections once rows resolve', () => {
    mockedHook.mockReturnValue({ outgoing, incoming, isLoading: false })
    render(<RelationshipPanel recordId="rec-1" />)
    expect(screen.getByText('Relationships')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /Cell line/ }).getAttribute('href'),
    ).toBe('/samples?selected=rec-2')
    expect(screen.getByText('Restricted record')).toBeTruthy()
  })
})

describe('PinnedRelationshipPanel', () => {
  it('renders the pinned snapshot without links or actions', () => {
    render(
      <PinnedRelationshipPanel
        links={[
          {
            id: 'pin-1',
            sourceRecordId: 'rec-1',
            targetRecordId: 'rec-2',
            targetKind: 'sample',
            targetIdentifier: 'SMP-2',
            linkType: 'sample',
            createdAt: '2026-08-03T00:00:00Z',
            createdByUserId: null,
          },
        ]}
      />,
    )
    expect(screen.getByText('Relationships')).toBeTruthy()
    expect(screen.getByText('SMP-2')).toBeTruthy()
    expect(screen.getByText('uses')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders nothing when the snapshot has no links', () => {
    const { container } = render(<PinnedRelationshipPanel links={[]} />)
    expect(container.textContent).toBe('')
  })
})

describe('RelationshipList windowing and metadata', () => {
  function manyRows(n: number): RelationshipRow[] {
    return Array.from({ length: n }, (_, i) => ({
      linkId: `row-${i}`,
      direction: 'outgoing' as const,
      linkType: 'general',
      label: 'related to',
      otherRecordId: `rec-${i}`,
      state: 'available' as const,
      title: `Record ${i}`,
      identifier: `EXP-${i}`,
      destination: `/records/rec-${i}`,
      createdAt: '2026-08-03T00:00:00Z',
      createdByUserId: null,
      duplicateCount: 1,
    }))
  }

  it('windows heavy directions but keeps exact counts', () => {
    render(<RelationshipList outgoing={manyRows(30)} incoming={[]} />)
    expect(screen.getByText('Outgoing (30)')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Show all 30' }),
    ).toBeTruthy()
    expect(screen.getByText('Record 0')).toBeTruthy()
    expect(screen.getByText('Record 24')).toBeTruthy()
    expect(screen.queryByText('Record 25')).toBeNull()
  })

  it('expands to the full list on Show all', () => {
    render(<RelationshipList outgoing={manyRows(30)} incoming={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 30' }))
    expect(screen.getByText('Record 29')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('shows a count badge for collapsed duplicate edges', () => {
    render(
      <RelationshipList
        outgoing={[{ ...outgoing[0], linkId: 'dup', duplicateCount: 3 }]}
        incoming={[]}
      />,
    )
    const badge = screen.getByText('×3')
    expect(badge.getAttribute('aria-label')).toBe('3 identical links')
  })

  it('exposes link creation metadata as hover detail', () => {
    const { container } = render(
      <RelationshipList outgoing={[outgoing[0]]} incoming={[]} />,
    )
    const item = container.querySelector('li[title]')
    expect(item?.getAttribute('title')).toContain('2026-08-03T00:00:00Z')
    expect(item?.getAttribute('title')).toContain('user-1')
  })
})
