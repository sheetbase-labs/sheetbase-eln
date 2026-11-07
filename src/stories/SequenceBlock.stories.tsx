import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useState } from 'react'

import { SequencePreview } from '#/components/notebook/sequence-block'
import { Chromatogram } from '#/components/sequence/workbench/chromatogram'
import { CloningTab } from '#/components/sequence/workbench/cloning-tab'
import { CodonsTab } from '#/components/sequence/workbench/codons-tab'
import { DigestTab } from '#/components/sequence/workbench/digest-tab'
import { EditTab } from '#/components/sequence/workbench/edit-tab'
import { EnzymePicker } from '#/components/sequence/workbench/enzyme-picker'
import { EnzymesTab } from '#/components/sequence/workbench/enzymes-tab'
import { Gel } from '#/components/sequence/workbench/gel'
import { GuidesTab } from '#/components/sequence/workbench/guides-tab'
import { PrimersTab } from '#/components/sequence/workbench/primers-tab'
import { ReadsTab } from '#/components/sequence/workbench/reads-tab'
import { SiteMap } from '#/components/sequence/workbench/site-map'
import type { WorkbenchProps } from '#/components/sequence/workbench/shared'
import { autoAnnotate } from '#/lib/molbio'
import type { SequenceBlockPayload } from '#/lib/sequence-block'

import { screenQueryClient } from './screen-stories'

/**
 * The sequence block of a notebook (`sequence-block.tsx`) and the tools it
 * opens: the map, editing, restriction enzymes, a digest with its gel, primer
 * design, cloning plans and Sanger reads. The sequence here is made up; nothing
 * is saved and no file is read.
 */
const client = screenQueryClient()

function randomDna(n: number): string {
  let x = 7
  let out = ''
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out += 'ACGT'[(x >> 16) & 3]
  }
  return out
}

const residues =
  'GAATTC' +
  randomDna(300) +
  'AAGCTT' +
  randomDna(400) +
  'GGATCC' +
  randomDna(300) +
  'CTGCAG' +
  randomDna(200)

const base: SequenceBlockPayload = {
  title: 'Backbone check',
  name: 'pExample',
  molecule: 'dna',
  topology: 'circular',
  residues,
  features: autoAnnotate(residues, 'circular', []).map((f, i) => ({
    ...f,
    id: i + 1,
  })),
  caption: 'A made-up plasmid for the stories.',
}

function Workbench({
  tool,
  payload = base,
}: {
  tool: (props: WorkbenchProps) => React.ReactNode
  payload?: SequenceBlockPayload
}) {
  const [draft, setDraft] = useState(payload)
  return (
    <QueryClientProvider client={client}>
      <div className="w-[860px] max-w-full">
        {tool({
          draft,
          edit: (change) => setDraft((current) => change(current)),
          canEdit: true,
          recordId: 'r1',
          blockId: 'b1',
        })}
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Notebook/Sequence block',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const AsRead: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <div className="w-[860px] max-w-full">
        <SequencePreview payload={base} recordId="r1" blockId="b1" />
      </div>
    </QueryClientProvider>
  ),
}

export const EmptyBlock: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <div className="w-[860px] max-w-full">
        <SequencePreview payload={{}} />
      </div>
    </QueryClientProvider>
  ),
}

export const EditBases: Story = {
  render: () => <Workbench tool={(p) => <EditTab {...p} />} />,
}

export const RestrictionEnzymes: Story = {
  render: () => <Workbench tool={(p) => <EnzymesTab {...p} />} />,
}

export const DigestAndGel: Story = {
  render: () => (
    <Workbench
      tool={(p) => <DigestTab {...p} />}
      payload={{
        ...base,
        digests: [{ enzymes: ['EcoRI', 'PstI'], ladder: '1kb' }],
      }}
    />
  ),
}

export const DesignPrimers: Story = {
  render: () => <Workbench tool={(p) => <PrimersTab {...p} />} />,
}

export const CloningPlans: Story = {
  render: () => <Workbench tool={(p) => <CloningTab {...p} />} />,
}

export const CrisprGuides: Story = {
  render: () => <Workbench tool={(p) => <GuidesTab {...p} />} />,
}

export const OptimiseCodons: Story = {
  render: () => <Workbench tool={(p) => <CodonsTab {...p} />} />,
}

export const SangerReads: Story = {
  render: () => <Workbench tool={(p) => <ReadsTab {...p} />} />,
}

export const PickEnzymes: Story = {
  render: () => {
    const [chosen, setChosen] = useState<string[]>(['EcoRI'])
    return (
      <QueryClientProvider client={client}>
        <div className="w-[640px] max-w-full">
          <EnzymePicker
            selected={chosen}
            onChange={setChosen}
            uniqueCutters={['EcoRI', 'PstI']}
          />
        </div>
      </QueryClientProvider>
    )
  },
}

export const GelWithTwoDigests: Story = {
  render: () => (
    <Gel
      ladder="1kb"
      lanes={[
        { label: 'Uncut', sizes: [3200] },
        { label: 'EcoRI + PstI', sizes: [2100, 1100] },
      ]}
    />
  ),
}

export const RestrictionMap: Story = {
  render: () => (
    <div className="w-[560px] max-w-full">
      <SiteMap
        length={residues.length}
        topology="circular"
        name="pExample"
        sites={[
          { enzyme: 'EcoRI', position: 0, unique: true },
          { enzyme: 'HindIII', position: 306, unique: true },
        ]}
      />
    </div>
  ),
}

/** No trace file is chosen, so there is nothing to draw. */
export const TraceWithoutFile: Story = {
  render: () => <Chromatogram fileRecordId={undefined} />,
}
