import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Checkbox } from '#/components/v3/ui/checkbox'

/**
 * The forward kit's checkbox (`src/components/v3/ui/checkbox.tsx`), built on
 * Base UI. It renders a real `<button>`, not Base UI's default `<span>`, so the
 * `<label>` every call site wraps it in names the control and clicking that
 * label's text activates it.
 *
 * The legacy `UI/Checkbox` story in `Checkbox.stories.tsx` is the same-named
 * Radix twin being removed, not this component.
 */
const meta = {
  title: 'v3 kit/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
} satisfies Meta<typeof Checkbox>
export default meta
type Story = StoryObj<typeof meta>

const label = (text: string, control: React.ReactNode) => (
  <label className="flex cursor-pointer items-center gap-2 text-body">
    {control}
    {text}
  </label>
)

/** Unchecked, named by the label beside it. */
export const Default: Story = {
  render: () => label('Include archived samples', <Checkbox />),
}

/** Checked, the state a set property renders. */
export const Checked: Story = {
  render: () => label('Glucose', <Checkbox defaultChecked />),
}

/**
 * The mixed state. Measured in Chromium, this is a defect rather than a third
 * glyph: the control reports `aria-checked="mixed"` and `data-indeterminate`,
 * but the root keeps `bg-surface` while the indicator's tick inherits
 * `text-on-accent`, so a white tick sits on a white box and nothing is visible.
 * Only `data-checked` fills the box. Fixing the appearance is a design decision
 * (a filled box, or a dash in ink colour) and is not this lane's change; the
 * story is here so the state is reviewable.
 */
export const Indeterminate: Story = {
  render: () => label('7 of 12 runs selected', <Checkbox indeterminate />),
}

/**
 * Disabled, in both states. A reader still needs to see what is set, so the
 * checked-and-disabled pair keeps the checked fill.
 */
export const Disabled: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {label('Pending review', <Checkbox disabled />)}
      {label('Locked after signature', <Checkbox defaultChecked disabled />)}
    </div>
  ),
}

/** Controlled, for the header, row and filter cases that own the state. */
export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = useState(true)
    return (
      <div className="flex flex-col gap-2">
        {label(
          'Pin this model version',
          <Checkbox checked={checked} onCheckedChange={setChecked} />,
        )}
        <p className="num text-label text-fg-muted" role="status">
          {checked ? 'Pinned' : 'Not pinned'}
        </p>
      </div>
    )
  },
}
