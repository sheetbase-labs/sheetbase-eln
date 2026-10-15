import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
  tags: ['autodocs'],
} satisfies Meta<typeof Dialog>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button>Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit experiment</DialogTitle>
          <DialogDescription>
            Update the experiment title below.
          </DialogDescription>
        </DialogHeader>
        <Input defaultValue="Protein stability study" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
export const Open: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dialog preview</DialogTitle>
          <DialogDescription>
            This story starts in the open state.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
}
