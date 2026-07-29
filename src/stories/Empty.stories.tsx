import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { FlaskConical, Search } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
} from '#/components/ui/empty'

const meta = {
  title: 'UI/Empty',
  component: Empty,
  tags: ['autodocs'],
} satisfies Meta<typeof Empty>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Empty>
      <EmptyIcon>
        <FlaskConical />
      </EmptyIcon>
      <EmptyTitle>No experiments yet</EmptyTitle>
      <EmptyDescription>
        Create your first experiment to begin recording results.
      </EmptyDescription>
      <EmptyActions>
        <Button size="sm">Create experiment</Button>
      </EmptyActions>
    </Empty>
  ),
}
export const SearchResults: Story = {
  render: () => (
    <Empty>
      <EmptyIcon>
        <Search />
      </EmptyIcon>
      <EmptyTitle>No results</EmptyTitle>
      <EmptyDescription>Try changing your search or filters.</EmptyDescription>
    </Empty>
  ),
}
