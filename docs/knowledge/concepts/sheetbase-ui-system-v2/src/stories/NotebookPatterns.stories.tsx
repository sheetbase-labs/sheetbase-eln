import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { NotebookBlock } from '#/components/sheetbase/notebook-block'
import { PlateMap } from '#/components/sheetbase/plate-map'
import { SampleChart } from '#/components/sheetbase/sample-chart'

const meta = { title: 'Patterns/Notebook blocks', tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const BlockLanguage: Story = { render: () => <div className='grid max-w-4xl gap-4'>
  <NotebookBlock title='Objective'><p className='text-sm'>Evaluate the stability of concentrated lentiviral vector at 4 °C over 28 days.</p></NotebookBlock>
  <NotebookBlock title='Materials' label='LIST'><ul className='list-disc space-y-1 pl-5 text-sm'><li>DPBS, sterile filtered</li><li>qPCR kit (TaqMan)</li><li>96-well plate</li></ul></NotebookBlock>
  <NotebookBlock title='Experimental design' label='TABLE'><Table><TableHeader><TableRow><TableHead>Timepoint</TableHead><TableHead>Replicate</TableHead><TableHead>Volume</TableHead><TableHead>Storage</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>0</TableCell><TableCell>1</TableCell><TableCell>100 µL</TableCell><TableCell>4 °C</TableCell></TableRow><TableRow><TableCell>7</TableCell><TableCell>2</TableCell><TableCell>100 µL</TableCell><TableCell>4 °C</TableCell></TableRow></TableBody></Table></NotebookBlock>
  <NotebookBlock title='Titer over time' label='CHART' actions={<Badge variant='info'>Live</Badge>}><SampleChart/></NotebookBlock>
  <NotebookBlock title='Plate map' label='PLATE'><PlateMap compact/></NotebookBlock>
  <div className='flex justify-center'><Button variant='outline'>Add block</Button></div>
</div> }
