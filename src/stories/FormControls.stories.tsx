import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Bold, Italic } from 'lucide-react'
import {
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  Slider,
  Switch,
  Textarea,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from '#/components/ui'

const meta = {
  title: 'UI/Form controls',
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const CompleteForm: Story = {
  render: () => (
    <FieldGroup className="max-w-lg">
      <Field>
        <FieldLabel htmlFor="sample">Sample identifier</FieldLabel>
        <Input id="sample" defaultValue="SMP-2026-0142" />
        <FieldDescription>
          Unique identifier from the sample registry.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="notes">Observation</FieldLabel>
        <Textarea id="notes" defaultValue="Pellet resuspended in 500 µL PBS." />
      </Field>
      <Field>
        <FieldLabel htmlFor="assay">Assay</FieldLabel>
        <Select id="assay" defaultValue="qpcr">
          <option value="qpcr">qPCR</option>
          <option value="elisa">ELISA</option>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="bad">Concentration</FieldLabel>
        <Input id="bad" aria-invalid defaultValue="-2" />
        <FieldError>Concentration must be positive.</FieldError>
      </Field>
    </FieldGroup>
  ),
}
export const SelectionControls: Story = {
  render: () => (
    <div className="space-y-5">
      <Label className="flex gap-2">
        <Checkbox defaultChecked /> Include technical replicates
      </Label>
      <Label className="flex gap-2">
        <Switch defaultChecked /> Auto-save measurements
      </Label>
      <RadioGroup defaultValue="ng">
        <Label className="flex gap-2">
          <RadioGroupItem value="ng" />
          ng/µL
        </Label>
        <Label className="flex gap-2">
          <RadioGroupItem value="um" />
          µM
        </Label>
      </RadioGroup>
      <div>
        <Label>Confidence threshold</Label>
        <Slider className="mt-3 max-w-sm" defaultValue={[85]} max={100} />
      </div>
    </div>
  ),
}
export const Toggles: Story = {
  render: () => (
    <div className="flex gap-4">
      <Toggle aria-label="Bold">
        <Bold />
      </Toggle>
      <ToggleGroup type="multiple" variant="outline">
        <ToggleGroupItem value="bold">
          <Bold />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic">
          <Italic />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  ),
}
export const Disabled: Story = {
  render: () => (
    <div className="space-y-3 max-w-sm">
      <Input disabled value="Locked revision" readOnly />
      <Textarea disabled value="Editing disabled during review" />
      <Switch disabled />
      <Checkbox disabled />
    </div>
  ),
}
