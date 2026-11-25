import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { TypedTextEditorCell } from '#/components/sheet/typed-text-editor'
import { formatDuration, parseDuration } from '#/lib/time-duration'

/**
 * The in-cell editor a duration column opens: the stored seconds show as
 * `2 h 30 min`, and what is typed is read back into seconds on commit.
 */
function Harness({ seconds }: { seconds: number }) {
  const [stored, setStored] = useState(seconds)
  const [outcome, setOutcome] = useState('Editing…')

  return (
    <div className="w-[320px] space-y-2">
      <div className="rounded-md border border-border p-2">
        <TypedTextEditorCell
          label="Spin time"
          initialDraft={formatDuration(stored)}
          commit={(value) => {
            const next = parseDuration(value)

            if (next === null) {
              setOutcome(`Refused: ${value}`)

              return
            }

            setStored(next)
            setOutcome(`Stored ${next} s (${formatDuration(next)})`)
          }}
          cancel={() => setOutcome('Cancelled — nothing written')}
        />
      </div>
      <p className="text-xs text-fg-muted" role="status">
        {outcome}
      </p>
    </div>
  )
}

const meta = {
  title: 'Sheet/Typed text editor cell',
  component: TypedTextEditorCell,
  tags: ['autodocs'],
  args: {
    label: 'Spin time',
    initialDraft: '10 min',
    commit: () => {},
    cancel: () => {},
  },
} satisfies Meta<typeof TypedTextEditorCell>

export default meta

type Story = StoryObj<typeof meta>

/** A stored 9000 s opens as 2 h 30 min. */
export const Duration: Story = {
  render: () => <Harness seconds={9000} />,
}

/** A short spin, in seconds. */
export const Seconds: Story = {
  render: () => <Harness seconds={45} />,
}
