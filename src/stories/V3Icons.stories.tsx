import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Icon, iconNames } from '#/components/v3/icons'

/**
 * The forward kit's icon set: 16px grid, 1.4px stroke, `currentColor`. Every
 * glyph is a path in one map, so the set is enumerable — the story below renders
 * `iconNames` in full, which is what makes a missing or duplicated glyph visible.
 *
 * `Icons.stories.tsx` (`UI/Icon`) covers `src/components/icons/index.tsx`, the
 * older set found in the design bundle with `ICON_PATHS` and
 * `dangerouslySetInnerHTML`. This is the one the forward kit composes, and the
 * one the app's screens import.
 */
const meta = {
  title: 'v3 kit/Icon',
  component: Icon,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { name: 'flask' },
} satisfies Meta<typeof Icon>
export default meta
type Story = StoryObj<typeof meta>

/** The whole set, each glyph with its name. */
export const Set: Story = {
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
      {iconNames.map((name) => (
        <div
          key={name}
          className="flex flex-col items-center gap-1 rounded-md border border-border px-2 py-3 text-fg-muted"
        >
          <Icon name={name} size={20} />
          <span className="truncate text-caption" title={name}>
            {name}
          </span>
        </div>
      ))}
    </div>
  ),
}

/** The sizes the kit uses: 10px inside a status, 14px in a row, 20px in a figure. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-5 text-fg">
      {[10, 12, 14, 16, 20, 24].map((size) => (
        <div key={size} className="flex flex-col items-center gap-1">
          <Icon name="flask" size={size} />
          <span className="num text-caption text-fg-muted">{size}</span>
        </div>
      ))}
    </div>
  ),
}

/**
 * The stroke the two jobs in the kit ask for: the design's 1.4px at body size,
 * and 2px where a glyph has to stay legible at 12px inside a checkbox.
 */
export const Stroke: Story = {
  render: () => (
    <div className="flex items-center gap-5 text-fg">
      <span className="flex items-center gap-2 text-body">
        <Icon name="check" size={12} strokeWidth={2} /> 2px at 12px
      </span>
      <span className="flex items-center gap-2 text-body">
        <Icon name="check" size={16} /> 1.4px at 16px
      </span>
    </div>
  ),
}

/** Colour comes from the surrounding text, never from the icon itself. */
export const InheritsColour: Story = {
  render: () => (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-body text-fg-muted">
        <Icon name="clock" size={14} /> Deleted 10:12:42
      </span>
      <span className="flex items-center gap-2 text-body text-danger-text">
        <Icon name="warn" size={14} /> Step 3 did not converge
      </span>
      <span className="flex items-center gap-2 text-body text-link">
        <Icon name="download" size={14} /> Download the sheet
      </span>
    </div>
  ),
}
