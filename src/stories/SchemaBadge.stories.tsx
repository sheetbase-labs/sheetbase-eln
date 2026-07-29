import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { SchemaBadge } from '#/components/dataset-schema/schema-badge'

const schema = {
  id: 'schema-1',
  slug: 'plate-reader',
  name: 'Plate reader results',
  revision: 2,
  status: 'published',
  latest_published_revision: 2,
}
const meta = {
  title: 'Features/SchemaBadge',
  component: SchemaBadge,
  tags: ['autodocs'],
  args: { schema },
} satisfies Meta<typeof SchemaBadge>
export default meta
type Story = StoryObj<typeof meta>
export const Current: Story = {}
export const UpgradeAvailable: Story = {
  args: { schema: { ...schema, latest_published_revision: 4 } },
}
export const WithUpgradeAction: Story = {
  args: {
    schema: { ...schema, latest_published_revision: 4 },
    onUpgrade: () => undefined,
  },
}
export const Upgrading: Story = {
  args: {
    schema: { ...schema, latest_published_revision: 4 },
    onUpgrade: () => undefined,
    upgrading: true,
  },
}
