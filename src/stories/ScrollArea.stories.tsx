import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ScrollArea, ScrollBar } from '#/components/ui/scroll-area'

const meta = {
  title: 'UI/ScrollArea',
  component: ScrollArea,
  tags: ['autodocs'],
} satisfies Meta<typeof ScrollArea>
export default meta
type Story = StoryObj<typeof meta>
export const Vertical: Story = {
  render: () => (
    <ScrollArea className="h-48 w-72 rounded-md border p-4">
      {Array.from({ length: 20 }, (_, index) => (
        <div key={index} className="border-b py-2 text-sm">
          Experiment {index + 1}
        </div>
      ))}
    </ScrollArea>
  ),
}
export const Horizontal: Story = {
  render: () => (
    <ScrollArea className="w-80 whitespace-nowrap rounded-md border">
      <div className="flex w-max gap-3 p-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="w-32 rounded bg-muted p-4">
            Sample {index + 1}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
}
