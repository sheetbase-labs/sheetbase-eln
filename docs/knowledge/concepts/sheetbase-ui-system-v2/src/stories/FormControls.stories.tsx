import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import { Slider } from '#/components/ui/slider'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'

const meta = { title: 'UI/Form controls', tags: ['autodocs'] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Catalogue: Story = { render: () => <div className='grid w-[520px] gap-6'>
  <FieldGroup>
    <Field><FieldLabel>Experiment title</FieldLabel><Input defaultValue='Virus Stability at 4 °C'/><FieldDescription>Visible throughout the workspace.</FieldDescription></Field>
    <Field><FieldLabel>Objective</FieldLabel><Textarea defaultValue='Evaluate stability over 28 days.'/></Field>
    <Field><FieldLabel>Assay type</FieldLabel><Select defaultValue='qpcr'><SelectTrigger><SelectValue placeholder='Select assay'/></SelectTrigger><SelectContent><SelectItem value='qpcr'>qPCR</SelectItem><SelectItem value='elisa'>ELISA</SelectItem><SelectItem value='flow'>Flow cytometry</SelectItem></SelectContent></Select></Field>
    <Field><FieldLabel>Validation state</FieldLabel><RadioGroup defaultValue='validated'><div className='flex items-center gap-2'><RadioGroupItem value='draft' id='draft'/><Label htmlFor='draft'>Draft</Label></div><div className='flex items-center gap-2'><RadioGroupItem value='validated' id='validated'/><Label htmlFor='validated'>Validated</Label></div></RadioGroup></Field>
    <Field><FieldLabel>Confidence threshold</FieldLabel><Slider defaultValue={[72]} max={100}/></Field>
    <div className='flex items-center gap-6'><div className='flex items-center gap-2'><Checkbox id='audit' defaultChecked/><Label htmlFor='audit'>Require audit trail</Label></div><div className='flex items-center gap-2'><Switch id='notify' defaultChecked/><Label htmlFor='notify'>Notifications</Label></div></div>
    <Field><FieldLabel>Invalid example</FieldLabel><Input aria-invalid defaultValue='Missing lot number'/><FieldError>A lot number is required.</FieldError></Field>
  </FieldGroup>
</div> }
