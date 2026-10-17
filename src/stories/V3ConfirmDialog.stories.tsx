import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from '#/components/v3/ui/confirm-dialog'

/**
 * The confirmation dialog, on the v3 Dialog with `role="alertdialog"`. It exists
 * so the routes that moved off the legacy `AlertDialog` kept their structure:
 * trigger, header, title, description, footer, cancel, action.
 */
const meta = {
  title: 'v3 kit/Confirm dialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ConfirmDialog>
export default meta
type Story = StoryObj<typeof meta>

/**
 * `ConfirmDialogTrigger` is `asChild` by default, so the button you pass is the
 * trigger rather than being wrapped in one.
 */
export const Destructive: Story = {
  render: () => (
    <ConfirmDialog>
      <ConfirmDialogTrigger>
        <Button variant="danger">Withdraw sample</Button>
      </ConfirmDialogTrigger>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>Withdraw SMP-2231?</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            The aliquot is marked withdrawn and cannot be returned to stock.
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel />
          <ConfirmDialogAction variant="danger-fill">
            Withdraw
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  ),
}

/** Shown open, without a description line: the title is the question. */
export const ReversibleAction: Story = {
  render: () => (
    <ConfirmDialog defaultOpen>
      <ConfirmDialogTrigger>
        <Button>Archive record</Button>
      </ConfirmDialogTrigger>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>Archive this record?</ConfirmDialogTitle>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>Keep it open</ConfirmDialogCancel>
          <ConfirmDialogAction>Archive</ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  ),
}

/** With `asChild` off, the trigger renders its own button and the text labels it. */
export const SelfRenderedTrigger: Story = {
  render: () => (
    <ConfirmDialog>
      <ConfirmDialogTrigger asChild={false}>Sign and lock</ConfirmDialogTrigger>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>Sign this notebook section?</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            Signing locks the section. Later edits are recorded as amendments.
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel />
          <ConfirmDialogAction>Sign section</ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  ),
}
