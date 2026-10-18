import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CameraScanner } from '#/components/scan/camera-scanner'

/**
 * LAB-05.4 / MOB-02 camera scanning. The component owns its camera session,
 * so stories render the states reachable without a device: the idle
 * viewfinder and the typed-ID fallback, which are the paths every surface
 * offers. The device states (`denied`, `unavailable`, `no-camera-api`,
 * `unsupported`) are only entered after a real `getUserMedia` attempt, so
 * they are reached by using the story rather than asserted here.
 */
function Harness({
  initialValue = '',
  busy = false,
}: {
  initialValue?: string
  busy?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <CameraScanner
      value={value}
      onValueChange={setValue}
      onScan={() => {}}
      busy={busy}
    />
  )
}

const meta = {
  title: 'Scan/Camera scanner',
  component: CameraScanner,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[420px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { value: '', onValueChange: () => {}, onScan: () => {} },
} satisfies Meta<typeof CameraScanner>
export default meta
type Story = StoryObj<typeof meta>

/** Camera off: “Start camera” plus the always-available typed ID. */
export const Default: Story = {}

/** A typed identifier, so “Find” is enabled. */
export const TypedIdentifier: Story = {
  render: () => <Harness initialValue="SMP-0001" />,
}

/** While the caller resolves a code the typed submit says “Finding…”. */
export const Resolving: Story = {
  render: () => <Harness initialValue="SMP-0001" busy />,
}

/** Callers place their own result panel between the viewfinder and the
 * fallback — the same slot the PhoneScan surface uses. */
export const WithResultPanel: Story = {
  render: () => (
    <CameraScanner value="" onValueChange={() => {}} onScan={() => {}}>
      <div className="rounded-md border border-dashed border-border p-3">
        <p className="text-xs font-medium text-fg">SMP-0001 · Human plasma</p>
        <p className="text-xs text-fg-muted">
          Last read by camera at 14:03 · 2.4 mL remaining
        </p>
      </div>
    </CameraScanner>
  ),
}

/** Narrow phone width: the fallback field and Find button stay usable. */
export const Narrow: Story = {
  render: () => (
    <div className="w-[320px]">
      <Harness initialValue="SMP-0001" />
    </div>
  ),
}
