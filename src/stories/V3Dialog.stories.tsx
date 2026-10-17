import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import { Input } from '#/components/v3/ui/input'

/**
 * The forward kit's dialog, built on Base UI. Dialogs are the only surface with
 * `rounded-lg` and `shadow-dialog`. It takes focus, traps it, closes on Esc and
 * on an outside click, and returns focus to the trigger.
 *
 * The legacy `UI/Dialog` story in `Dialog.stories.tsx` covers
 * `src/components/ui/dialog.tsx` — a same-named Radix file, not this one.
 */
const meta = {
  title: 'v3 kit/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Dialog>
export default meta
type Story = StoryObj<typeof meta>

const Trigger = () => (
  <DialogTrigger render={<Button variant="primary" />}>
    New pipeline
  </DialogTrigger>
)

/** The ordinary case: a titled form with a footer, opened by its trigger. */
export const Default: Story = {
  render: () => (
    <Dialog>
      <Trigger />
      <DialogContent>
        <DialogHeader
          title="New pipeline"
          description="Runs on the schedule you set once it is saved."
        />
        <DialogBody>
          <label className="flex flex-col gap-1 text-label">
            Name
            <Input placeholder="Clarification step yield" />
          </label>
          <label className="flex flex-col gap-1 text-label">
            Description
            <Input placeholder="Fits yield against filter load" />
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary">Create pipeline</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

/** Shown open, so the panel itself is reviewable without clicking. */
export const Open: Story = {
  render: () => (
    <Dialog defaultOpen>
      <Trigger />
      <DialogContent>
        <DialogHeader
          title="Duplicate notebook"
          description="EXP-0142 · AAV9 process"
        />
        <DialogBody>
          <p className="mb-0 text-body text-fg-muted">
            A copy is made with every block, figure and signature state, except
            the signature itself. The person who signs the copy is recorded
            separately.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary">Duplicate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

/** No description line, for a dialog whose title is the whole question. */
export const TitleOnly: Story = {
  render: () => (
    <Dialog defaultOpen>
      <Trigger />
      <DialogContent>
        <DialogHeader title="Discard draft?" />
        <DialogBody>
          <p className="mb-0 text-body text-fg-muted">
            The version you were editing is not saved.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Keep editing</DialogClose>
          <Button variant="danger-fill">Discard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
