import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Dot, Status } from '#/components/v3/ui/status'

/**
 * The scientific status vocabulary: colour sits in the dot, the text stays in
 * text colour, so a status is still readable in greyscale and in the dark theme.
 * `Status` is the dot plus its label; `Dot` is the dot alone, for a cell that
 * carries the word in a neighbouring column.
 */
const meta = {
  title: 'v3 kit/Status',
  component: Status,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { tone: 'ok', children: 'Available' },
} satisfies Meta<typeof Status>
export default meta
type Story = StoryObj<typeof meta>

const TONES = [
  'progress',
  'review',
  'ok',
  'warn',
  'bad',
  'draft',
  'stored',
  'none',
  'analysis',
] as const

/** Every tone the system defines, at the one size the vocabulary has. */
export const AllTones: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-body">
      {TONES.map((tone) => (
        <Status key={tone} tone={tone}>
          {tone}
        </Status>
      ))}
    </div>
  ),
}

/** The states a sample actually passes through, in the words the app uses. */
export const InUse: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-body">
      <Status tone="ok">Available</Status>
      <Status tone="progress">In use</Status>
      <Status tone="warn">Low stock</Status>
      <Status tone="bad">Quarantined</Status>
      <Status tone="stored">Archived</Status>
      <Status tone="draft">Not started</Status>
    </div>
  ),
}

/** The dot alone, beside a word held in its own column. */
export const DotAlone: Story = {
  render: () => (
    <table className="num text-body">
      <tbody>
        {(
          [
            ['DS-0311', 'Valid', 'ok'],
            ['DS-0310', 'Checked', 'review'],
            ['DS-0298', '—', 'none'],
          ] as const
        ).map(([id, label, tone]) => (
          <tr key={id}>
            <td className="py-1 pr-4 font-mono text-label">{id}</td>
            <td className="py-1">
              <Dot tone={tone} />
              <span className="ml-1.5">{label}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}
