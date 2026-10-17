import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Diff, Source } from '#/components/v3/ui/source'

/**
 * Two marks a sheet needs: where a column's values come from (`Source`), and
 * what one value was before an edit (`Diff`). Both are inline marks sized to sit
 * inside a table cell, not controls.
 */
const meta = {
  title: 'v3 kit/Source',
  component: Source,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { kind: 'dataset', children: 'Dataset · DS-0311' },
} satisfies Meta<typeof Source>
export default meta
type Story = StoryObj<typeof meta>

/** The four kinds, on the header line they annotate. */
export const Kinds: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Source kind="dataset">Dataset · DS-0311</Source>
      <Source kind="record">Record · EXP-0142</Source>
      <Source kind="calc">Calculated</Source>
      <Source kind="local">Local override</Source>
    </div>
  ),
}

/**
 * In place: a column header carries its source under the label, which is how a
 * reader knows a number was computed rather than read.
 */
export const InAHeader: Story = {
  render: () => (
    <table className="num w-[420px] text-body">
      <thead>
        <tr className="bg-surface-muted text-label text-fg-muted">
          <th className="px-3 py-1.5 text-left font-medium">
            <span className="block">Load</span>
            <Source kind="dataset">DS-0311</Source>
          </th>
          <th className="px-3 py-1.5 text-left font-medium">
            <span className="block">Step yield</span>
            <Source kind="calc">Calculated</Source>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="px-3 py-1">142</td>
          <td className="px-3 py-1">75.6 %</td>
        </tr>
      </tbody>
    </table>
  ),
}

/** An edit: what the value was, then what it is. */
export const DiffPair: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-body">
      <p>
        Titre <Diff before="412" after="418" />
      </p>
      <p>
        Viability <Diff before="96 %" after="97.4 %" />
      </p>
    </div>
  ),
}

/** An added value has no before, so only the insertion is drawn. */
export const AddedValue: Story = {
  render: () => (
    <p className="text-body">
      Note <Diff after="Reproduced 18 Oct" />
    </p>
  ),
}
