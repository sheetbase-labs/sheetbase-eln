import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ListToolbar } from '#/components/inventory/list'
import { useListArrange } from '#/components/inventory/list-arrange'
import {
  ownerColumn,
  statusColumn,
  updatedColumn,
} from '#/components/inventory/list-columns'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'

/**
 * The Sort and Group menus every list carries, and the Status, Owner and
 * Updated columns every list ends with.
 *
 * Nothing here names a sort or a group: the menus read the columns. Every named
 * column with a value sorts; Status and Owner group because their values
 * repeat, while the ID, the name, the date and the prose summary do not.
 */

interface Entry {
  id: string
  name: string
  summary: string
  status: 'active' | 'retired'
  owner: string
  updated: string
}

const ENTRIES: Entry[] = [
  {
    id: 'VEC-0005',
    name: 'AAV9-HLP-hFVIII-SQ',
    summary: 'HLP promoter, AAV9 capsid, codon-optimised hFVIII-SQ',
    status: 'active',
    owner: 'u1',
    updated: '2026-11-07',
  },
  {
    id: 'CL-0009',
    name: 'Primary T cells, donor pool A',
    summary: 'TexMACS with 5% human AB serum, thawed from the October bank',
    status: 'active',
    owner: 'u2',
    updated: '2026-09-23',
  },
  {
    id: 'AB-0007',
    name: 'Anti-HIV-1 p24',
    summary: 'Clone 39/5.4A against the HIV-1 p24 capsid, from Abcam',
    status: 'retired',
    owner: 'u1',
    updated: '2026-07-30',
  },
  {
    id: 'CON-0011',
    name: 'pLVX-EF1a-GFP',
    summary: 'E. coli Stbl3, circular, made in house for transduction controls',
    status: 'active',
    owner: 'u3',
    updated: '2026-07-20',
  },
]

const NAMES = new Map([
  ['u1', 'Gareth P.'],
  ['u2', 'Priya S.'],
  ['u3', 'Mei L.'],
])

const COLUMNS: RegistryColumn<Entry>[] = [
  { id: 'id', header: 'Number', size: 110, accessorFn: (e) => e.id },
  { id: 'name', header: 'Name', size: 220, accessorFn: (e) => e.name },
  { id: 'summary', header: 'Details', size: 260, accessorFn: (e) => e.summary },
  statusColumn((e) =>
    e.status === 'active'
      ? { label: 'Active', tone: 'ok' }
      : { label: 'Retired', tone: 'stored' },
  ),
  ownerColumn((e) => e.owner, NAMES),
  updatedColumn((e) => e.updated),
]

function ArrangedList() {
  const arrange = useListArrange({ rows: ENTRIES, columns: COLUMNS })

  return (
    <div className="flex flex-col">
      <ListToolbar
        q=""
        onSearch={() => undefined}
        label="Search the registry"
        placeholder="Search by number, name or details…"
        arrange={arrange}
      />
      <RegistryGrid
        label="Registry"
        {...arrange.grid}
        columns={COLUMNS}
        getRowId={(e) => e.id}
        selectable={false}
      />
    </div>
  )
}

const meta = {
  title: 'UI/List sort and group',
  component: ArrangedList,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ArrangedList>

export default meta

type Story = StoryObj<typeof meta>

/** A registry list: Sort offers every column; Group offers Status and Owner. */
export const RegistryList: Story = {}
