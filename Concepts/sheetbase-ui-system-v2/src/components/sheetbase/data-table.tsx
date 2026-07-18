import * as React from 'react'
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable   } from '@tanstack/react-table'
import type {ColumnDef, SortingState} from '@tanstack/react-table';
import { ArrowUpDown } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { Badge } from '#/components/ui/badge'

type Sample={id:string;type:string;batch:string;concentration:string;storage:string;status:'In stock'|'Low stock'|'Expiring'}
const rows:Sample[]=[
{id:'SMP-LV-0001',type:'Lentiviral vector',batch:'B25-0701-01',concentration:'3.2E+08 TU/mL',storage:'-80 °C / FZ-01',status:'In stock'},
{id:'SMP-LV-0002',type:'Lentiviral vector',batch:'B25-0701-01',concentration:'2.8E+08 TU/mL',storage:'-80 °C / FZ-01',status:'In stock'},
{id:'SMP-PLS-0003',type:'Plasmid DNA',batch:'B24-0620-02',concentration:'110 ng/µL',storage:'-20 °C / FZ-02',status:'Low stock'},
{id:'SMP-PRT-0004',type:'Protein',batch:'P25-0615-01',concentration:'0.75 mg/mL',storage:'-20 °C / FZ-03',status:'Expiring'},
]
const columns:ColumnDef<Sample>[]=[
{id:'select',header:()=> <Checkbox aria-label='Select all'/>,cell:()=> <Checkbox aria-label='Select row'/>,enableSorting:false},
{accessorKey:'id',header:({column})=><Button variant='ghost' size='sm' className='-ml-3 h-7' onClick={()=>column.toggleSorting(column.getIsSorted()==='asc')}>Sample ID<ArrowUpDown/></Button>,cell:({row})=><span className='font-medium text-primary'>{row.original.id}</span>},
{accessorKey:'type',header:'Type'},{accessorKey:'batch',header:'Batch'},{accessorKey:'concentration',header:'Concentration'},{accessorKey:'storage',header:'Storage'},
{accessorKey:'status',header:'Status',cell:({row})=><Badge variant={row.original.status==='In stock'?'success':row.original.status==='Low stock'?'warning':'danger'}>{row.original.status}</Badge>},
]
export function SampleDataTable(){const [sorting,setSorting]=React.useState<SortingState>([]);const table=useReactTable({data:rows,columns,state:{sorting},onSortingChange:setSorting,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel()});return <div className='overflow-hidden rounded-lg border'><Table><TableHeader>{table.getHeaderGroups().map(group=><TableRow key={group.id}>{group.headers.map(header=><TableHead key={header.id}>{header.isPlaceholder?null:flexRender(header.column.columnDef.header,header.getContext())}</TableHead>)}</TableRow>)}</TableHeader><TableBody>{table.getRowModel().rows.map(row=><TableRow key={row.id}>{row.getVisibleCells().map(cell=><TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</TableCell>)}</TableRow>)}</TableBody></Table></div>}
