import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ComposedSheetRecordToolbar } from '#/components/sheet/composed-sheet-record-toolbar'
import type { SheetRecordGridError } from '#/lib/sheet-record-grid-errors'
import { resolveSheetRecordActions } from '#/lib/sheet-record-actions'

/**
 * The composed Sheet's record toolbar. Actions come from
 * `resolveSheetRecordActions` — the same resolver the workspace uses — so the
 * enabled/disabled state and the reason text are the product's own.
 */
const bothActions = resolveSheetRecordActions({
  actions: [
    { id: 'a1', key: 'link', label: 'Link Sample', kind: 'link-record' },
    { id: 'a2', key: 'create', label: 'Create Sample', kind: 'create-record' },
  ],
})

const linkOnly = resolveSheetRecordActions({
  actions: [
    { id: 'a1', key: 'link', label: 'Link Sample', kind: 'link-record' },
  ],
})

const errors: SheetRecordGridError[] = [
  {
    rowKey: 'row-a',
    code: 'required_value',
    kind: 'validation',
    message: 'Required.',
  },
  {
    rowKey: 'row-b',
    code: 'unmatched_row',
    kind: 'validation',
    message: 'No planned row matched.',
  },
]

const meta = {
  title: 'Sheet/Composed sheet record toolbar',
  component: ComposedSheetRecordToolbar,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full rounded-md border border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    actions: bothActions,
    errors: [],
    onLink: () => {},
    onCreate: () => {},
    onValidate: () => {},
    onCommit: () => {},
    onNextError: () => {},
  },
} satisfies Meta<typeof ComposedSheetRecordToolbar>
export default meta
type Story = StoryObj<typeof meta>

/** Both actions configured on the Sheet Definition. */
export const Default: Story = {}

/** Link-only definition: create is disabled with its reason as the title. */
export const LinkOnlyDefinition: Story = { args: { actions: linkOnly } }

/** Blocking errors add the counted “Next error” affordance. */
export const WithErrors: Story = { args: { errors } }

/** No collaborator room: the awareness surfaces stay silent. */
export const NoCollaborators: Story = { args: { actions: bothActions } }
