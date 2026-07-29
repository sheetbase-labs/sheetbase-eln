import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Info } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'

const meta = {
  title: 'UI/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
} satisfies Meta<typeof Tooltip>
export default meta
type Story = StoryObj<typeof meta>
const Demo = ({ open = false }) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip open={open || undefined}>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More information">
          <Info />
        </Button>
      </TooltipTrigger>
      <TooltipContent>View experiment details</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)
export const Default: Story = { render: () => <Demo /> }
export const Open: Story = { render: () => <Demo open /> }
