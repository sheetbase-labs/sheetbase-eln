import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordActionsMenu } from '#/components/notebook/record-actions'
import type { RecordAction } from '#/components/notebook/record-actions'

/**
 * A record's one ⋯ menu. Everything that is not the page's main button lives
 * here: Open review, Print, labels and the exports. On the experiment page the
 * page header shows these in its own menu; elsewhere this menu stands alone.
 */
const actions: RecordAction[] = [
  { id: 'open-review', label: 'Open review', icon: 'check', to: '/review/1' },
  { id: 'print', label: 'Print', icon: 'report', onSelect: () => undefined },
  {
    id: 'print-label',
    label: 'Print label',
    icon: 'tag',
    onSelect: () => undefined,
  },
  {
    id: 'export-evidence',
    label: 'Export evidence',
    icon: 'download',
    href: '/api/export/revision/1/package',
  },
]

const meta = {
  title: 'Notebook/Record actions menu',
  component: RecordActionsMenu,
  args: { actions },
} satisfies Meta<typeof RecordActionsMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** With nothing to offer the menu is absent, not an empty button. */
export const NothingToOffer: Story = { args: { actions: [] } }
