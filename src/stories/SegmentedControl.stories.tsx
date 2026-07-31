import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { BarChart3, LayoutGrid, Table2 } from 'lucide-react'
import { useState  } from 'react'
import type {ReactNode} from 'react';

import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'

const meta = {
  title: 'UI/Segmented control',
  component: ToggleGroup,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { type: 'single' },
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex rounded-lg border bg-card p-3">{children}</div>
  )
}

const views = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'chart', label: 'Chart', icon: BarChart3 },
  { value: 'gallery', label: 'Gallery', icon: LayoutGrid },
] as const

function MandatoryViewControl() {
  const [view, setView] = useState('table')

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={view}
      onValueChange={(nextView) => nextView && setView(nextView)}
    >
      {views.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem key={value} value={value}>
          <Icon /> {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export const Default: Story = {
  render: () => (
    <Frame>
      <ToggleGroup type="single" variant="outline" defaultValue="table">
        {views.map(({ value, label, icon: Icon }) => (
          <ToggleGroupItem key={value} value={value}>
            <Icon /> {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Frame>
  ),
}

export const IconOnly: Story = {
  render: () => (
    <Frame>
      <ToggleGroup type="single" variant="outline" defaultValue="chart">
        {views.map(({ value, label, icon: Icon }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            aria-label={`${label} view`}
          >
            <Icon />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Frame>
  ),
}

export const WithCounts: Story = {
  render: () => (
    <Frame>
      <ToggleGroup type="single" variant="outline" defaultValue="table">
        <ToggleGroupItem value="table">
          <Table2 /> Table (142)
        </ToggleGroupItem>
        <ToggleGroupItem value="chart">
          <BarChart3 /> Chart (12)
        </ToggleGroupItem>
        <ToggleGroupItem value="gallery">
          <LayoutGrid /> Gallery (36)
        </ToggleGroupItem>
      </ToggleGroup>
    </Frame>
  ),
}

export const Vertical: Story = {
  render: () => (
    <Frame>
      <ToggleGroup
        type="single"
        variant="outline"
        defaultValue="gallery"
        orientation="vertical"
        className="flex-col items-stretch"
      >
        {views.map(({ value, label, icon: Icon }) => (
          <ToggleGroupItem key={value} value={value} className="justify-start">
            <Icon /> {label} samples
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Frame>
  ),
}

export const SingleMandatory: Story = {
  render: () => (
    <Frame>
      <MandatoryViewControl />
    </Frame>
  ),
}
