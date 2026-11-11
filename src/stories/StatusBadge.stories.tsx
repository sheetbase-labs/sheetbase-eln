import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { StatusBadge } from '#/components/scientific/status-badge'
import { statusVocabularies } from '#/components/scientific/status-vocabularies'
import type { StatusDomain } from '#/components/scientific/status-vocabularies'

/** True for the badge domains the shared vocabulary defines. */
function isStatusDomain(value: string): value is StatusDomain {
  return Object.hasOwn(statusVocabularies, value)
}

const meta = {
  title: 'Scientific/Status badge',
  component: StatusBadge,
  tags: ['autodocs'],
  args: { domain: 'experiment', status: 'in-progress' },
} satisfies Meta<typeof StatusBadge>

export default meta

type Story = StoryObj<typeof meta>

export const InProgress: Story = {}
export const Review: Story = { args: { status: 'review' } }
export const Approved: Story = { args: { status: 'approved' } }
export const Failed: Story = { args: { status: 'failed' } }

export const EveryVocabulary: Story = {
  render: () => (
    <div className="space-y-5">
      {Object.keys(statusVocabularies).map((domain) => {
        if (!isStatusDomain(domain)) return null
        const vocabulary = statusVocabularies[domain]

        return (
          <section key={domain}>
            <h3 className="mb-2 font-semibold">{domain.replace('_', ' ')}</h3>
            <div className="flex flex-wrap gap-2">
              {Object.keys(vocabulary).map((status) => (
                <StatusBadge key={status} domain={domain} status={status} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  ),
}

export const SizesAndUnknown: Story = {
  render: () => (
    <div className="flex gap-2">
      <StatusBadge domain="experiment" status="approved" size="sm" />
      <StatusBadge domain="experiment" status="approved" size="md" />
      <StatusBadge domain="experiment" status="future-state" />
    </div>
  ),
}
