import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { LinkedRecordsGraph } from '#/components/scientific/linked-records-graph'
import type {
  GraphNode,
  GraphEdge,
} from '#/components/scientific/linked-records-graph'

const nodes: GraphNode[] = [
  { id: 'exp', type: 'experiment', label: 'Virus Stability at 4 °C' },
  { id: 's1', type: 'sample', label: 'SMP-LV-0001' },
  { id: 's2', type: 'sample', label: 'SMP-LV-0002' },
  { id: 'data', type: 'dataset', label: 'Stability qPCR Data' },
  { id: 'protocol', type: 'protocol', label: 'Titration Assay' },
  { id: 'figure', type: 'figure', label: 'Titer over time' },
]
const edges: GraphEdge[] = nodes
  .slice(1)
  .map((node) => ({ id: `exp-${node.id}`, source: 'exp', target: node.id }))
const meta = {
  title: 'Scientific/LinkedRecordsGraph',
  component: LinkedRecordsGraph,
  tags: ['autodocs'],
  args: { nodes, edges, className: 'h-[420px]' },
} satisfies Meta<typeof LinkedRecordsGraph>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Sparse: Story = {
  args: { nodes: nodes.slice(0, 2), edges: edges.slice(0, 1) },
}
export const Complex: Story = {
  args: {
    nodes: [
      ...nodes,
      { id: 'data2', type: 'dataset', label: 'Flow cytometry results' },
      { id: 's3', type: 'sample', label: 'SMP-LV-0003' },
    ],
    edges: [
      ...edges,
      { id: 's1-data', source: 's1', target: 'data' },
      { id: 's2-data', source: 's2', target: 'data' },
      { id: 's3-data2', source: 's3', target: 'data2' },
      { id: 'exp-s3', source: 'exp', target: 's3' },
      { id: 'exp-data2', source: 'exp', target: 'data2' },
    ],
  },
}
