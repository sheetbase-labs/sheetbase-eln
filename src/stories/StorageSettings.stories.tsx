import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useState } from 'react'

import { LabelTemplatesPanel } from '#/components/v3/settings/label-templates-panel'
import { SettingsHeader } from '#/components/v3/settings/settings-page'
import { StorageLocationsPanel } from '#/components/v3/settings/storage-locations-panel'
import { Tabs } from '#/components/v3/ui/tabs'
import type { DataClient } from '#/lib/data-client'

/**
 * Settings → Storage and labels. The panels read through the data client they
 * are given, so these stories hand them the demo lab's rows instead of a server.
 */
const TABLES: Record<string, Record<string, unknown>[]> = {
  storage_sites: [
    { id: 's1', name: 'Cambridge lab', code: 'CAM-LAB', archived_at: null },
  ],
  storage_rooms: [
    {
      id: 'r1',
      site_id: 's1',
      name: 'Lab 2',
      code: 'LAB-2',
      archived_at: null,
    },
    {
      id: 'r2',
      site_id: 's1',
      name: 'Cold room CR-1',
      code: 'CR-1',
      archived_at: null,
    },
    {
      id: 'r3',
      site_id: 's1',
      name: 'Cold room CR-2',
      code: 'CR-2',
      archived_at: null,
    },
  ],
  storage_units: [
    {
      id: 'u1',
      room_id: 'r1',
      name: 'Freezer F-1',
      code: 'F-1',
      unit_type: 'freezer',
      temperature_min_c: '-85',
      temperature_max_c: '-75',
      archived_at: null,
    },
    {
      id: 'u2',
      room_id: 'r1',
      name: 'Fridge F-2',
      code: 'F-2',
      unit_type: 'fridge',
      temperature_min_c: '2',
      temperature_max_c: '8',
      archived_at: null,
    },
    {
      id: 'u3',
      room_id: 'r1',
      name: 'LN2 tank 1',
      code: 'LN2-1',
      unit_type: 'cryo',
      temperature_min_c: '-196',
      temperature_max_c: '-150',
      archived_at: null,
    },
    {
      id: 'u4',
      room_id: 'r2',
      name: 'Shelving CR-1',
      code: 'SH-CR1',
      unit_type: 'cabinet',
      temperature_min_c: '2',
      temperature_max_c: '8',
      archived_at: null,
    },
  ],
  storage_shelves: [
    {
      id: 'sh1',
      unit_id: 'u1',
      name: 'Shelf 1',
      position: 1,
      archived_at: null,
    },
    {
      id: 'sh2',
      unit_id: 'u1',
      name: 'Shelf 2',
      position: 2,
      archived_at: null,
    },
    {
      id: 'sh3',
      unit_id: 'u2',
      name: 'Shelf 3',
      position: 3,
      archived_at: null,
    },
  ],
  storage_racks: [
    {
      id: 'k1',
      shelf_id: 'sh1',
      name: 'Rack A',
      position: 1,
      archived_at: null,
    },
    {
      id: 'k2',
      shelf_id: 'sh2',
      name: 'Rack B',
      position: 1,
      archived_at: null,
    },
    {
      id: 'k3',
      shelf_id: 'sh3',
      name: 'Rack 1',
      position: 1,
      archived_at: null,
    },
  ],
  storage_boxes: [
    {
      id: 'b3',
      rack_id: 'k1',
      name: 'Box 3',
      code: 'BX-3',
      rows: 9,
      cols: 9,
      archived_at: null,
    },
    {
      id: 'b4',
      rack_id: 'k1',
      name: 'Box 4',
      code: 'BX-4',
      rows: 9,
      cols: 9,
      archived_at: null,
    },
    {
      id: 'b7',
      rack_id: 'k2',
      name: 'Box 7',
      code: 'BX-7',
      rows: 9,
      cols: 9,
      archived_at: null,
    },
    {
      id: 'b14',
      rack_id: 'k3',
      name: 'Box 14',
      code: 'BX-14',
      rows: 9,
      cols: 9,
      archived_at: null,
    },
    {
      id: 'b15',
      rack_id: 'k3',
      name: 'Box 15',
      code: 'BX-15',
      rows: 9,
      cols: 9,
      archived_at: '2026-10-20T09:00:00Z',
    },
  ],
  storage_positions: [{ box_id: 'b3' }, { box_id: 'b14' }, { box_id: 'b14' }],
  label_templates: [
    template('Sample tube', 50, 25, 'qr', { is_default: true }),
    template('Cryovial', 25, 13, 'qr', {
      show_lot: false,
      show_condition: false,
      show_use_by: false,
    }),
    template('Retain bottle', 76, 25, 'code128', {
      show_sample_type: true,
      show_use_by: false,
    }),
    template('Old tube', 50, 25, 'qr', { archived_at: '2026-09-01T09:00:00Z' }),
  ],
}

function template(
  name: string,
  width: number,
  height: number,
  barcode: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    workspace_id: '00000000-0000-4000-8000-000000000300',
    name,
    record_kind: 'sample',
    show_condition: true,
    show_use_by: true,
    show_lot: true,
    show_sample_type: false,
    width_mm: width,
    height_mm: height,
    barcode_type: barcode,
    is_default: false,
    archived_at: null,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    ...extra,
  }
}

const client = {
  list: async (resource: string) => TABLES[resource] ?? [],
  insert: async () => ({}),
  rpc: async () => ({}),
  patch: async () => [],
  remove: async () => [],
  count: async () => 0,
} as unknown as DataClient

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

function Page({
  canManage,
  initial,
}: {
  canManage: boolean
  initial: 'locations' | 'labels'
}) {
  const [tab, setTab] = useState<string>(initial)
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-[640px] w-[1180px] flex-col border border-border bg-background">
        <SettingsHeader title="Storage and labels" border={false}>
          Where samples are kept, and the labels they print with.
        </SettingsHeader>
        <Tabs
          mode="state"
          label="Storage and labels sections"
          className="border-b border-border px-6"
          value={tab}
          onValueChange={setTab}
          items={[
            { key: 'locations', label: 'Storage locations' },
            { key: 'labels', label: 'Label templates' },
          ]}
        />
        {tab === 'locations' ? (
          <StorageLocationsPanel
            workspaceId="ws"
            canManage={canManage}
            client={client}
          />
        ) : (
          <LabelTemplatesPanel
            workspaceId="ws"
            canManage={canManage}
            client={client}
          />
        )}
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Settings/Storage and labels',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const StorageLocations: Story = {
  render: () => <Page canManage initial="locations" />,
}

export const StorageLocationsViewOnly: Story = {
  render: () => <Page canManage={false} initial="locations" />,
}

export const LabelTemplates: Story = {
  render: () => <Page canManage initial="labels" />,
}

export const LabelTemplatesViewOnly: Story = {
  render: () => <Page canManage={false} initial="labels" />,
}
