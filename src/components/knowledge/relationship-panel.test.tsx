/**
 * KNOW-01 — RelationshipPanel component tests.
 *
 * Section rendering, honest row states and stable-ID destinations, with the
 * live query hook mocked at the module boundary.
 */
import { cleanup, render, screen } from '@testing-library/react'
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
