import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { recordModelDetailQueryKeys } from '#/components/models/models-data'
import { RecordPage } from '#/components/record-page/record-page'
import {
  RecordActivity,
  RecordProperties,
} from '#/components/record-page/record-side-panel'
import { RecordStateLine } from '#/components/record-page/record-state-line'
import { PaneHeaderSlot } from '#/components/record-page/pane-header-slot'
import { Button } from '#/components/ui/button'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'
import { followQueryKey } from '#/lib/follows'
import { relatedWorkQueryKeys } from '#/lib/related-work'
import type { TimelineEventWire } from '#/lib/sign-002'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The record page every kind uses (`src/components/record-page`): the header
 * names the record and says its ID and status once with up to four facts, one
 * main action with the rest under ⋯, one state line, tabs that end on History,
 * and a side panel of properties, links and recent activity. Outside a pane the
 * Follow bell has no pane header to go to, so it sits in the ⋯ menu on a phone.
 */
const RECORD = '0198d970-e266-4000-8000-00000000b001'

const now = Date.now()

const hoursAgo = (hours: number) =>
  new Date(now - hours * 3_600_000).toISOString()

const timeline: TimelineEventWire[] = [
  {
    type: 'change_event',
    id: '3',
    seq: 3,
    ts: hoursAgo(2),
    title: 'record update',
    actorUserId: null,
    operation: 'update',
  },
  {
    type: 'comment',
    id: '2',
    seq: null,
    ts: hoursAgo(30),
    title: 'comment',
    actorUserId: null,
  },
  {
    type: 'change_event',
    id: '1',
    seq: 1,
    ts: hoursAgo(24 * 9),
    title: 'record create',
    actorUserId: null,
    operation: 'create',
  },
]

function client() {
  return screenQueryClient({
    data: [
      { key: followQueryKey('record', RECORD), value: false },
      { key: recordModelDetailQueryKeys.timeline(RECORD), value: timeline },
      { key: relatedWorkQueryKeys.related('record', RECORD), value: [] },
    ],
  })
}

function Lot({ state = true }: { state?: boolean }) {
  return (
    <QueryClientProvider client={client()}>
      <div className="flex h-[720px] w-[1280px] border border-border bg-surface">
        <RecordPage
          recordId={RECORD}
          trail={[
            { label: 'Materials', link: { to: '/materials' } },
            { label: 'MAT-0420', mono: true },
          ]}
          title="Filter train C, single-stage depth filtration for harvest clarification"
          identifier="MAT-0420"
          status={{ tone: 'ok', label: 'Released' }}
          facts={[
            { label: 'Lot', value: 'L-77310', mono: true },
            { label: 'Stock', value: '2 of 6 units' },
            { label: 'Location', value: 'Consumables store, bay 4' },
            { label: 'Supplier', value: 'Supplier B' },
          ]}
          actions={<Button variant="primary">Use</Button>}
          more={
            <>
              <DropdownMenuItem>Register replacement lot</DropdownMenuItem>
              <DropdownMenuItem danger>Quarantine…</DropdownMenuItem>
            </>
          }
          stateLine={
            state ? (
              <RecordStateLine
                tone="warn"
                action={<Button size="sm">Register replacement</Button>}
              >
                Expires 1 Dec 2026 (3 days). No replacement lot is registered
                yet.
              </RecordStateLine>
            ) : null
          }
          tabs={{
            mode: 'state',
            label: 'Lot sections',
            value: 'details',
            onValueChange: () => undefined,
            items: [
              { key: 'details', label: 'Details' },
              { key: 'ledger', label: 'Ledger', count: 3 },
              { key: 'used', label: 'Used in', count: 0 },
              { key: 'history', label: 'History', end: true },
            ],
          }}
          side={
            <>
              <RecordProperties
                items={[
                  { label: 'Catalogue', value: 'DF-C0SP-01', mono: true },
                  { label: 'Received', value: '4 Aug 2026' },
                  { label: 'Opened', value: null },
                  { label: 'Owner', value: null },
                ]}
                tags={['Harvest', 'Single use']}
                onAddTag={() => undefined}
              />
              <RecordActivity
                recordId={RECORD}
                onShowHistory={() => undefined}
              />
            </>
          }
        >
          <p className="text-body text-fg-muted">The lot’s details tab.</p>
        </RecordPage>
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Records/Record page',
  component: Lot,
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: { route: screenRoutes('/', ['/materials']), path: '/' },
    },
  },
} satisfies Meta<typeof Lot>

export default meta

type Story = StoryObj<typeof meta>

export const WithStateLine: Story = {}

export const InGoodStanding: Story = { args: { state: false } }

/** The slot lends its children to the pane header, or shows the fallback. */
export const SlotOutsideAPane: Story = {
  render: () => (
    <PaneHeaderSlot
      fallback={<span className="text-label">Shown in place</span>}
    >
      <span>In the pane header</span>
    </PaneHeaderSlot>
  ),
}
