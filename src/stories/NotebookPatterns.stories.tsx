import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NotebookBlock } from '#/components/notebook/notebook-block'
import { BlockPreview } from '#/components/notebook/block-preview'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { ChartFrame } from '#/components/viz/chart-frame'
import { PlateMap } from '#/components/viz/plate-map'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
const meta = { title: 'Notebook/Patterns', component: NotebookBlock, tags: ['autodocs'], args: { label: 'Notebook block', children: null }, decorators: [(Story) => <QueryClientProvider client={queryClient}><Story /></QueryClientProvider>] } satisfies Meta<typeof NotebookBlock>
export default meta
type Story = StoryObj<typeof meta>
const rows = [['Day 0', 'R1', '250 µL', '4 °C'], ['Day 7', 'R1', '250 µL', '4 °C'], ['Day 14', 'R2', '250 µL', '4 °C'], ['Day 28', 'R2', '250 µL', '4 °C']]
export const BlockLanguage: Story = { render: () => <div className="mx-auto max-w-4xl divide-y rounded-lg border bg-background p-2">
  <NotebookBlock label="Objective" title="Objective" draggable><BlockPreview block={{ id: 'objective', type: 'rich_text', payload: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Evaluate the stability of concentrated lentiviral vector at 4 °C over 28 days.' }] }] } }, payloadSchemaVersion: 1 } as any} /></NotebookBlock>
  <NotebookBlock label="Materials" title="Materials" draggable><ul className="list-disc space-y-1 pl-5"><li>DPBS <Badge variant="outline">50 mL</Badge></li><li>qPCR kit <Badge variant="outline">1 kit</Badge></li><li>96-well plate <Badge variant="outline">1 plate</Badge></li></ul></NotebookBlock>
  <NotebookBlock label="Table" title="Experimental design" draggable><Table><TableHeader><TableRow>{['Timepoint', 'Replicate', 'Volume', 'Storage'].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.join()}>{row.map((cell) => <TableCell key={cell}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table></NotebookBlock>
  <NotebookBlock label="Chart" title="Results" draggable><ChartFrame title="Functional titer over time" subtitle="Mean of two replicates"><div className="flex h-44 items-end gap-8 border-b border-l px-8" aria-label="Bar chart of titer over time">{[100, 92, 78, 61].map((height, i) => <div key={height} className="flex flex-1 flex-col items-center gap-2"><div className="w-full rounded-t bg-primary" style={{ height }} /><span className="text-xs text-muted-foreground">D{[0, 7, 14, 28][i]}</span></div>)}</div></ChartFrame></NotebookBlock>
  <NotebookBlock label="Plate map" title="qPCR plate map" draggable><PlateMap rows={2} cols={6} wells={[]} ariaLabel="qPCR plate map" /></NotebookBlock>
  <div className="p-6"><Button variant="outline">+ Add block</Button></div>
</div> }
