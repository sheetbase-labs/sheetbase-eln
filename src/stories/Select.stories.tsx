import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Field } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'

/**
 * The v3 select is the native `<select>` styled like `Input`, so a story is
 * about what the platform already gives us: a labelled control, grouped
 * options, a disabled option, and a touch-friendly height below `md`.
 */
const meta = {
  title: 'UI/Select',
  component: Select,
  tags: ['autodocs'],
  args: { className: 'w-[260px]' },
} satisfies Meta<typeof Select>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Select {...args} aria-label="Compound" defaultValue="c">
      <option value="a">Compound A</option>
      <option value="b">Compound B</option>
      <option value="c">Reference standard</option>
    </Select>
  ),
}

/** `<optgroup>` labels and disabled options are the native element's own. */
export const GroupsAndDisabledOptions: Story = {
  render: (args) => (
    <Select {...args} aria-label="Unit" defaultValue="mg_per_ml">
      <optgroup label="Concentration">
        <option value="mg_per_ml">mg/mL</option>
        <option value="um">µM</option>
      </optgroup>
      <optgroup label="Mass">
        <option value="mg">mg</option>
        <option value="ug">µg</option>
      </optgroup>
      <option value="custom" disabled>
        Custom unit (set by the assay)
      </option>
    </Select>
  ),
}

/** `md` is the field size; `sm` is the toolbar size. Both grow on a phone. */
export const Sizes: Story = {
  render: () => (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <span className="w-24 text-label text-fg-muted">md · field</span>
        <Select className="w-[260px]" aria-label="Version" defaultValue="v2">
          <option value="v1">v1 · draft</option>
          <option value="v2">v2 · published</option>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 text-label text-fg-muted">sm · toolbar</span>
        <Select size="sm" aria-label="Operation" defaultValue="all">
          <option value="all">All operations</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
        </Select>
      </div>
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className="grid gap-4">
      <Select className="w-[260px]" aria-label="Status" defaultValue="">
        <option value="" disabled>
          Choose a status…
        </option>
        <option value="draft">Draft</option>
        <option value="approved">Approved</option>
      </Select>
      <Select
        className="w-[260px]"
        aria-label="Locked status"
        disabled
        defaultValue="locked"
      >
        <option value="locked">Locked — approved record</option>
      </Select>
      <Select
        className="w-[260px]"
        aria-label="Reviewer"
        invalid
        defaultValue=""
      >
        <option value="">Choose a reviewer…</option>
        <option value="gareth">Gareth Price</option>
      </Select>
    </div>
  ),
}

/** Wrap in `Field` and the control takes its name from the label. */
export const InField: Story = {
  render: () => (
    <Field
      label="Analytical method"
      hint="The method the certificate of analysis cites."
      required
      className="w-[320px]"
    >
      <Select aria-label="Analytical method" defaultValue="hplc">
        <option value="hplc">HPLC-UV</option>
        <option value="sec">SEC-MALS</option>
        <option value="elisa">ELISA</option>
      </Select>
    </Field>
  ),
}
