/**
 * The shared record page: the header says the ID, status and at most four
 * facts once; a tab with nothing in it shows no count; History sits at the
 * far end; empty fields fold away; Follow goes to the pane header when the
 * page sits in a pane; recent activity groups by day.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { followQueryKey } from '#/lib/follows'
import type { TimelineEventWire } from '#/lib/sign-002'
import { RecordPage } from './record-page'
import type { RecordPageProps } from './record-page'
import {
  RecordProperties,
  activityDayLabel,
  recentActivityGroups,
} from './record-side-panel'
import { RecordStateLine } from './record-state-line'

// oxlint-disable-next-line anti-slop/no-module-mocking -- Toasts are painted by the app shell's Toaster, which a jsdom render mounts nothing of.
vi.mock('#/components/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

const RECORD = 'rec-1'

function client() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  queryClient.setQueryData(followQueryKey('record', RECORD), false)

  return queryClient
}

function page(props: Partial<RecordPageProps> = {}) {
  return (
    <QueryClientProvider client={client()}>
      <RecordPage
        recordId={RECORD}
        trail={[]}
        title="Filter train C"
        identifier="MAT-0420"
        status={{ tone: 'ok', label: 'Released' }}
        facts={[
          { label: 'Lot', value: 'L-77310', mono: true },
          { label: 'Stock', value: '2 of 6 units' },
          { label: 'Location', value: 'Bay 4' },
          { label: 'Supplier', value: 'Supplier B' },
          { label: 'Owner', value: 'Tom H.' },
        ]}
        tabs={{
          mode: 'state',
          label: 'Sections',
          value: 'details',
          onValueChange: () => undefined,
          items: [
            { key: 'details', label: 'Details' },
            { key: 'ledger', label: 'Ledger', count: 3 },
            { key: 'used', label: 'Used in', count: 0 },
            { key: 'history', label: 'History', end: true },
          ],
        }}
        {...props}
      >
        <p>Body</p>
      </RecordPage>
    </QueryClientProvider>
  )
}

describe('RecordPage', () => {
  it('says the ID and status once, with at most four facts', () => {
    render(page())

    // SAFETY: the page passes a meta, so the header renders its meta row.
    const meta = document.querySelector('[data-page-meta]') as HTMLElement

    expect(within(meta).getByText('MAT-0420')).toBeTruthy()
    expect(within(meta).getAllByText('Released')).toHaveLength(1)
    expect(meta.querySelectorAll('[data-record-fact]')).toHaveLength(4)
    expect(within(meta).queryByText('Tom H.')).toBeNull()
  })

  it('lets the title wrap instead of cutting it short', () => {
    render(page())

    const title = screen.getByRole('heading', { level: 1 })

    expect(title.className).toContain('line-clamp-2')
    expect(title.className).not.toContain('md:truncate')
  })

  it('hides a zero count and sets History at the far end', () => {
    render(page())

    expect(screen.getByRole('tab', { name: 'Used in' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Ledger 3' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'History' }).className).toContain(
      'md:ml-auto',
    )
  })

  it('shows one state line between the meta and the tabs', () => {
    render(
      page({
        stateLine: (
          <RecordStateLine tone="warn">Expires in 3 days</RecordStateLine>
        ),
      }),
    )

    // SAFETY: the page passes a state line, so the header renders its notice row.
    const notice = document.querySelector('[data-page-notice]') as HTMLElement

    expect(within(notice).getByRole('status').textContent).toContain(
      'Expires in 3 days',
    )
  })

  it('lends Follow to the pane header when it sits in a pane', async () => {
    const pane = document.createElement('div')
    const slot = document.createElement('span')

    pane.setAttribute('data-workspace-pane', 'p1')
    slot.setAttribute('data-pane-page-actions', '')
    pane.append(slot)
    document.body.append(pane)

    render(page(), {
      container: pane.appendChild(document.createElement('div')),
    })

    const bell = await within(slot).findByRole('button', { name: 'Follow' })

    expect(bell.getAttribute('aria-pressed')).toBe('false')
    pane.remove()
  })

  it('keeps Follow in the ⋯ menu for a phone', async () => {
    render(page({ more: null }))

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Follow' })).toBeTruthy()
  })
})

describe('RecordProperties', () => {
  it('folds empty fields under one line', () => {
    render(
      <RecordProperties
        items={[
          { label: 'Catalogue', value: 'DF-01' },
          { label: 'Opened', value: null },
          { label: 'Owner', value: '' },
        ]}
        tags={['Harvest']}
      />,
    )

    expect(screen.getByText('Catalogue')).toBeTruthy()
    expect(screen.getByText('2 empty fields')).toBeTruthy()
    expect(screen.getByText('Harvest')).toBeTruthy()
  })
})

describe('recent activity', () => {
  const event = (id: string, ts: string): TimelineEventWire => ({
    type: 'comment',
    id,
    seq: null,
    ts,
    title: 'comment',
    actorUserId: null,
  })

  it('names today and yesterday, then the date', () => {
    const now = new Date('2026-11-28T12:00:00')

    expect(activityDayLabel('2026-11-28T08:00:00', now)).toBe('Today')
    expect(activityDayLabel('2026-11-27T08:00:00', now)).toBe('Yesterday')
    expect(activityDayLabel('2026-11-20T08:00:00', now)).not.toBe('Yesterday')
  })

  it('keeps the newest few, grouped by day', () => {
    const { groups, total } = recentActivityGroups(
      [
        event('1', '2026-11-20T08:00:00Z'),
        event('2', '2026-11-27T09:00:00Z'),
        event('3', '2026-11-27T10:00:00Z'),
        event('4', '2026-11-26T10:00:00Z'),
      ],
      () => undefined,
      3,
    )

    expect(total).toBe(4)
    expect(groups.map((group) => group.items.length)).toEqual([2, 1])
    expect(groups[0]?.day).toBe('2026-11-27')
  })
})
