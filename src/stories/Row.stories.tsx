import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Icon } from '#/components/v3/icons'
import { Badge } from '#/components/v3/ui/badge'
import { Row, RowList } from '#/components/v3/ui/row'

/**
 * The row chrome every list in the app composes (JH-1): one frame with a
 * leading slot, a title, an optional label and meta line, and a trailing slot.
 * A row is a link, an anchor, a button or read-only, and all four forms share
 * the same chrome — which is the point: the ≈30 hand-rolled rows this replaces
 * each spelled the link and the static branch differently.
 */
const meta = {
  title: 'UI/Row',
  component: Row,
  tags: ['autodocs'],
  args: {
    title: 'Virus stability — 4 °C',
    eyebrow: 'Experiment',
    meta: 'EXP-2026-0041',
  },
} satisfies Meta<typeof Row>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="w-96">
      <RowList>
        <Row
          {...args}
          to="/records/r-1"
          leading={
            <span className="flex size-6 items-center justify-center rounded-md bg-selection text-fg">
              <Icon name="flask" size={12} />
            </span>
          }
        />
        <Row
          {...args}
          to="/records/r-2"
          title="Cell bank WCB-2"
          meta="SMP-2026-0007"
        />
        <Row {...args} title="Archived protocol" meta="Archived" />
      </RowList>
    </div>
  ),
}

export const Card: Story = {
  render: (args) => (
    <div className="w-96">
      <Row
        {...args}
        density="card"
        to="/records/r-1"
        leading={
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary-text">
            <Icon name="flask" size={16} />
          </span>
        }
        trailing={
          <Badge variant="kind" className="px-1.5 py-0 text-[0.65rem]">
            ×3
          </Badge>
        }
      />
    </div>
  ),
}

export const Forms: Story = {
  render: (args) => (
    <div className="w-96">
      <RowList>
        <Row {...args} to="/records/r-1" meta="Route link" />
        <Row {...args} href="/api/files/f-1" meta="Anchor — download" />
        <Row {...args} onClick={() => undefined} meta="Button — acts" />
        <Row {...args} meta="Read-only — nothing to open" />
      </RowList>
    </div>
  ),
}

export const TrailingSlots: Story = {
  render: (args) => (
    <div className="w-96">
      <RowList>
        <Row
          {...args}
          title="Data integrity"
          eyebrow="Check"
          meta={undefined}
          trailing={
            <>
              <span className="text-[0.65rem] text-fg-muted">
                Due in 10 days
              </span>
              <Badge variant="chg" className="px-1.5 py-0 text-[0.65rem]">
                Warning
              </Badge>
            </>
          }
        />
        <Row
          {...args}
          title="protocol.pdf"
          eyebrow="File"
          meta={undefined}
          leading={
            <Icon
              name="download"
              size={14}
              className="text-danger-text"
              aria-hidden="true"
            />
          }
          trailing={
            <span className="text-[0.65rem] tabular-nums text-fg-muted">
              2.4 MB
            </span>
          }
        />
      </RowList>
    </div>
  ),
}

export const Divided: Story = {
  render: (args) => (
    <div className="w-96">
      <RowList divided>
        <Row {...args} title="Review requested" meta={undefined} />
        <Row {...args} title="Signature requested" meta={undefined} />
      </RowList>
    </div>
  ),
}

export const Windowed: Story = {
  render: (args) => (
    <div className="w-96">
      <RowList limit={3}>
        {Array.from({ length: 30 }, (_, i) => (
          <Row
            {...args}
            key={i}
            to={`/records/r-${i}`}
            title={`Linked record ${i + 1}`}
            detail={`Linked 2026-08-03 by user-1`}
          />
        ))}
      </RowList>
    </div>
  ),
}

export const Empty: Story = {
  render: () => (
    <div className="w-96">
      <RowList
        empty={<p className="py-1 text-xs text-fg-muted">No linked records</p>}
      >
        {[]}
      </RowList>
    </div>
  ),
}
