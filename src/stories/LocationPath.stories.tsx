import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LocationPath } from '#/components/ui/location-path'

/**
 * A storage location in a table cell. A long path keeps its most specific
 * places, which is what someone fetching a tube reads first; the full path is
 * the tooltip and what a screen reader hears. A short location shows as it is.
 */
const meta = {
  title: 'UI/LocationPath',
  component: LocationPath,
  tags: ['autodocs'],
} satisfies Meta<typeof LocationPath>

export default meta

type Story = StoryObj<typeof meta>

const FULL =
  'Cambridge site / Cold room 1 / Freezer FZ-80-01 / Shelf 2 / Rack 3 / BX-LVV-07 / A2'

export const LongPath: Story = { args: { path: FULL } }

/** A storage category rather than a place: shown unchanged. */
export const ShortLocation: Story = { args: { path: '-80 °C' } }

/** The phone list's narrower form keeps two places. */
export const TwoPlaces: Story = { args: { path: FULL, keep: 2 } }

/** As it sits in the Samples table, beside the Status column it keeps on screen. */
export const InATableRow: Story = {
  args: { path: FULL },
  render: (args) => (
    <table className="text-body">
      <tbody>
        <tr>
          <td className="pr-6 font-mono">SMP-2025-0021</td>
          <td className="pr-6">LVV-CAR-T stability pull</td>
          <td className="pr-6">
            <LocationPath {...args} />
          </td>
          <td>Stored</td>
        </tr>
      </tbody>
    </table>
  ),
}
