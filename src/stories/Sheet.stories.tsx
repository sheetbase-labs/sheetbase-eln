import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Button } from '#/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet'

const meta = {
  title: 'UI/Sheet',
  component: Sheet,
  tags: ['autodocs'],
} satisfies Meta<typeof Sheet>
export default meta
type Story = StoryObj<typeof meta>
const Demo = ({
  side = 'right',
}: {
  side?: 'top' | 'right' | 'bottom' | 'left'
}) => (
  <Sheet>
    <SheetTrigger asChild>
      <Button variant="outline">Open {side} sheet</Button>
    </SheetTrigger>
    <SheetContent side={side}>
      <SheetHeader>
        <SheetTitle>Record details</SheetTitle>
        <SheetDescription>
          Review metadata without leaving the page.
        </SheetDescription>
      </SheetHeader>
      <div className="py-6 text-sm">Sheet content</div>
      <SheetFooter>
        <Button>Done</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
)
export const Right: Story = { render: () => <Demo /> }
export const Sides: Story = {
  render: () => (
    <div className="flex gap-2">
      <Demo side="left" />
      <Demo side="bottom" />
      <Demo side="top" />
    </div>
  ),
}
