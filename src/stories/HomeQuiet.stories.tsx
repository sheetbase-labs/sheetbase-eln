import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { HomeQuiet } from '#/components/home/home-quiet'
import { PageHeader } from '#/components/ui/layout'
import type { ComingUpGroup, PickUpItem } from '#/lib/home-quiet'
import type { RecentItem } from '#/lib/recents'
import { screenRoutes } from './screen-stories'

/**
 * Quiet Home (`src/components/home/home-quiet.tsx`).
 *
 * Home when nothing, or only one thing, is waiting on the person: the all-clear
 * (or the one waiting item), what is coming up, work to pick up, how projects
 * stand, and the Today / Start something / Team activity inspector. A section
 * with nothing to show is omitted rather than rendered empty. The page is a pure
 * function of its props, so each story is the real inputs, with no read behind it.
 */
const meta = {
  title: 'Home/Quiet home',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/', [
          '/inbox',
          '/schedule',
          '/projects',
          '/experiments',
          '/experiments/new',
          '/import',
          '/sheets/new',
          '/scan',
          '/experiments/$expId',
          '/projects/$projectId',
        ]),
        path: '/',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="flex h-[720px] w-[1180px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const header = <PageHeader title="Home" />

const comingUp: ComingUpGroup[] = [
  {
    day: '2026-10-15',
    label: 'Tomorrow',
    entries: [
      {
        key: 'b-1',
        kind: 'booking',
        at: '2026-10-15T09:00:00.000Z',
        time: '09:00',
        text: 'Plate reader PR-1: stability run',
        why: 'You booked it',
        to: '/schedule',
      },
      {
        key: 'e-1',
        kind: 'expiry',
        at: '2026-10-15T12:00:00.000Z',
        time: null,
        text: 'Lot L-2210 of PBS expires',
        why: 'You own the material',
        to: '/schedule',
      },
    ],
  },
]

const pickUp: PickUpItem[] = [
  {
    key: 'p-1',
    identifier: 'EXP-0044',
    title: 'AAV9 titre repeat',
    why: 'Draft you started on Monday',
    action: 'Continue',
    to: '/experiments',
  },
]

const recent: RecentItem = {
  kind: 'record',
  id: 'rec-1',
  label: 'AAV9 titre repeat',
  identifier: 'EXP-0044',
  destination: '/experiments',
  signal: 'edited',
  lastActivityAt: '2026-10-13T16:00:00.000Z',
  viewedAt: null,
  editedAt: '2026-10-13T16:00:00.000Z',
  status: 'in_progress',
}

const base = {
  header,
  comingUp,
  pickUp,
  continueWorking: [recent],
  projects: [
    {
      id: 'pr-1',
      title: 'AAV9 stability',
      stage: 'Development',
      total: 12,
      approved: 7,
      inReview: 2,
    },
  ],
  todayBookings: [],
  freeInstruments: [
    {
      id: 'inst-1',
      displayId: 'INST-2026-0003',
      name: 'Turbidimeter TB-02',
      label: 'Free all day',
    },
  ],
  activity: [],
  userId: 'u-1',
  timeZone: 'Europe/London',
}

/** Nothing waiting: the all-clear, then what is coming up. */
export const AllClear: Story = {
  render: () => <HomeQuiet {...base} pace="quiet" waiting={null} />,
}

/** Exactly one thing waiting is named, with why it is there. */
export const OneThingWaiting: Story = {
  render: () => (
    <HomeQuiet
      {...base}
      pace="near-quiet"
      waiting={{
        text: 'A dataset has import errors',
        why: 'You uploaded it',
        action: 'Review',
        to: '/inbox',
      }}
    />
  ),
}

/** A new workspace: every section is omitted rather than shown empty. */
export const NothingYet: Story = {
  render: () => (
    <HomeQuiet
      {...base}
      pace="quiet"
      waiting={null}
      comingUp={[]}
      pickUp={[]}
      continueWorking={[]}
      projects={[]}
      freeInstruments={[]}
    />
  ),
}
