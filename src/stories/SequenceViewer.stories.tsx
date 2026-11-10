import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CircularMap, LinearMap } from '#/components/sequence/sequence-map'
import { SequencePanel } from '#/components/sequence/sequence-panel'
import {
  SequenceFileViewer,
  SequenceViewer,
} from '#/components/sequence/sequence-viewer'
import { linkedSequencesKey } from '#/components/sequence/use-linked-sequences'
import { parseFasta } from '#/lib/sequence'

import { holdRead, screenQueryClient } from './screen-stories'
import { plasmid } from './sequence-fixtures'

/**
 * Sequence viewing: the plasmid map, the linear map, the viewer that adds the
 * feature list and bases, and the panel that lists a record's sequence files.
 * The sequence is parsed from GenBank text, and the file reads are seeded, so
 * nothing is downloaded.
 */
const FILE_ID = 'file-1'
const RECORD_ID = 'record-1'

const summary = {
  name: 'pDEMO-GFP',
  molecule: 'dna',
  topology: 'circular',
  length: 600,
  featureCount: 4,
  gc: 51.2,
} as const

const loaded = screenQueryClient({
  data: [
    { key: ['ui-port', 'sequence-file', FILE_ID], value: plasmid },
    {
      key: linkedSequencesKey(RECORD_ID),
      value: [
        {
          fileRecordId: FILE_ID,
          name: 'pDEMO-GFP.gb',
          summary,
          addedAt: '2026-10-18T09:00:00Z',
        },
      ],
    },
  ],
})

const empty = screenQueryClient({
  data: [{ key: linkedSequencesKey(RECORD_ID), value: [] }],
})

const pending = screenQueryClient()

holdRead(pending, ['ui-port', 'sequence-file', 'file-9'])

const meta = {
  title: 'Sequences/Sequence viewer',
  tags: ['autodocs'],
  parameters: { client: pending },
  decorators: [
    (Story) => (
      <QueryClientProvider client={pending}>
        <div className="w-[760px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/** The plasmid map: the sequence as a ring with its features on it. */
export const Circular: Story = {
  render: () => {
    const [selected, setSelected] = useState<number | null>(null)

    return (
      <CircularMap
        sequence={plasmid[0]}
        selectedId={selected}
        onSelect={setSelected}
        className="mx-auto max-w-md"
      />
    )
  },
}

/** A stretch of the sequence with a ruler. */
export const Linear: Story = {
  render: () => {
    const [selected, setSelected] = useState<number | null>(2)

    return (
      <LinearMap
        sequence={plasmid[0]}
        selectedId={selected}
        onSelect={setSelected}
        from={1}
        to={600}
      />
    )
  },
}

/** Map, feature list and bases of one parsed sequence. */
export const Viewer: Story = {
  render: () => <SequenceViewer sequences={plasmid} />,
}

/** A FASTA record has bases and no features. */
export const FastaOnly: Story = {
  render: () => (
    <SequenceViewer
      sequences={parseFasta(
        '>primer-fwd Forward primer\nATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTT\n',
      )}
    />
  ),
}

/** A stored file, read and shown. */
export const File: Story = {
  parameters: { client: loaded },
  render: () => <SequenceFileViewer fileRecordId={FILE_ID} />,
}

/** A stored file still being read. */
export const FileLoading: Story = {
  parameters: { client: pending },
  render: () => <SequenceFileViewer fileRecordId="file-9" />,
}

/** A record's sequence files, with the first one open. */
export const Panel: Story = {
  parameters: { client: loaded },
  render: () => (
    <SequencePanel recordId={RECORD_ID} projectId="project-1" canEdit />
  ),
}

/** A record with no sequence files yet. */
export const PanelEmpty: Story = {
  parameters: { client: empty },
  render: () => (
    <SequencePanel recordId={RECORD_ID} projectId="project-1" canEdit />
  ),
}

/** The panel for someone who can only read. */
export const PanelReadOnly: Story = {
  parameters: { client: loaded },
  render: () => (
    <SequencePanel recordId={RECORD_ID} projectId="project-1" canEdit={false} />
  ),
}
