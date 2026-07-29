import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#/components/ui/field'
import { Input } from '#/components/ui/input'

const meta = {
  title: 'UI/Field',
  component: Field,
  tags: ['autodocs'],
} satisfies Meta<typeof Field>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Field className="max-w-sm">
      <FieldLabel htmlFor="sample">Sample name</FieldLabel>
      <Input id="sample" placeholder="e.g. Control A" />
      <FieldDescription>Use a unique, descriptive name.</FieldDescription>
    </Field>
  ),
}
export const ErrorState: Story = {
  render: () => (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel htmlFor="volume">Volume</FieldLabel>
        <Input id="volume" aria-invalid="true" defaultValue="-2" />
        <FieldError>Volume must be greater than zero.</FieldError>
      </Field>
    </FieldGroup>
  ),
}
