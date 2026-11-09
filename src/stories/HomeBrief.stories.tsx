import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { HomeBrief } from '#/components/assist/home-brief'
import type { HomeBriefInput } from '#/lib/home-brief'
import { withPageAi } from './assist-fixtures'

/**
 * "Brief me" on Home: what needs the person and the next step per project,
 * written from the facts Home already holds. It runs only when asked, and
 * renders nothing unless a real model is connected. A story has no model to
 * answer, so a brief that has facts shows the failed notice with its refresh.
 */
const INPUT: HomeBriefInput = {
  reviews: [
    {
      identifier: 'EXP-2026-0042',
      title: 'Virus stability at 25 °C',
      projectTitle: 'TB-02 stability',
    },
  ],
  materials: [{ identifier: 'RGT-0231', reason: 'Expires in 3 days' }],
  datasetIssues: [],
  todayBookings: 1,
  projects: [
    {
      id: 'p1',
      title: 'TB-02 stability',
      stage: 'Study',
      total: 8,
      approved: 3,
      inReview: 1,
    },
  ],
}

function Controlled(props: {
  input: HomeBriefInput
  ready: boolean
  initiallyOpen: boolean
}) {
  const [open, setOpen] = useState(props.initiallyOpen)

  return (
    <HomeBrief
      input={props.input}
      ready={props.ready}
      open={open}
      onOpenChange={setOpen}
    />
  )
}

const meta = {
  title: 'Assistant/Home brief',
  component: HomeBrief,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { input: INPUT, ready: true, open: false, onOpenChange: () => {} },
  decorators: [withPageAi('live')],
} satisfies Meta<typeof HomeBrief>

export default meta

type Story = StoryObj<typeof meta>

/** The "Brief me" button, as it sits on Home. */
export const Trigger: Story = {
  render: (args) => (
    <div className="p-6">
      <Controlled input={args.input} ready initiallyOpen={false} />
    </div>
  ),
}

/** Opened with facts, and no model to write the brief. */
export const CouldNotWrite: Story = {
  render: (args) => <Controlled input={args.input} ready initiallyOpen />,
}

/** Opened with nothing waiting on the person. */
export const NothingToBrief: Story = {
  render: () => (
    <Controlled
      input={{
        reviews: [],
        materials: [],
        datasetIssues: [],
        todayBookings: 0,
        projects: [],
      }}
      ready
      initiallyOpen
    />
  ),
}

/** Opened while the projects' counts are still loading. */
export const StillLoading: Story = {
  render: (args) => (
    <Controlled input={args.input} ready={false} initiallyOpen />
  ),
}
