import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ContributorAvatars } from '#/components/record/inspector-sections'

const contributors = [
  { id: 'u1', name: 'Ava Chen' },
  { id: 'u2', name: 'Marco Silva', initials: 'MS' },
  { id: 'u3', name: 'Priya Raman' },
  { id: 'u4', name: 'Tom Ellis' },
  { id: 'u5', name: 'Sara Ndiaye' },
  { id: 'u6', name: 'Ben Okafor' },
]

const meta = {
  title: 'Record/Inspector sections/Contributor avatars',
  component: ContributorAvatars,
  tags: ['autodocs'],
  args: { contributors },
} satisfies Meta<typeof ContributorAvatars>
export default meta
type Story = StoryObj<typeof meta>

/** Six contributors, `max` of four shown, the rest counted. */
export const Default: Story = {}

/** Exactly `max` contributors: no overflow chip appears. */
export const NoOverflow: Story = {
  args: { contributors: contributors.slice(0, 4) },
}

export const Medium: Story = { args: { size: 'md' } }

/** A single contributor still renders as a stack of one. */
export const Single: Story = {
  args: { contributors: contributors.slice(0, 1), max: 1 },
}

/** An empty list renders nothing — callers need no empty branch. */
export const Empty: Story = { args: { contributors: [] } }
