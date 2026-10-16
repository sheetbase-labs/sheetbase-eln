import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Icon } from '#/components/icons'
import { RecordLink } from '#/components/scientific/record-link'
import { Button } from '#/components/v3/ui/button'
import { RowList } from '#/components/v3/ui/row'

const meta = {
  title: 'Scientific/Record link',
  component: RecordLink,
  tags: ['autodocs'],
  args: {
    type: 'Sample',
    title: 'Human plasma aliquot',
    meta: 'SMP-2026-0142 · 2.4 mL',
    icon: 'flask',
  },
} satisfies Meta<typeof RecordLink>
export default meta
type Story = StoryObj<typeof meta>
export const Available: Story = {}
export const States: Story = {
  render: () => (
    <div className="grid max-w-lg gap-2">
      {(
        ['available', 'missing', 'deleted', 'permission-restricted'] as const
      ).map((state) => (
        <RecordLink
          key={state}
          type="Sample"
          title={
            state === 'available' ? 'Human plasma aliquot' : 'Linked sample'
          }
          meta={`SMP-2026-0142 · ${state}`}
          state={state}
          actions={
            <Button variant="quiet" size="icon">
              <Icon name="more" />
            </Button>
          }
        />
      ))}
    </div>
  ),
}

/**
 * The compact list density — the entity rows an inspector list holds. Every
 * list of records is a `RowList` of these, so the row's link and read-only
 * spellings stay one chrome.
 */
export const List: Story = {
  render: () => (
    <div className="max-w-lg">
      <RowList>
        <RecordLink
          density="list"
          type="Sample"
          title="Human plasma aliquot"
          meta="SMP-2026-0142"
          icon="flask"
          detail="Linked 2026-08-03 by user-1"
        />
        <RecordLink
          density="list"
          type="Protocol"
          title="Titration assay SOP"
          meta="v3"
          icon="protocol"
        />
        <RecordLink
          density="list"
          type="Sample"
          title="Archived cell bank"
          state="archived"
          icon="tube"
        />
        <RecordLink
          density="list"
          type="Record"
          title="Restricted record"
          state="permission-restricted"
          icon="lock"
        />
      </RowList>
    </div>
  ),
}
