import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { PropertyList, Property } from '#/components/scientific/property-list'
import { Badge } from '#/components/ui/badge'

const properties = [
  ['ID', 'EXP-2025-0014'],
  ['Type', 'Lentiviral vector'],
  ['Status', 'In progress'],
  ['Owner', 'Dr. Maya Chen'],
  ['Storage', '-80 °C / FZ-01'],
  ['Created', '14 July 2025'],
  ['Last modified', '29 July 2025'],
  ['Project', 'Vector stability'],
]
const meta = {
  title: 'Scientific/PropertyList',
  component: PropertyList,
  tags: ['autodocs'],
  args: { children: null },
} satisfies Meta<typeof PropertyList>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <PropertyList>
      {properties.map(([label, value]) => (
        <Property key={label} label={label}>
          {value}
        </Property>
      ))}
    </PropertyList>
  ),
}
export const WithBadges: Story = {
  render: () => (
    <PropertyList>
      <Property label="ID">EXP-2025-0014</Property>
      <Property label="Status">
        <Badge variant="success">In progress</Badge>
      </Property>
      <Property label="Type">Lentiviral vector</Property>
      <Property label="Project">
        <Badge variant="outline">Vector stability</Badge>
      </Property>
    </PropertyList>
  ),
}
export const Compact: Story = {
  render: () => (
    <div className="w-72 rounded-md border p-3">
      <PropertyList className="gap-2">
        {properties.slice(0, 5).map(([label, value]) => (
          <Property key={label} label={label}>
            {value}
          </Property>
        ))}
      </PropertyList>
    </div>
  ),
}

export const MonoStackedLongValue: Story = {
  render: () => (
    <div className="w-80 rounded-md border p-3">
      <PropertyList>
        <Property label="Record ID" mono>
          EXP-2025-0014
        </Property>
        <Property label="Formula" mono stacked>
          concentration:sample_id=EXP-2025-0014/replicate:A
        </Property>
        <Property label="Notes" stacked>
          Preserve the full scientific value and allow it to wrap beneath the
          label when the inspector is narrow.
        </Property>
      </PropertyList>
    </div>
  ),
}
