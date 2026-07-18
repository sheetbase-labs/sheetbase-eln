import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'

const meta = { title: 'UI/Button', component: Button, tags: ['autodocs'], args: { children: 'Button' } } satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>
export const Primary: Story = {}
export const Outline: Story = { args: { variant: 'outline' } }
export const Destructive: Story = { args: { variant: 'destructive' } }
export const WithIcon: Story = { render: () => <Button><Plus />Create experiment</Button> }
