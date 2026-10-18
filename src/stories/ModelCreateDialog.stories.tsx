import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ModelCreateDialog } from '#/components/v3/models/model-create-dialog'

/**
 * The Models board's create dialog
 * (`src/components/v3/models/model-create-dialog.tsx`). It is controlled and
 * stateless about its own errors: the board passes whether a create is in flight
 * and the refusal it got back, so the stories show the dialog open, a create in
 * flight, and the two refusals `describeModelCreateError` names for the board.
 *
 * The dialog's own key/name validation appears once a create has been attempted,
 * which is a click, so it has no story here.
 */
const meta = {
  title: 'Models/New model dialog',
  component: ModelCreateDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    onCreate: () => {},
    creating: false,
    error: null,
  },
} satisfies Meta<typeof ModelCreateDialog>
export default meta
type Story = StoryObj<typeof meta>

/** The dialog as it opens: a key, a name and an optional description. */
export const Default: Story = {}

/** A create in flight: the primary action reads Creating… and is disabled. */
export const Creating: Story = {
  args: { creating: true },
}

/** The key is taken: the board maps the RPC's duplicate-key refusal to this. */
export const KeyAlreadyExists: Story = {
  args: {
    error: 'A model with that key already exists in this workspace.',
  },
}

/** The caller's role cannot create models in this workspace. */
export const NotPermitted: Story = {
  args: {
    error: 'You don’t have permission to create models in this workspace.',
  },
}
