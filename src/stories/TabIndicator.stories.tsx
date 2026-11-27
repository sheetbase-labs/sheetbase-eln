import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useState } from 'react'

import { TabIndicator } from '#/components/ui/tab-indicator'
import { Tabs } from '#/components/ui/tabs'

const views = ['Open', 'All', 'Mine', 'In progress', 'On hold']

/** Pick a tab: the current-tab mark slides across to it. */
function Demo({ variant }: { variant: 'strip' | 'segment' }) {
  const [value, setValue] = useState('open')

  return (
    <div className="bg-surface p-6">
      <Tabs
        mode="state"
        variant={variant}
        label="Experiment views"
        value={value}
        onValueChange={setValue}
        items={views.map((label) => ({
          key: label.toLowerCase(),
          label,
        }))}
      />
    </div>
  )
}

const meta = {
  title: 'UI/Tab indicator',
  component: TabIndicator,
  tags: ['autodocs'],
} satisfies Meta<typeof TabIndicator>

export default meta

type Story = StoryObj<typeof meta>

export const Strip: Story = { render: () => <Demo variant="strip" /> }

export const Segment: Story = { render: () => <Demo variant="segment" /> }
