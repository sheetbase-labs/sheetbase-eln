import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '#/components/ui/accordion'

const meta = {
  title: 'UI/Accordion',
  component: Accordion,
  tags: ['autodocs'],
} satisfies Meta<typeof Accordion>
export default meta
type Story = StoryObj<typeof meta>

const items = ['Overview', 'Methods', 'Results']
export const Single: Story = {
  args: { type: 'single' },
  render: () => (
    <Accordion type="single" collapsible className="w-96">
      {items.map((item) => (
        <AccordionItem key={item} value={item}>
          <AccordionTrigger>{item}</AccordionTrigger>
          <AccordionContent>
            Details for the {item.toLowerCase()} section.
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
}
export const MultipleOpen: Story = {
  args: { type: 'multiple' },
  render: () => (
    <Accordion
      type="multiple"
      defaultValue={items.slice(0, 2)}
      className="w-96"
    >
      {items.map((item) => (
        <AccordionItem key={item} value={item}>
          <AccordionTrigger>{item}</AccordionTrigger>
          <AccordionContent>Supporting content for {item}.</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
}
