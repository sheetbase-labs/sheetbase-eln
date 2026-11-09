import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { screen, userEvent, within } from 'storybook/test'

import { RepeatExperimentDialog } from '#/components/recurring/repeat-experiment-dialog'
import { RepeatingDialog } from '#/components/recurring/repeating-dialog'
import { recurringQueryKeys } from '#/components/recurring/recurring-data'
import type { RepeatRow } from '#/components/recurring/recurring-data'
import { BookDialog } from '#/components/schedule/book-dialog'
import type { ScheduleInstrument } from '#/components/schedule/schedule-data'
import { toRepeatSchedule } from '#/lib/recurring'
import type { RepeatScheduleWire } from '#/lib/recurring'
import {
  StubDataClient,
  screenQueryClient,
  screenRoutes,
} from './screen-stories'

/**
 * Work that repeats (`src/components/recurring/`): booking an instrument
 * every week, the Repeating list with what each repeat made and could not
 * make, and starting experiments from a template on a schedule or at time
 * points. Reads are seeded into the query cache, so no request leaves the page.
 */
const WS = '0198d970-e266-4000-8000-000000000009'

const INSTRUMENTS: ScheduleInstrument[] = [
  {
    id: '0198d970-e266-4000-8000-0000000a0001',
    displayId: 'INS-0007',
    name: 'Plate reader PR-01',
  },
  {
    id: '0198d970-e266-4000-8000-0000000a0002',
    displayId: 'INS-0009',
    name: 'Thermocycler PCR-02',
  },
]

const ZONE = { list: async () => [{ timezone: 'Europe/London' }] }

const wire = (over: Partial<RepeatScheduleWire>): RepeatScheduleWire => ({
  id: 'sched-1',
  kind: 'booking',
  title: 'Plate reader QC',
  status: 'active',
  frequency: 'weekly',
  interval_count: 1,
  weekdays: [1, 3],
  offsets_days: null,
  starts_on: '2026-11-09',
  ends_on: null,
  max_occurrences: 12,
  timezone: 'Europe/London',
  resource_id: INSTRUMENTS[0].id,
  start_time: '09:00:00',
  end_time: '10:30:00',
  notebook_template_id: null,
  lead_days: 0,
  project_id: null,
  created_by_user_id: 'user-1',
  created_at: '2026-11-04T08:00:00Z',
  ...over,
})

const BOOKING_ROWS: RepeatRow[] = [
  {
    schedule: toRepeatSchedule(wire({})),
    made: 10,
    next: '2026-11-09',
    notMade: [
      {
        scheduleId: 'sched-1',
        on: '2026-11-18',
        outcome: 'skipped',
        message: 'SB020: booking overlaps with ELISA plate 5 (id)',
      },
      {
        scheduleId: 'sched-1',
        on: '2026-12-02',
        outcome: 'skipped',
        message: 'SB020: booking overlaps with Kinetics run (id)',
      },
    ],
  },
  {
    schedule: toRepeatSchedule(
      wire({
        id: 'sched-2',
        title: 'Thermocycler block check',
        frequency: 'monthly',
        weekdays: null,
        max_occurrences: null,
        ends_on: '2027-06-30',
        starts_on: '2026-11-12',
        resource_id: INSTRUMENTS[1].id,
        start_time: '13:00:00',
        end_time: '14:00:00',
      }),
    ),
    made: 8,
    next: '2026-12-12',
    notMade: [],
  },
  {
    schedule: toRepeatSchedule(
      wire({
        id: 'sched-3',
        title: 'Daily blank read',
        frequency: 'daily',
        weekdays: null,
        status: 'paused',
        max_occurrences: 30,
      }),
    ),
    made: 14,
    next: null,
    notMade: [],
  },
]

const EXPERIMENT_ROWS: RepeatRow[] = [
  {
    schedule: toRepeatSchedule(
      wire({
        id: 'sched-4',
        kind: 'experiment',
        title: 'Stability pull, lot 24-117',
        frequency: 'offsets',
        weekdays: null,
        offsets_days: [0, 7, 14, 30, 90, 180],
        max_occurrences: null,
        resource_id: null,
        start_time: null,
        end_time: null,
        notebook_template_id: 'tpl-1',
        project_id: 'proj-1',
        starts_on: '2026-10-05',
      }),
    ),
    made: 4,
    next: '2027-01-03',
    notMade: [],
  },
  {
    schedule: toRepeatSchedule(
      wire({
        id: 'sched-5',
        kind: 'experiment',
        title: 'Weekly column wash',
        weekdays: [5],
        max_occurrences: 26,
        resource_id: null,
        start_time: null,
        end_time: null,
        notebook_template_id: 'tpl-2',
        project_id: 'proj-1',
        starts_on: '2026-10-16',
      }),
    ),
    made: 3,
    next: '2026-11-06',
    notMade: [
      {
        scheduleId: 'sched-5',
        on: '2026-10-30',
        outcome: 'failed',
        message: 'SB090: the template has no published version',
      },
    ],
  },
]

const meta = {
  title: 'Schedule/Repeating work',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/', ['/instruments/$instrumentId']),
        path: '/',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function withClient(
  seed: Parameters<typeof screenQueryClient>[0],
  children: React.ReactNode,
) {
  return (
    <QueryClientProvider client={screenQueryClient(seed)}>
      <StubDataClient stub={ZONE}>{children}</StubDataClient>
    </QueryClientProvider>
  )
}

/** A weekly repeat set up from the book dialog. */
export const BookWeekly: Story = {
  render: () =>
    withClient(
      {},
      <BookDialog
        instruments={INSTRUMENTS}
        defaultDate="2026-11-09"
        workspaceId={WS}
        onBooked={() => {}}
        defaultOpen
      />,
    ),
  play: async () => {
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: /Instrument/ }),
    )
    await userEvent.click(await screen.findByRole('option', { name: /PR-01/ }))
    await userEvent.type(
      within(dialog).getByLabelText(/What/),
      'Plate reader QC',
    )
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Repeat'),
      'weekly',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wed' }))
  },
}

/** The bookings that repeat: what each made, the next one, and what clashed. */
export const RepeatingBookings: Story = {
  render: () =>
    withClient(
      {
        data: [
          {
            key: recurringQueryKeys.list(WS, 'booking'),
            value: BOOKING_ROWS,
          },
        ],
      },
      <RepeatingDialog
        kind="booking"
        workspaceId={WS}
        names={new Map(INSTRUMENTS.map((i) => [i.id, i.name]))}
      />,
    ),
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /Repeating/ }),
    )
    await screen.findByText('Plate reader QC')
  },
}

/** Experiments that start on a schedule, with a stability study at time points. */
export const RepeatingExperiments: Story = {
  render: () =>
    withClient(
      {
        data: [
          {
            key: recurringQueryKeys.list(WS, 'experiment'),
            value: EXPERIMENT_ROWS,
          },
        ],
      },
      <RepeatingDialog
        kind="experiment"
        workspaceId={WS}
        actions={<RepeatExperimentDialog workspaceId={WS} />}
      />,
    ),
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /Repeating/ }),
    )
    await screen.findByText('Stability pull, lot 24-117')
  },
}

const TEMPLATES = [
  { id: 'tpl-1', name: 'Stability pull' },
  { id: 'tpl-2', name: 'Column wash' },
]

const PROJECTS = [
  { id: 'proj-1', title: 'Process development' },
  { id: 'proj-2', title: 'Formulation' },
]

function ExperimentDialog() {
  return withClient(
    {
      data: [
        { key: ['recurring', 'templates'], value: TEMPLATES },
        { key: ['recurring', 'projects'], value: PROJECTS },
      ],
    },
    <RepeatExperimentDialog workspaceId={WS} />,
  )
}

/** Start experiments at fixed time points, as a stability study needs. */
export const StartAtTimePoints: Story = {
  render: () => <ExperimentDialog />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Start on a schedule' }),
    )
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/Template/),
      'tpl-1',
    )
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/Project/),
      'proj-1',
    )
    await userEvent.type(
      within(dialog).getByLabelText(/^Name/),
      'Stability pull, lot 24-117',
    )
    await userEvent.click(
      within(dialog).getByRole('tab', { name: 'At time points' }),
    )
    await userEvent.type(
      within(dialog).getByLabelText(/Days after the first day/),
      '0, 7, 14, 30, 90, 180',
    )
  },
}

/** Start experiments on a regular schedule. */
export const StartWeekly: Story = {
  render: () => <ExperimentDialog />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Start on a schedule' }),
    )
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/Template/),
      'tpl-2',
    )
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/Project/),
      'proj-1',
    )
    await userEvent.type(
      within(dialog).getByLabelText(/^Name/),
      'Weekly column wash',
    )
  },
}
