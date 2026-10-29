import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Chip } from '#/components/v3/ui/chip'

/**
 * The forward kit's Chip (src/components/v3/ui/chip.tsx): one pill for the
 * three jobs the app had three class strings for — a removable filter value,
 * a pressed filter or scope, and a phone nav section. The selected pair is one
 * token pair (`border-selection-border` on `bg-selection`) everywhere.
 *
 * The nav variant renders a router Link when a screen passes one:
 * `render={<Link to="/settings/api" />}`.
 */
const meta = {
  title: 'UI/Chip',
  component: Chip,
  tags: ['autodocs'],
  args: { children: 'Chip' },
} satisfies Meta<typeof Chip>
export default meta
type Story = StoryObj<typeof meta>

export const Removable: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Chip
        variant="remove"
        removeLabel="Remove filter: status isn’t Archived"
        onRemove={() => {}}
      >
        Status is not <b className="font-medium">Archived</b>
      </Chip>
      <Chip
        variant="remove"
        removeLabel="Remove filter: stage is Discovery"
        onRemove={() => {}}
      >
        Stage is <b className="font-medium">Discovery</b>
      </Chip>
    </div>
  ),
}

function ToggleDemo() {
  const [on, setOn] = useState(true)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip variant="toggle" pressed={on} onClick={() => setOn((v) => !v)}>
        Samples
      </Chip>
      <Chip variant="toggle" pressed={!on} onClick={() => setOn((v) => !v)}>
        Materials
      </Chip>
      <Chip
        variant="toggle"
        pressed={false}
        onClick={() => {}}
        icon="tube"
        count={12}
      >
        Experiments
      </Chip>
      <Chip
        variant="toggle"
        pressed
        onClick={() => {}}
        icon="archive"
        aria-label="Include archived"
      >
        Include archived
      </Chip>
    </div>
  )
}

export const Toggle: Story = {
  render: () => <ToggleDemo />,
}

const sections = [
  { label: 'General', current: false },
  { label: 'Members and roles', current: true },
  { label: 'API and SDK', current: false },
]

export const Nav: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-1.5">
      {sections.map((s) => (
        <Chip
          key={s.label}
          variant="nav"
          current={s.current}
          onClick={() => {}}
        >
          {s.label}
        </Chip>
      ))}
      <span className="mx-2 text-label text-fg-muted">portal rail</span>
      <Chip variant="nav" size="md" current onClick={() => {}}>
        Projects
      </Chip>
      <Chip variant="nav" size="md" current={false} onClick={() => {}}>
        Records
      </Chip>
    </div>
  ),
}
