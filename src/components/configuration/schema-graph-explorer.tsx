/**
 * V2ALT Schemas explorer: a left rail of model kinds and dataset schemas over
 * a React Flow canvas of field-level nodes joined by reference edges. Field
 * editing stays in the governed configuration workspace — double-clicking a
 * node deep-links into it.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
} from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import {
  GitBranch,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Table2,
} from 'lucide-react'
import '@xyflow/react/dist/style.css'

import { Button } from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import {
  fetchDatasetSchemaFields,
  fetchDatasetSchemas,
} from '#/lib/dataset-schema-data'
import type {
  DatasetSchemaFieldWire,
  DatasetSchemaRelationshipWire,
  DatasetSchemaWire,
} from '#/lib/dataset-schema-data'
import type { FieldLogicalType } from '#/lib/field-definition'
import { fetchModelFields, fetchModelKinds } from '#/lib/model-fields'
import type { ModelFieldDefinition, ModelKind } from '#/lib/model-fields'
import { cn } from '#/lib/utils'

export interface SchemaGraphField {
  name: string
  typeLabel: string
  isPk?: boolean
  isFk?: boolean
}

export interface SchemaGraphNode {
  id: string
  key: string
  name: string
  kind: 'model' | 'dataset-schema'
  fields: SchemaGraphField[]
  rowCount: number | null
}

export interface SchemaGraphEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface SchemaGraphData {
  nodes: SchemaGraphNode[]
  edges: SchemaGraphEdge[]
}

const MAX_NODE_FIELDS = 8

function fieldTypeLabel(
  logicalType: FieldLogicalType,
  hasTarget: boolean,
): string {
  switch (logicalType) {
    case 'text':
      return 'text'
    case 'integer':
    case 'decimal':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'timestamp':
      return 'timestamp'
    case 'category':
      return 'enum'
    case 'reference':
      return hasTarget ? 'fk' : 'ref'
  }
}

function modelNodeFields(fields: ModelFieldDefinition[]): SchemaGraphField[] {
  return [
    { name: 'id', typeLabel: 'pk', isPk: true },
    ...fields.map((field) => {
      const isFk =
        field.logicalType === 'reference' && Boolean(field.relationship?.target)
      return {
        name: field.fieldName,
        typeLabel: fieldTypeLabel(field.logicalType, isFk),
        isFk,
      }
    }),
  ]
}

function schemaNodeFields(
  fields: DatasetSchemaFieldWire[],
  relationshipFieldIds: Set<string>,
): SchemaGraphField[] {
  return [
    { name: 'id', typeLabel: 'pk', isPk: true },
    ...fields.map((field) => {
      const isFk =
        field.logical_type === 'reference' && relationshipFieldIds.has(field.id)
      return {
        name: field.slug,
        typeLabel: fieldTypeLabel(field.logical_type, isFk),
        isFk,
      }
    }),
  ]
}

/** Assemble the rail + canvas model from fetched configuration data. */
export function buildSchemaGraphData(input: {
  kinds: ModelKind[]
  modelFields: ModelFieldDefinition[][]
  modelCounts: Array<number | null>
  schemas: DatasetSchemaWire[]
  schemaFields: DatasetSchemaFieldWire[][]
  schemaRelationships: DatasetSchemaRelationshipWire[]
  datasetCounts: Array<number | null>
}): SchemaGraphData {
  const {
    kinds,
    modelFields,
    modelCounts,
    schemas,
    schemaFields,
    schemaRelationships,
    datasetCounts,
  } = input

  const nodes: SchemaGraphNode[] = []
  const edges: SchemaGraphEdge[] = []
  const fieldSlugById = new Map<string, string>()
  const relationshipFieldIds = new Set(
    schemaRelationships
      .map((rel) => rel.source_field_id)
      .filter((id): id is string => Boolean(id)),
  )
  for (const fields of schemaFields) {
    for (const field of fields) fieldSlugById.set(field.id, field.slug)
  }

  kinds.forEach((kind, index) => {
    const fields = modelFields[index] ?? []
    nodes.push({
      id: `model:${kind.key}`,
      key: kind.key,
      name: kind.label,
      kind: 'model',
      fields: modelNodeFields(fields),
      rowCount: modelCounts[index] ?? null,
    })
    for (const field of fields) {
      const target = field.relationship?.target
      if (field.logicalType !== 'reference' || !target) continue
      const targetId =
        target.kind === 'model'
          ? `model:${target.modelKey}`
          : `schema:${target.schemaId}`
      edges.push({
        id: `m:${kind.key}.${field.fieldName}->${targetId}`,
        source: `model:${kind.key}`,
        target: targetId,
        label: field.fieldName,
      })
    }
  })

  schemas.forEach((schema, index) => {
    const fields = schemaFields[index] ?? []
    nodes.push({
      id: `schema:${schema.id}`,
      key: schema.id,
      // Human schema name, not the snake_case slug — the slug stays a
      // storage identifier and must not be presented as the node title.
      name: schema.name,
      kind: 'dataset-schema',
      fields: schemaNodeFields(fields, relationshipFieldIds),
      rowCount: datasetCounts[index] ?? null,
    })
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const rel of schemaRelationships) {
    const source = `schema:${rel.source_schema_id}`
    const target = `schema:${rel.target_schema_id}`
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue
    edges.push({
      id: `s:${rel.id}`,
      source,
      target,
      label:
        rel.label ||
        (rel.source_field_id ? fieldSlugById.get(rel.source_field_id) : '') ||
        undefined,
    })
  }

  const seen = new Set<string>()
  return {
    nodes,
    edges: edges.filter((edge) => {
      const key = `${edge.source}→${edge.target}→${edge.label ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return nodeIds.has(edge.source) && nodeIds.has(edge.target)
    }),
  }
}

async function fetchSchemaGraph(client: DataClient): Promise<SchemaGraphData> {
  const [kinds, schemas, relationships] = await Promise.all([
    fetchModelKinds(client),
    fetchDatasetSchemas(client),
    client.list<DatasetSchemaRelationshipWire>(
      'dataset_schema_relationships',
      '?lifecycle=eq.active',
    ),
  ])
  const activeSchemas = schemas
    .filter((schema) => schema.status !== 'retired')
    .filter(
      (schema, index, list) =>
        list.findIndex((other) => other.slug === schema.slug) === index,
    )
  const [modelFields, modelCounts, schemaFields, datasetCounts] =
    await Promise.all([
      Promise.all(kinds.map((kind) => fetchModelFields(client, kind.key))),
      Promise.all(
        kinds.map((kind) => {
          const table = kind.identityTable.replace(/^api\./, '')
          const filter = table === 'records' ? `?kind=eq.${kind.key}` : ''
          return client.count(table, filter).catch(() => null)
        }),
      ),
      Promise.all(
        activeSchemas.map((schema) =>
          fetchDatasetSchemaFields(client, schema.id),
        ),
      ),
      Promise.all(
        activeSchemas.map((schema) =>
          client
            .count('datasets', `?dataset_schema_id=eq.${schema.id}`)
            .catch(() => null),
        ),
      ),
    ])
  return buildSchemaGraphData({
    kinds,
    modelFields,
    modelCounts,
    schemas: activeSchemas,
    schemaFields,
    schemaRelationships: relationships,
    datasetCounts,
  })
}

interface SchemaRFNodeData extends Record<string, unknown> {
  node: SchemaGraphNode
  isSelected: boolean
}

type SchemaRFNode = Node<SchemaRFNodeData, 'schema'>

const schemaNodeTypes = { schema: SchemaNodeCard }

function SchemaNodeCard({ data }: NodeProps<SchemaRFNode>) {
  const { node, isSelected } = data
  const shown = node.fields.slice(0, MAX_NODE_FIELDS)
  return (
    <div
      className={cn(
        'w-[190px] rounded-md border bg-card text-left shadow-xs transition-shadow',
        isSelected ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-0 !bg-muted-foreground"
      />
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <Table2
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="truncate font-mono text-xs font-semibold">
            {node.name}
          </span>
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {node.fields.length}{' '}
          {node.fields.length === 1 ? 'field' : 'fields'}
        </span>
      </div>
      <ul className="py-0.5">
        {shown.map((field) => (
          <li
            key={field.name}
            className="flex items-baseline justify-between gap-2 px-2.5 py-[3px] text-xs"
          >
            <span
              className={cn(
                'truncate',
                field.isFk ? 'text-primary' : 'text-foreground',
              )}
            >
              {field.name}
            </span>
            <span
              className={cn(
                'shrink-0 font-mono text-[10px]',
                field.isFk ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {field.typeLabel}
            </span>
          </li>
        ))}
        {node.fields.length > shown.length ? (
          <li className="px-2.5 py-[3px] text-[10px] text-muted-foreground">
            +{node.fields.length - shown.length} more
          </li>
        ) : null}
      </ul>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-0 !bg-muted-foreground"
      />
    </div>
  )
}

function nodeHeight(node: SchemaGraphNode): number {
  return 42 + Math.min(node.fields.length, MAX_NODE_FIELDS) * 24 + 8
}

function SchemaCanvas({
  data,
  selectedId,
  onSelectNode,
  onOpenNode,
}: {
  data: SchemaGraphData
  selectedId: string | null
  onSelectNode: (id: string) => void
  onOpenNode: (node: SchemaGraphNode) => void
}) {
  const initialNodes: SchemaRFNode[] = useMemo(() => {
    const rfNodes: SchemaRFNode[] = data.nodes.map((node) => ({
      id: node.id,
      type: 'schema',
      position: { x: 0, y: 0 },
      data: { node, isSelected: false },
    }))
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 160 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const node of data.nodes) {
      g.setNode(node.id, { width: 190, height: nodeHeight(node) })
    }
    for (const edge of data.edges) {
      g.setEdge(edge.source, edge.target)
    }
    dagre.layout(g)
    return rfNodes.map((node) => {
      const pos = g.node(node.id)
      return pos
        ? {
            ...node,
            position: {
              x: pos.x - 95,
              y: pos.y - nodeHeight(node.data.node) / 2,
            },
          }
        : node
    })
  }, [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)

  const edges: Edge[] = useMemo(
    () =>
      data.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: 'default',
        labelStyle: { fontSize: 10, fill: 'var(--muted-foreground)' },
        labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.85 },
        style: { stroke: 'var(--muted-foreground)', strokeWidth: 1 },
      })),
    [data.edges],
  )

  const nodeById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node])),
    [data.nodes],
  )

  return (
    <div className="absolute inset-0" data-testid="schema-graph-canvas">
      <ReactFlow
        nodes={nodes.map((node) => ({
          ...node,
          data: { ...node.data, isSelected: node.id === selectedId },
        }))}
        edges={edges}
        nodeTypes={schemaNodeTypes}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        panOnDrag
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        nodesDraggable
        elementsSelectable={false}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodeDoubleClick={(_, node) => {
          const graphNode = nodeById.get(node.id)
          if (graphNode) onOpenNode(graphNode)
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          className="bg-muted/20"
        />
        <MiniMap
          pannable
          zoomable
          className="!border !bg-background"
          maskColor="rgba(0,0,0,0.05)"
          nodeColor="var(--input)"
        />
        <Panel position="top-center">
          <p className="max-w-md rounded-md border bg-card/90 px-3 py-1.5 text-center text-xs text-muted-foreground shadow-xs backdrop-blur">
            Double-click a node to open its field editor.
          </p>
        </Panel>
      </ReactFlow>
    </div>
  )
}

function RailRow({
  node,
  selected,
  rowLabel,
  rowLabelSingular,
  onSelect,
  onOpen,
}: {
  node: SchemaGraphNode
  selected: boolean
  rowLabel: string
  rowLabelSingular: string
  onSelect: (id: string) => void
  onOpen: (node: SchemaGraphNode) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpen(node)}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
        selected ? 'bg-active' : 'hover:bg-control',
      )}
    >
      <Table2
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs font-semibold">
          {node.name}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {node.fields.length}{' '}
          {node.fields.length === 1 ? 'field' : 'fields'} ·{' '}
          {node.rowCount === null
            ? '—'
            : `${node.rowCount} ${node.rowCount === 1 ? rowLabelSingular : rowLabel}`}
        </span>
      </span>
    </button>
  )
}

export function SchemaGraphExplorer({
  client,
  workspaceId,
  onOpenNode,
  onNewSchema,
  onManage,
}: {
  client: DataClient
  workspaceId: string
  onOpenNode: (node: SchemaGraphNode) => void
  onNewSchema: () => void
  onManage: () => void
}) {
  const graphQuery = useQuery({
    queryKey: ['schema-graph', workspaceId],
    queryFn: () => fetchSchemaGraph(client),
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(true)

  const data = graphQuery.data
  const modelNodes = data?.nodes.filter((node) => node.kind === 'model') ?? []
  const schemaNodes =
    data?.nodes.filter((node) => node.kind === 'dataset-schema') ?? []

  return (
    <div className="flex min-h-0 flex-1">
      {railOpen ? (
        <aside
          aria-label="Schemas"
          className="flex w-56 shrink-0 flex-col overflow-y-auto border-r"
        >
          <div className="flex items-center justify-between px-3 py-2.5">
            <h2 className="text-sm font-semibold">Schemas</h2>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={onNewSchema}
                aria-label="New schema"
                className="rounded p-1 text-muted-foreground hover:bg-control hover:text-foreground"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                aria-label="Collapse schema rail"
                className="rounded p-1 text-muted-foreground hover:bg-control hover:text-foreground"
              >
                <PanelLeftClose className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="flex-1 space-y-4 px-2 pb-3">
            <div>
              <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Models
              </p>
              <div className="space-y-0.5">
                {modelNodes.map((node) => (
                  <RailRow
                    key={node.id}
                    node={node}
                    selected={node.id === selectedId}
                    rowLabel="rows"
                    rowLabelSingular="row"
                    onSelect={setSelectedId}
                    onOpen={onOpenNode}
                  />
                ))}
              </div>
            </div>
            {schemaNodes.length > 0 ? (
              <div>
                <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Dataset schemas
                </p>
                <div className="space-y-0.5">
                  {schemaNodes.map((node) => (
                    <RailRow
                      key={node.id}
                      node={node}
                      selected={node.id === selectedId}
                      rowLabel="datasets"
                      rowLabelSingular="dataset"
                      onSelect={setSelectedId}
                      onOpen={onOpenNode}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="border-t px-3 py-2">
            <button
              type="button"
              onClick={onNewSchema}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              + New schema
            </button>
          </div>
        </aside>
      ) : (
        <div className="flex w-8 shrink-0 flex-col items-center border-r py-2">
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            aria-label="Expand schema rail"
            className="rounded p-1 text-muted-foreground hover:bg-control hover:text-foreground"
          >
            <PanelLeftOpen className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm">
            <GitBranch
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="font-semibold">Schema relationships</span>
            <span className="text-muted-foreground">
              {data
                ? `${data.nodes.length} schemas · ${data.edges.length} relationships`
                : 'Loading…'}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onManage}
            >
              Manage fields
            </Button>
            <Button type="button" size="sm" onClick={onNewSchema}>
              <Plus className="size-3.5" aria-hidden="true" /> New schema
            </Button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {graphQuery.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading schema relationships…
            </div>
          ) : graphQuery.isError ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Schema relationships could not be loaded.
            </div>
          ) : data && data.nodes.length > 0 ? (
            <SchemaCanvas
              data={data}
              selectedId={selectedId}
              onSelectNode={setSelectedId}
              onOpenNode={onOpenNode}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium">No schemas yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Dataset schemas you publish will appear here with their field
                relationships.
              </p>
              <Button type="button" size="sm" onClick={onNewSchema}>
                <Plus className="size-3.5" aria-hidden="true" /> New schema
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
