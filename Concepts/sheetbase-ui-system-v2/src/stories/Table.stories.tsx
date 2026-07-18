import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Badge } from '#/components/ui/badge'
import { Checkbox } from '#/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'

const meta = { title: 'UI/Table', component: Table, tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta<typeof Table>
export default meta
type Story = StoryObj<typeof meta>
export const DataGrid: Story = { render: () => <div className='overflow-hidden rounded-lg border'><Table><TableHeader><TableRow><TableHead className='w-10'><Checkbox/></TableHead><TableHead>Sample ID</TableHead><TableHead>Type</TableHead><TableHead>Batch</TableHead><TableHead>Storage</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{[
  ['SMP-LV-0001','Lentiviral vector','B25-0701-01','-80 °C / FZ-01','In stock'],
  ['SMP-PLS-0003','Plasmid DNA','B24-0620-02','-20 °C / FZ-02','Low stock'],
  ['SMP-PRT-0004','Protein','P25-0615-01','-20 °C / FZ-03','Expiring'],
].map((row)=><TableRow key={row[0]}><TableCell><Checkbox/></TableCell><TableCell className='font-medium text-primary'>{row[0]}</TableCell><TableCell>{row[1]}</TableCell><TableCell>{row[2]}</TableCell><TableCell>{row[3]}</TableCell><TableCell><Badge variant={row[4]==='In stock'?'success':row[4]==='Low stock'?'warning':'danger'}>{row[4]}</Badge></TableCell></TableRow>)}</TableBody></Table></div> }
