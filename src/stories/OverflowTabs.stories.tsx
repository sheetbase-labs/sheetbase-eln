import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useState } from 'react'

import { OverflowTabs } from '#/components/v3/ui/overflow-tabs'
import { TabsPanel, TabsRoot } from '#/components/v3/ui/tabs'

const items = [
  { value: 'properties', label: 'Properties' },
  { value: 'outline', label: 'Outline' },
  { value: 'history', label: 'History', count: 12 },
  { value: 'comments', label: 'Comments', count: 3 },
  { value: 'activity', label: 'Activity' },
]

function Demo({ width }: { width: number }) {
  const [value, setValue] = useState('properties')
  return (
    <div style={{ width }} className="border border-border bg-surface">
      <TabsRoot value={value} onValueChange={(next) => setValue(String(next))}>
        <div className="flex border-b border-border px-4">
          <OverflowTabs items={items} value={value} onValueChange={setValue} />
        </div>
        {items.map((item) => (
          <TabsPanel key={item.value} value={item.value} className="p-4">
            {item.label}
          </TabsPanel>
        ))}
      </TabsRoot>
    </div>
  )
}

const meta = {
  title: 'UI/Overflow tabs',
  component: OverflowTabs,
  tags: ['autodocs'],
  args: { items, value: 'properties', onValueChange: () => {} },
} satisfies Meta<typeof OverflowTabs>
export default meta
type Story = StoryObj<typeof meta>

export const Wide: Story = { render: () => <Demo width={520} /> }
export const InspectorWidth: Story = { render: () => <Demo width={300} /> }
export const Narrow: Story = { render: () => <Demo width={200} /> }
