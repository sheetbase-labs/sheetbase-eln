import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'

const meta = {
  title: 'UI/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
} satisfies Meta<typeof RadioGroup>
export default meta
type Story = StoryObj<typeof meta>
const Choice = ({
  value,
  label,
  disabled = false,
}: {
  value: string
  label: string
  disabled?: boolean
}) => (
  <div className="flex items-center gap-2">
    <RadioGroupItem value={value} id={value} disabled={disabled} />
    <Label htmlFor={value}>{label}</Label>
  </div>
)
export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="draft">
      <Choice value="draft" label="Draft" />
      <Choice value="review" label="Under review" />
      <Choice value="approved" label="Approved" />
    </RadioGroup>
  ),
}
export const WithDisabledOption: Story = {
  render: () => (
    <RadioGroup defaultValue="standard">
      <Choice value="standard" label="Standard" />
      <Choice value="regulated" label="Regulated" disabled />
    </RadioGroup>
  ),
}
