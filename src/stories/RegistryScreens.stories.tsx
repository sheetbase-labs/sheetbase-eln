import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  DuplicateNotice,
  SequenceReader,
} from '#/components/registry/registry-form'
import type { ReadSequence } from '#/components/registry/registry-form'
import {
  RegistryLineage,
  RegistryRetireButton,
} from '#/components/registry/registry-lineage'
import { RegistryList } from '#/components/registry/registry-list'
import { RegistrySettingsDialog } from '#/components/registry/registry-settings'
import { recordModelQueryKeys } from '#/components/models/models-data'
import { registryKeys } from '#/lib/bio-registry'
import type {
  DuplicateMatch,
  LineageLink,
  RegistryEntry,
  RegistryModel,
} from '#/lib/bio-registry'
import { screenQueryClient, screenRoutes } from './screen-stories'
import { cellBankModel, modelField } from './model-fixtures'

/**
 * The registry screens (`src/components/registry/`): the list of entries
 * across every registry model, an entry's lineage, the retire action, the
 * duplicate warning and sequence reader on the new-entry form, and the
 * dialog that makes a model a registry. A registry is a record model with a
 * tick box, so the fixtures are ordinary models and records.
 */
const models: RegistryModel[] = [
  {
    id: 'm-construct',
    key: 'construct',
    name: 'Construct',
    identifier_prefix: 'CON',
    registry_key_fields: ['name'],
    registry_sequence_field: 'sequence',
    registry_structure_field: null,
    registry_lot_kind: null,
  },
  {
    id: 'm-cell-line',
    key: 'cell_line',
    name: 'Cell line',
    identifier_prefix: 'CL',
    registry_key_fields: ['name', 'species'],
    registry_sequence_field: null,
    registry_structure_field: null,
    registry_lot_kind: null,
  },
]

const entry = (
  id: string,
  identifier: string,
  title: string,
  kind: string,
  extra: Partial<RegistryEntry> = {},
): RegistryEntry => ({
  id,
  identifier,
  title,
  kind,
  custom_fields: {},
  created_at: '2026-09-10T09:00:00.000Z',
  archived_at: null,
  metadata_version: 1,
  ...extra,
})

const entries: RegistryEntry[] = [
  entry('e1', 'CON-0001', 'pUC19 backbone', 'construct'),
  entry('e2', 'CON-0002', 'pLVX-GFP', 'construct'),
  entry('e3', 'CON-0003', 'pLVX-GFP-HA', 'construct'),
  entry('e4', 'CL-0001', 'HEK293T', 'cell_line'),
  entry('e5', 'CL-0002', 'HEK293T-GFP', 'cell_line', {
    archived_at: '2026-09-20T09:00:00.000Z',
  }),
]

const links: LineageLink[] = [
  { entry_id: 'e2', parent_id: 'e1', role: 'backbone' },
  { entry_id: 'e3', parent_id: 'e2', role: 'parent' },
  { entry_id: 'e5', parent_id: 'e4', role: 'transfected_with' },
]

const client = screenQueryClient({
  data: [
    { key: registryKeys.models, value: models },
    {
      key: registryKeys.entries(models.map((m) => m.key)),
      value: entries,
    },
    { key: [...registryKeys.lineage, entries.length], value: links },
  ],
})
const emptyClient = screenQueryClient({
  data: [
    { key: registryKeys.models, value: [] },
    { key: registryKeys.entries([]), value: [] },
  ],
})
const settingsClient = screenQueryClient({
  data: [
    {
      key: [...recordModelQueryKeys.fields('cell_bank'), 'current'],
      value: [
        modelField('cell_bank', 'name', 'Name', { nullable: false }),
        modelField('cell_bank', 'species', 'Species'),
        modelField('cell_bank', 'sequence', 'Sequence'),
      ],
    },
  ],
})

const meta = {
  title: 'Registry/Screens',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/registry', [
          '/models/$modelId/records/$recordId',
          '/models/$modelId/records/new',
        ]),
        path: '/registry',
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** The registry list: a tab of filters, entries with their parents, retired ones muted. */
export const List: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <div className="flex h-[480px] w-[1000px] max-w-full flex-col">
        <RegistryList canWrite canEditModels />
      </div>
    </QueryClientProvider>
  ),
}

/** No registry set up yet: the empty page offers the starter registries. */
export const ListEmpty: Story = {
  render: () => (
    <QueryClientProvider client={emptyClient}>
      <div className="flex h-[420px] w-[1000px] max-w-full flex-col">
        <RegistryList canWrite canEditModels />
      </div>
    </QueryClientProvider>
  ),
}

/** A viewer sees the entries with no register action. */
export const ListReadOnly: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <div className="flex h-[480px] w-[1000px] max-w-full flex-col">
        <RegistryList canWrite={false} canEditModels={false} />
      </div>
    </QueryClientProvider>
  ),
}

/** An entry's lineage: what it came from and what was made from it. */
export const Lineage: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <QueryClientProvider client={client}>
      <div className="w-[560px] max-w-full">
        <RegistryLineage entryId="e2" identifier="CON-0002" canWrite />
      </div>
    </QueryClientProvider>
  ),
}

/** The lineage of an entry with no recorded parents, for a viewer. */
export const LineageNoParents: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <QueryClientProvider client={client}>
      <div className="w-[560px] max-w-full">
        <RegistryLineage entryId="e1" identifier="CON-0001" canWrite={false} />
      </div>
    </QueryClientProvider>
  ),
}

/** Retiring an entry. */
export const RetireButton: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <QueryClientProvider client={client}>
      <RegistryRetireButton
        recordId="e2"
        identifier="CON-0002"
        retired={false}
        metadataVersion={1}
      />
    </QueryClientProvider>
  ),
}

/** A retired entry offers to bring it back. */
export const RetiredEntryButton: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <QueryClientProvider client={client}>
      <RegistryRetireButton
        recordId="e5"
        identifier="CL-0002"
        retired
        metadataVersion={2}
      />
    </QueryClientProvider>
  ),
}

const matches: DuplicateMatch[] = [
  {
    id: 'e2',
    identifier: 'CON-0002',
    title: 'pLVX-GFP',
    archived: false,
    match: 'exact',
  },
]

function Duplicate({ list }: { list: DuplicateMatch[] }) {
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <div className="w-[520px] max-w-full">
      <DuplicateNotice
        modelKey="construct"
        matches={list}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
      />
    </div>
  )
}

/** Every key field matches an existing entry: the form asks before registering again. */
export const DuplicateExact: Story = {
  parameters: { layout: 'centered' },
  render: () => <Duplicate list={matches} />,
}

/** Only the name matches, and the match is a retired entry. */
export const DuplicateNameOnly: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <Duplicate list={[{ ...matches[0], match: 'name', archived: true }]} />
  ),
}

function Reader({ initial }: { initial: ReadSequence | null }) {
  const [value, setValue] = useState<ReadSequence | null>(initial)
  return (
    <div className="w-[420px] max-w-full">
      <SequenceReader value={value} onChange={setValue} />
    </div>
  )
}

/** No sequence file chosen yet. */
export const SequenceEmpty: Story = {
  parameters: { layout: 'centered' },
  render: () => <Reader initial={null} />,
}

/** A sequence read from a file, with its length and fingerprint. */
export const SequenceRead: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <Reader
      initial={{
        name: 'pLVX-GFP.gb',
        fingerprint: 'seq:3b7d9c1e42f0a8',
        length: 8421,
        shape: 'circular',
        molecule: 'dna',
      }}
    />
  ),
}

/** Making a model a registry: pick the key fields that identify a duplicate. */
export const SettingsDialog: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <QueryClientProvider client={settingsClient}>
      <RegistrySettingsDialog
        open
        onOpenChange={noop}
        model={{
          ...cellBankModel,
          is_registry: true,
          registry_key_fields: ['name'],
          registry_sequence_field: 'sequence',
          registry_structure_field: null,
          registry_lot_kind: null,
        }}
      />
    </QueryClientProvider>
  ),
}
