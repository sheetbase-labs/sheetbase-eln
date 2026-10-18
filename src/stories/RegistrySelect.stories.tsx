import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '#/components/reui/native-select'

/**
 * The stock shadcn `native-select` item, placed here by hand as the candidate
 * for the option-picker pair. It is stock shadcn, not a ReUI item: the pinned
 * registry serves neither `native-select` nor `select`.
 *
 * Row 18 of `docs/knowledge/design/component-comparison-record.md` kept ours and
 * declined the install: both are the same platform `<select>`, so the same eight
 * of ten checklist items pass and the same two are the measured gaps, and the
 * item's own additions — an option/optgroup wrapper, a disabled-opacity rule, a
 * Lucide chevron and a fixed pair of sizes — change nothing behaviourally. The
 * story stays so the declined candidate is reviewable in the repository.
 */
const meta = {
  title: 'UI/Registry select',
  component: NativeSelect,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'default'] },
  },
} satisfies Meta<typeof NativeSelect>
export default meta
type Story = StoryObj<typeof meta>

/** The default: the platform popup, with the item's own chevron. */
export const Default: Story = {
  render: (args) => (
    <NativeSelect {...args} aria-label="Rounding mode">
      <NativeSelectOption value="none">No rounding</NativeSelectOption>
      <NativeSelectOption value="sig">Significant figures</NativeSelectOption>
      <NativeSelectOption value="decimal">Decimal places</NativeSelectOption>
    </NativeSelect>
  ),
}

/** The item's two sizes, which do not grow on a phone the way ours do. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <NativeSelect size="sm" aria-label="Small">
        <NativeSelectOption value="a">Small · 32px</NativeSelectOption>
      </NativeSelect>
      <NativeSelect size="default" aria-label="Default">
        <NativeSelectOption value="a">Default · 36px</NativeSelectOption>
      </NativeSelect>
    </div>
  ),
}

/** Grouped options, for a list with sections. */
export const GroupedOptions: Story = {
  render: () => (
    <NativeSelect defaultValue="exp-0142" aria-label="Record">
      <NativeSelectOptGroup label="Experiments">
        <NativeSelectOption value="exp-0142">EXP-0142</NativeSelectOption>
        <NativeSelectOption value="exp-0140">EXP-0140</NativeSelectOption>
      </NativeSelectOptGroup>
      <NativeSelectOptGroup label="Datasets">
        <NativeSelectOption value="ds-0311">DS-0311</NativeSelectOption>
        <NativeSelectOption value="ds-0310">DS-0310</NativeSelectOption>
      </NativeSelectOptGroup>
    </NativeSelect>
  ),
}

/** Disabled, which is where the item's own opacity rule shows. */
export const Disabled: Story = {
  render: () => (
    <NativeSelect disabled aria-label="Rounding mode">
      <NativeSelectOption value="none">No rounding</NativeSelectOption>
    </NativeSelect>
  ),
}

/** A call that failed marks the control invalid, as ours does. */
export const Invalid: Story = {
  render: () => (
    <NativeSelect aria-invalid aria-label="Rounding mode">
      <NativeSelectOption value="none">Choose a mode</NativeSelectOption>
    </NativeSelect>
  ),
}
