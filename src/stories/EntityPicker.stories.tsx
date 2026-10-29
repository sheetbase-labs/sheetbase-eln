import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  PickerMultiSelect,
  PickerSelect,
} from '#/components/v3/record-picker/entity-picker'
import type { PickerOption } from '#/components/v3/record-picker/entity-picker'
import { Field } from '#/components/v3/ui/input'

const stages = ['Discovery', 'Process development', 'Clinical supply']
const leads = ['Priya Nair', 'Tom Eriksen', 'Amara Okafor', 'Jonas Weber']
const clients = [
  'Internal',
  'AAV Vector Partners',
  'Helix Bio',
  'Northgate Therapeutics',
]
const names = [
  'Lentivector stability study',
  'AAV capsid screen',
  'Plasmid yield optimisation',
  'Cell line development',
  'Potency assay transfer',
  'Formulation robustness',
  'Downstream purification',
  'Viral clearance validation',
  'Reference standard qualification',
  'Mycoplasma method comparison',
  'Titre assay bridging',
  'Media screening DoE',
]
const projects: PickerOption[] = names.map((label, i) => ({
  id: `p${i}`,
  label,
  identifier: `PRJ-${String(i + 1).padStart(3, '0')}`,
  detail: `${leads[i % 4]} · ${clients[i % 4]}`,
  status:
    i % 5 === 4
      ? { tone: 'stored', label: 'Archived' }
      : i % 3 === 0
        ? { tone: 'progress', label: 'In progress' }
        : { tone: 'ok', label: 'Active' },
  facets: {
    stage: stages[i % 3],
    client: clients[i % 4],
    lead: leads[i % 4],
    modality: ['AAV', 'Lentivirus', 'Plasmid'][i % 3],
  },
  disabled: i % 5 === 4,
  disabledReason: i % 5 === 4 ? 'Archived' : undefined,
}))

function Demo() {
  const [project, setProject] = useState('p0')
  const [reviewer, setReviewer] = useState('')
  const [team, setTeam] = useState<string[]>(['p1', 'p2'])
  return (
    <div className="flex w-[420px] flex-col gap-3 p-6">
      <Field label="Project" required>
        <PickerSelect
          noun="project"
          value={project}
          onChange={setProject}
          options={projects}
          facets={[
            { key: 'stage', label: 'Stage' },
            { key: 'client', label: 'Client' },
          ]}
        />
      </Field>
      <Field label="Reviewer">
        <PickerSelect
          noun="person"
          value={reviewer}
          onChange={setReviewer}
          clearLabel="No reviewer yet"
          options={leads.map((l, i) => ({
            id: `u${i}`,
            label: l,
            detail: i % 2 ? 'Scientist' : 'Lab manager',
          }))}
        />
      </Field>
      <Field label="Related projects">
        <PickerMultiSelect
          noun="project"
          values={team}
          onChange={setTeam}
          options={projects}
        />
      </Field>
    </div>
  )
}
const meta = {
  title: 'Pickers/EntityPicker',
  component: Demo,
} satisfies Meta<typeof Demo>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
