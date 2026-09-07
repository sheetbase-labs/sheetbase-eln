import type { Meta, StoryObj } from '@storybook/tanstack-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '#/components/scientific/data-table'
import { Badge } from '#/components/ui/badge'

interface SampleRow {
  id: string
  type: string
  batch: string
  concentration: string
  storage: string
  status: 'In stock' | 'Low stock' | 'Expiring'
}
const data: SampleRow[] = [
  {
    id: 'SMP-LV-0001',
    type: 'Lentiviral vector',
    batch: 'LV-2507-A',
    concentration: '8.2 × 10⁸ TU/mL',
    storage: '-80 °C / FZ-01',
    status: 'In stock',
  },
  {
    id: 'SMP-LV-0002',
    type: 'Lentiviral vector',
    batch: 'LV-2507-A',
    concentration: '7.9 × 10⁸ TU/mL',
    storage: '-80 °C / FZ-01',
    status: 'Low stock',
  },
  {
    id: 'SMP-DNA-0041',
    type: 'Plasmid DNA',
    batch: 'DNA-112',
    concentration: '412 ng/µL',
    storage: '-20 °C / FZ-03',
    status: 'In stock',
  },
  {
    id: 'SMP-RNA-0018',
    type: 'Total RNA',
    batch: 'RNA-044',
    concentration: '96 ng/µL',
    storage: '-80 °C / FZ-02',
    status: 'Expiring',
  },
  {
    id: 'SMP-AB-0087',
    type: 'Antibody',
    batch: 'AB-903',
    concentration: '1.0 mg/mL',
    storage: '4 °C / RF-02',
    status: 'In stock',
  },
  {
    id: 'SMP-CL-0022',
    type: 'Cell lysate',
    batch: 'CL-071',
    concentration: '2.4 mg/mL',
    storage: '-80 °C / FZ-04',
    status: 'Low stock',
  },
]
const columns: ColumnDef<SampleRow>[] = [
  { accessorKey: 'id', header: 'Sample ID' },
  { accessorKey: 'type', header: 'Type' },
  { accessorKey: 'batch', header: 'Batch' },
  { accessorKey: 'concentration', header: 'Concentration' },
  { accessorKey: 'storage', header: 'Storage' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.status === 'In stock'
            ? 'success'
            : row.original.status === 'Low stock'
              ? 'warning'
              : 'danger'
        }
      >
        {row.original.status}
      </Badge>
    ),
  },
]
const meta = {
  title: 'Scientific/DataTable',
  component: DataTable<SampleRow, unknown>,
  tags: ['autodocs'],
  args: { columns, data },
} satisfies Meta<typeof DataTable<SampleRow, unknown>>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const WithSelection: Story = { args: { enableRowSelection: true } }
export const Sortable: Story = { args: { enableSorting: true } }
export const Empty: Story = { args: { data: [] } }
export const WithRowClick: Story = {
  args: { onRowClick: (row) => console.log('Selected sample', row) },
}
export const RegistryControls: Story = {
  args: {
    variant: 'quiet',
    enablePagination: true,
    enableColumnVisibility: true,
    getRowId: (row) => row.id,
    data: Array.from({ length: 45 }, (_, i) => ({
      ...data[i % data.length],
      id: `SMP-${String(i + 1).padStart(4, '0')}`,
    })),
  },
}
