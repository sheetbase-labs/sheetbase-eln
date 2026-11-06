import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  ReactionPreview,
  StructurePreview,
} from '#/components/notebook/chemistry-block'

/**
 * The structure and reaction blocks of a notebook (`chemistry-block.tsx`):
 * a drawn molecule with its formula and weight, and a reaction with the table
 * of amounts worked out from what was typed.
 */
const meta = {
  title: 'Notebook/Chemistry blocks',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const molfile = `
  Sheetbase

  3  2  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.5980    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  2  3  1  0  0  0  0
M  END
`

export const Structure: Story = {
  render: () => (
    <div className="max-w-xl">
      <StructurePreview
        payload={{
          title: 'Target: ethanol',
          name: 'Ethanol',
          molfile,
          formula: 'C2H6O',
          mw: 46.069,
          smiles: 'CCO',
          caption: 'The compound this batch is aiming for.',
        }}
      />
    </div>
  ),
}

export const StructureNotDrawn: Story = {
  render: () => (
    <div className="max-w-xl">
      <StructurePreview payload={{ molfile: '' }} />
    </div>
  ),
}

export const ReactionWithTable: Story = {
  render: () => (
    <div className="max-w-4xl">
      <ReactionPreview
        payload={{
          title: 'Acetylation of salicylic acid',
          drawing: '',
          rows: [
            {
              id: 'r1',
              role: 'reactant',
              name: 'Salicylic acid',
              formula: 'C7H6O3',
              mw: 138.12,
              massMg: 1000,
            },
            {
              id: 'r2',
              role: 'reactant',
              name: 'Acetic anhydride',
              mw: 102.09,
              equiv: 1.5,
              density: 1.08,
            },
            {
              id: 'r3',
              role: 'product',
              name: 'Aspirin',
              mw: 180.16,
              massMg: 900,
            },
          ],
          caption: 'Heated to 70 °C for 15 minutes.',
        }}
      />
    </div>
  ),
}
