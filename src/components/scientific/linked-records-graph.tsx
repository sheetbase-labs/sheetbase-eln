import { useEffect, useMemo } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useNodesState,
} from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  BarChart3,
  Database,
  FileImage,
  FileText,
  FlaskConical,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'

export interface GraphNode {
  id: string
  label: string
  type: 'experiment' | 'sample' | 'dataset' | 'protocol' | 'figure'
  status?: string
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface LinkedRecordsGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  className?: string
}

const TYPE_APPEARANCE: Record<
  GraphNode['type'],
  { color: string; icon: LucideIcon }
> = {
  experiment: { color: 'var(--primary)', icon: FlaskConical },
  sample: { color: 'var(--chart-2)', icon: Database },
  dataset: { color: 'var(--chart-5)', icon: BarChart3 },
  protocol: { color: 'var(--chart-3)', icon: FileText },
  figure: { color: 'var(--chart-4)', icon: FileImage },
}

function getPosition(node: GraphNode, index: number, allNodes: GraphNode[]) {
  const column =
    node.type === 'protocol' ? 0 : node.type === 'experiment' ? 1 : 2
  const columnNodes = allNodes.filter((candidate) => {
    const candidateColumn =
      candidate.type === 'protocol'
        ? 0
        : candidate.type === 'experiment'
          ? 1
          : 2
    return candidateColumn === column
  })
  const row = columnNodes.findIndex((candidate) => candidate.id === node.id)

  return {
    x: column * 210,
    y: row * 84 - ((columnNodes.length - 1) * 84) / 2 + (index % 2) * 2,
  }
}

function toFlowNodes(nodes: GraphNode[]): Node[] {
  return nodes.map((node, index) => {
    const appearance = TYPE_APPEARANCE[node.type]
    const Icon = appearance.icon

    return {
      id: node.id,
      position: getPosition(node, index, nodes),
      data: {
        label: (
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-md"
              style={{
                color: appearance.color,
                background: `color-mix(in oklab, ${appearance.color} 14%, transparent)`,
              }}
            >
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block max-w-28 truncate text-xs font-medium">
                {node.label}
              </span>
              {node.status ? (
                <span className="block max-w-28 truncate text-[10px] text-muted-foreground">
                  {node.status}
                </span>
              ) : null}
            </span>
          </div>
        ),
      },
      style: {
        width: 160,
        padding: '8px 10px',
        color: 'var(--foreground)',
        background: 'var(--card)',
        border: `1px solid ${appearance.color}`,
        borderRadius: 'var(--radius)',
        boxShadow:
          '0 1px 2px color-mix(in oklab, var(--foreground) 8%, transparent)',
      },
    }
  })
}

/** A compact, interactive view of relationships between scientific records. */
export function LinkedRecordsGraph({
  nodes,
  edges,
  className,
}: LinkedRecordsGraphProps) {
  const renderedNodes = useMemo(() => toFlowNodes(nodes), [nodes])
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(renderedNodes)

  useEffect(() => setFlowNodes(renderedNodes), [renderedNodes, setFlowNodes])

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        ...edge,
        type: 'default',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--muted-foreground)',
        },
        style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.25 },
        labelStyle: { fill: 'var(--muted-foreground)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--background)' },
      })),
    [edges],
  )

  return (
    <div
      className={cn(
        'h-64 w-full overflow-hidden rounded-lg border border-border bg-background',
        className,
      )}
      aria-label="Linked records graph"
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.4}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={18} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) =>
            TYPE_APPEARANCE[
              nodes.find((item) => item.id === node.id)?.type ?? 'experiment'
            ].color
          }
          maskColor="color-mix(in oklab, var(--background) 75%, transparent)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
