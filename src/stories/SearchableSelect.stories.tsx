import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { Field } from '#/components/ui/input'

const events = [
  ['Samples', 'A sample is received'],
  ['Samples', 'A sample is moved'],
  ['Samples', 'A sample is released'],
  ['Bookings', 'A booking is made'],
  ['Bookings', 'A booking is cancelled'],
  ['Data imports', 'A data import is committed'],
  ['Data imports', 'A data import fails'],
] as const

function Demo() {
  const [event, setEvent] = useState('A sample is moved')
  const [project, setProject] = useState('')

  return (
    <div className="flex w-[420px] flex-col gap-3 p-6">
      <Field label="When">
        <SearchableSelect noun="event" value={event} onValueChange={setEvent}>
          {['Samples', 'Bookings', 'Data imports'].map((group) => (
            <optgroup key={group} label={group}>
              {events.flatMap(([area, label]) =>
                area === group
                  ? [
                      <option key={label} value={label}>
                        {label}
                      </option>,
                    ]
                  : [],
              )}
            </optgroup>
          ))}
        </SearchableSelect>
      </Field>
      <Field label="Project">
        <SearchableSelect
          noun="project"
          value={project}
          onValueChange={setProject}
        >
          <option value="">Any project</option>
          <option value="aav">AAV9 process transfer</option>
          <option value="lvv">LVV stability</option>
        </SearchableSelect>
      </Field>
    </div>
  )
}

const meta = {
  title: 'Pickers/SearchableSelect',
  component: Demo,
} satisfies Meta<typeof Demo>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
