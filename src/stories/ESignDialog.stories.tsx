import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ESignDialog } from '#/components/notebook/e-sign-dialog'

/**
 * The shared e-signature dialog. It owns the meaning, the name confirmation
 * and the password, and reports the entered values through `onSubmit`; the
 * flow's step-up and write stay with the caller.
 */
const meta = {
  title: 'Notebook/E-sign dialog',
  component: ESignDialog,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    open: true,
    onOpenChange: () => {},
    title: 'Sign this revision',
    description: 'Approving records your signature against revision 4.',
    signingAs: 'Ava Chen',
    subject: {
      revisionId: '0198d970-e266-4000-8000-000000000071',
      digest: '4c9620bbd4f931955d4d42820a77fa9d',
    },
    meanings: ['reviewed', 'reviewed-and-approved', 'witnessed'],
    onSubmit: () => {},
  },
} satisfies Meta<typeof ESignDialog>
export default meta
type Story = StoryObj<typeof meta>

/** The form: meaning, name confirmation, password. */
export const Default: Story = {}

/** A caller-requested meaning is pre-selected. */
export const InitialMeaning: Story = {
  args: { initialMeaning: 'witnessed' },
}

/** Without a name confirmation the secret is the only gate. */
export const NoConfirmation: Story = { args: { requireConfirmation: false } }

/** The step-up and write are in flight. */
export const Busy: Story = { args: { busy: true } }

/** A refusal from the server leaves the form filled in. */
export const ErrorMessage: Story = {
  args: { errorMessage: 'The password does not match the signed-in account.' },
}

/** Signing is not available to this person right now. */
export const Blocked: Story = {
  args: {
    blocked: (
      <p className="text-sm text-fg-muted">
        You cannot sign your own submission. A reviewer must countersign it.
      </p>
    ),
    meanings: [],
  },
}

/** A subject without a digest cannot be signed — the stale-action guard. */
export const MissingDigest: Story = {
  args: { subject: { revisionId: '0198d970-e266-4000-8000-000000000071' } },
}

/** The caller's submit label, e.g. a countersignature. */
export const CustomSubmitLabel: Story = {
  args: { submitLabel: 'Countersign' },
}
