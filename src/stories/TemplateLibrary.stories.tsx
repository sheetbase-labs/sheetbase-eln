import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { TemplateFilters } from '#/components/templates/template-library'

const meta = {
  title: 'Features/TemplateLibrary',
  component: TemplateFilters,
  tags: ['autodocs'],
} satisfies Meta<typeof TemplateFilters>
export default meta
type Story = StoryObj<typeof meta>
const args = {
  statusFilter: 'all',
  onStatusChange: () => undefined,
  search: '',
  onSearchChange: () => undefined,
  count: 12,
  onFavouritesOnlyChange: () => undefined,
  onOwnershipChange: () => undefined,
  onViewChange: () => undefined,
}
export const Filters: Story = { args }
export const GridFavourites: Story = {
  args: { ...args, view: 'grid', favouritesOnly: true, ownership: 'mine' },
}
