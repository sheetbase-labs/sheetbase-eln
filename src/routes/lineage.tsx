/**
 * LINEAGE-001 — Lineage Explorer route (`/lineage`).
 *
 * A provenance and relationship explorer that derives graph edges from real
 * record links, dataset transformations, reviews, approvals and signatures.
 * Provides three representations of the same lineage data: an interactive
 * ReactFlow graph, a chronological timeline, and a keyboard-navigable table.
 *
 * Every read goes through the same RLS-filtered `/api/db` boundary as the
 * rest of the application, so permission boundaries are preserved: records,
 * links, reviews and signatures the caller cannot see are absent, and links
 * to inaccessible targets are rendered as honest "restricted" nodes.
 */
import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
} from '@xyflow/react'
import type { NodeProps, Node, Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Database,
  ExternalLink,
  Eye,
  FileText,
  FlaskConical,
  Layers,
  Loader2,
  Maximize,
  Network,
  PenLine,
  Search,
  Table as TableIcon,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { formatRelativeTime, recordKindLabel } from '#/lib/notebook-data'
import {
  ALL_ENTITY_TYPES,
  buildTableData,
  buildTimeline,
  DEFAULT_FILTERS,
  detectCycles,
  ENTITY_TYPE_COLORS,
  ENTITY_TYPE_LABELS,
  fetchLineageGraph,
  filterLineageGraph,
  getLineageSummary,
  getLinkedRecordsByType,
  getTransformationHistory,
  lineageDataClient,
  LINEAGE_MAX_DEPTH,
  lineageNodeDestination,
  lineageQueryKeys,
  parseLineageSeedParam,
  searchLineageSeedRecords,
} from '#/lib/lineage-data'
import type {
  LineageEdge,
  LineageEntityType,
  LineageFilters,
  LineageGraph,
  LineageNode,
  LineageViewMode,
} from '#/lib/lineage-data'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/lineage')({
  staticData: { shellFullBleed: true },
  validateSearch: (search: Record<string, unknown>) => ({
    seed: parseLineageSeedParam(search) ?? undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: LineageExplorerRoute,
})

// ---------------------------------------------------------------------------
// Entity type icon mapping
// ---------------------------------------------------------------------------

const ENTITY_TYPE_ICONS: Partial<Record<LineageEntityType, LucideIcon>> = {
  experiment: FlaskConical,
  sample: FlaskConical,
  reagent: FlaskConical,
  protocol: FileText,
  dataset: Database,
  figure: Network,
  report: FileText,
  file: FileText,
  review: Eye,
  approval: CircleCheck,
  rejection: CircleAlert,
  signature: PenLine,
}

function entityIcon(entityType: LineageEntityType): LucideIcon {
  return ENTITY_TYPE_ICONS[entityType] ?? Layers
}

// ---------------------------------------------------------------------------
// Route component
function LineageExplorerRoute() {
  const { context } = Route.useRouteContext()
  const { seed } = Route.useSearch()
  const [viewMode, setViewMode] = useState<'graph' | 'timeline' | 'table'>(
    'graph',
  )
  const [filters, setFilters] = useState<LineageFilters>(DEFAULT_FILTERS)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    seed ?? null,
  )
  // KNOW-02 — per-object deep-link: `?seed=<recordId>` reconstructs the same
  // traversal the inspector miniature shows, at full explorer depth.
  const seedRecordId = seed ?? null

  const graphQuery = useQuery({
    queryKey: lineageQueryKeys.graphFor(seedRecordId, LINEAGE_MAX_DEPTH),
    queryFn: () => fetchLineageGraph(lineageDataClient, seedRecordId),
    staleTime: 15_000,
  })

  const rawGraph = graphQuery.data ?? null
  const filteredGraph = useMemo(() => {
    if (!rawGraph) return null
    return filterLineageGraph(rawGraph, filters)
  }, [rawGraph, filters])

  // Resolve the seed record's identifier for the picker label; node ids are
  // record ids.
  const seedNode = useMemo(
    () =>
      seedRecordId
        ? (rawGraph?.nodes.find((n) => n.id === seedRecordId) ?? null)
        : null,
    [rawGraph, seedRecordId],
  )

  const selectedNode = useMemo(() => {
    if (!filteredGraph || !selectedNodeId) return null
    return filteredGraph.nodes.find((n) => n.id === selectedNodeId) ?? null
  }, [filteredGraph, selectedNodeId])

  const cycle = useMemo(
    () => (filteredGraph ? detectCycles(filteredGraph) : null),
    [filteredGraph],
  )

  function handleSelectNode(nodeId: string) {
    setSelectedNodeId(nodeId)
  }

  function handleResetFilters() {
    setFilters(DEFAULT_FILTERS)
  }

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  const inspector =
    selectedNode && filteredGraph ? (
      <LineageInspector
        node={selectedNode}
        graph={filteredGraph}
        onSelectNode={handleSelectNode}
        onTraceDirection={(direction: 'upstream' | 'downstream') => {
          if (direction === 'upstream') {
            setFilters((f) => ({ ...f, direction: 'upstream' }))
          } else {
            setFilters((f) => ({ ...f, direction: 'downstream' }))
          }
        }}
      />
    ) : null

  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Lineage Explorer' }],
    inspector: inspector,
    inspectorLabel: 'Lineage inspector',
    inspectorCollapsible: true,
  })

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <LineageHeader
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          nodeCount={filteredGraph?.nodes.length ?? 0}
          edgeCount={filteredGraph?.edges.length ?? 0}
          loading={graphQuery.isLoading}
        />

        {/* Filter bar */}
        <FilterBar
          filters={filters}
          onFiltersChange={setFilters}
          onReset={handleResetFilters}
          cycle={cycle}
          seedRecordId={seedRecordId}
          seedIdentifier={seedNode?.identifier ?? null}
        />

        {/* KNOW-02 — seeded per-object view: same traversal as the inspector
            miniature, reconstructed at full depth. */}
        {seedRecordId ? (
          <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
            <Network className="size-3.5" aria-hidden="true" />
            <span>
              Seeded lineage for{' '}
              <span className="font-mono font-medium text-foreground">
                {seedRecordId}
              </span>
            </span>
            <Link
              to="/lineage"
              search={{ seed: undefined }}
              className="ml-auto font-medium text-foreground underline-offset-4 hover:underline"
            >
              Clear seed — view full graph
            </Link>
          </div>
        ) : null}

        {/* Content */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {graphQuery.isLoading && (
            <div className="flex h-full items-center justify-center">
              <Skeleton className="h-full w-full" />
            </div>
          )}
          {graphQuery.error && (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div className="space-y-2">
                <TriangleAlert
                  className="mx-auto size-8 text-destructive"
                  aria-hidden="true"
                />
                <p className="text-sm text-destructive">
                  Failed to load lineage data.
                </p>
                <p className="text-xs text-muted-foreground">
                  {(graphQuery.error as Error | undefined)?.message ??
                    'Unknown error'}
                </p>
              </div>
            </div>
          )}
          {filteredGraph && !graphQuery.isLoading && (
            <>
              {filteredGraph.nodes.length === 0 && <EmptyLineageState />}
              {filteredGraph.nodes.length > 0 && viewMode === 'graph' && (
                <GraphView
                  graph={filteredGraph}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                />
              )}
              {filteredGraph.nodes.length > 0 && viewMode === 'timeline' && (
                <TimelineView graph={filteredGraph} />
              )}
              {filteredGraph.nodes.length > 0 && viewMode === 'table' && (
                <TableView
                  graph={filteredGraph}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function LineageHeader({
  viewMode,
  onViewModeChange,
  nodeCount,
  edgeCount,
  loading,
}: {
  viewMode: 'graph' | 'timeline' | 'table'
  onViewModeChange: (mode: 'graph' | 'timeline' | 'table') => void
  nodeCount: number
  edgeCount: number
  loading: boolean
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-primary" aria-hidden="true" />
          <h1 className="font-display text-headline font-heading tracking-tight">
            Lineage Explorer
          </h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Explore provenance and relationships for experiments, datasets,
          samples and files.
        </p>
      </div>
      <div className="flex items-center gap-4">
        {!loading && (
          <span className="text-xs text-muted-foreground">
            {nodeCount} node{nodeCount === 1 ? '' : 's'} · {edgeCount} edge
            {edgeCount === 1 ? '' : 's'}
          </span>
        )}
        <div className="flex items-center gap-1 rounded-md border bg-card p-0.5">
          <ViewTabButton
            active={viewMode === 'graph'}
            onClick={() => onViewModeChange('graph')}
            icon={Network}
            label="Graph"
          />
          <ViewTabButton
            active={viewMode === 'timeline'}
            onClick={() => onViewModeChange('timeline')}
            icon={Clock}
            label="Timeline"
          />
          <ViewTabButton
            active={viewMode === 'table'}
            onClick={() => onViewModeChange('table')}
            icon={TableIcon}
            label="Table"
          />
        </div>
      </div>
    </div>
  )
}

function ViewTabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      aria-pressed={active}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Seed picker — choose the record the traversal starts from
// ---------------------------------------------------------------------------

function SeedPicker({
  seedRecordId,
  seedIdentifier,
}: {
  seedRecordId: string | null
  seedIdentifier: string | null
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const seedSearch = useQuery({
    queryKey: ['lineage-seed-search', query],
    queryFn: () => searchLineageSeedRecords(lineageDataClient, query),
    enabled: open,
    staleTime: 15_000,
  })
  const results = seedSearch.data ?? []
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          aria-label="Choose the record to seed the lineage graph from"
        >
          <Network className="size-3.5" aria-hidden />
          {seedIdentifier
            ? `Seed: ${seedIdentifier}`
            : seedRecordId
              ? 'Seed: loading…'
              : 'Seed graph…'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false} loop>
          <div className="flex items-center gap-2 border-b px-3">
            <Search
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <CommandInput
              placeholder="Search records by identifier or title"
              onValueChange={setQuery}
              aria-label="Search records by identifier or title"
            />
            {seedSearch.isLoading ? (
              <Loader2
                className="size-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </div>
          <CommandList>
            {seedSearch.error ? (
              <div
                role="alert"
                className="flex items-start gap-2 px-3 py-4 text-sm text-destructive"
              >
                Could not load records.
              </div>
            ) : null}
            {!seedSearch.error &&
            !seedSearch.isLoading &&
            results.length === 0 ? (
              <CommandEmpty>No records match your search.</CommandEmpty>
            ) : null}
            {results.length > 0 ? (
              <CommandGroup heading="Records">
                {results.map((record) => (
                  <CommandItem
                    key={record.id}
                    value={`${record.identifier} ${record.title}`}
                    aria-selected={record.id === seedRecordId}
                    onSelect={() => {
                      setOpen(false)
                      void navigate({
                        to: '/lineage',
                        search: { seed: record.id },
                      })
                    }}
                  >
                    <div className="flex w-full items-center gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-xs text-muted-foreground">
                          {record.identifier}
                        </span>
                        <p className="truncate text-sm font-medium">
                          {record.title}
                        </p>
                      </div>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {recordKindLabel(record.kind)}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function FilterBar({
  filters,
  onFiltersChange,
  onReset,
  cycle,
  seedRecordId,
  seedIdentifier,
}: {
  filters: LineageFilters
  onFiltersChange: (filters: LineageFilters) => void
  onReset: () => void
  cycle: string[] | null
  seedRecordId: string | null
  seedIdentifier: string | null
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-2">
      {/* Seed picker — the explorer is most useful seeded on one record;
          deep-links land on ?seed=<id> but the picker lets anyone start a
          traversal without leaving the page. */}
      <SeedPicker
        seedRecordId={seedRecordId}
        seedIdentifier={seedIdentifier}
      />

      {/* Entity type filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Entity type:
        </span>
        <Select
          aria-label="Entity type filter"
          value={filters.entityTypes[0] ?? 'all'}
          onChange={(e) => {
            if (e.target.value === 'all') {
              onFiltersChange({ ...filters, entityTypes: [] })
            } else {
              onFiltersChange({
                ...filters,
                entityTypes: [e.target.value as LineageEntityType],
              })
            }
          }}
          className="h-7 w-[130px] text-xs"
        >
          <option value="all">All types</option>
          {ALL_ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {ENTITY_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </div>

      {/* Relationship type filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Relationship:
        </span>
        <Select
          aria-label="Relationship type filter"
          value={filters.relationshipTypes[0] ?? 'all'}
          onChange={(e) => {
            if (e.target.value === 'all') {
              onFiltersChange({ ...filters, relationshipTypes: [] })
            } else {
              onFiltersChange({
                ...filters,
                relationshipTypes: [e.target.value],
              })
            }
          }}
          className="h-7 w-[140px] text-xs"
        >
          <option value="all">All relationships</option>
          <option value="sample">Sample links</option>
          <option value="protocol">Protocol links</option>
          <option value="dataset">Dataset links</option>
          <option value="file">File links</option>
          <option value="general">General links</option>
          <option value="reviewed_by">Reviewed by</option>
          <option value="approved_by">Approved by</option>
          <option value="signed_by">Signed by</option>
        </Select>
      </div>

      {/* Direction filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Direction:
        </span>
        <Select
          aria-label="Direction filter"
          value={filters.direction}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              direction: e.target.value as LineageViewMode,
            })
          }
          className="h-7 w-[170px] text-xs"
        >
          <option value="both">Upstream &amp; downstream</option>
          <option value="upstream">Upstream only</option>
          <option value="downstream">Downstream only</option>
        </Select>
      </div>

      {/* Show external toggle */}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="size-3.5 rounded border-border"
          checked={filters.showExternal}
          onChange={(e) =>
            onFiltersChange({ ...filters, showExternal: e.target.checked })
          }
        />
        Show external
      </label>

      {/* Reset */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={onReset}
      >
        Reset
      </Button>

      {/* Cycle warning */}
      {cycle && (
        <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          <span>Cycle detected ({cycle.length} nodes)</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyLineageState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Network className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-md text-sm text-muted-foreground">
        No lineage data available. Records, links, reviews and signatures will
        appear here once your workspace has experiment data with relationships.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Graph view (ReactFlow)
// ---------------------------------------------------------------------------

interface LineageNodeData extends Record<string, unknown> {
  node: LineageNode
  isSelected: boolean
  onSelect: (id: string) => void
}

type LineageRFNode = Node<LineageNodeData, 'lineage'>

const lineageNodeTypes = { lineage: LineageNodeComponent }

function GraphView({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: LineageGraph
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
}) {
  const handleSelect = useCallback(onSelectNode, [onSelectNode])

  const nodes: LineageRFNode[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'lineage',
        position: { x: 0, y: 0 },
        data: {
          node,
          isSelected: node.id === selectedNodeId,
          onSelect: handleSelect,
        },
        draggable: false,
      })),
    [graph.nodes, selectedNodeId, handleSelect],
  )

  const edges: Edge[] = useMemo(() => {
    const nodeIds = new Set(graph.nodes.map((n) => n.id))
    return graph.edges
      .filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
      .map((edge: LineageEdge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        label: edge.label,
        type: 'default',
        animated: edge.relationshipType === 'derived_from',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--border)',
        },
        style: {
          stroke: 'var(--border)',
          strokeWidth: 1.5,
        },
        data: { edge },
      }))
  }, [graph.edges, graph.nodes])

  // Dagre layout — compute positions once per node/edge set.
  const layoutedNodes = useMemo(() => {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 200 })
    g.setDefaultEdgeLabel(() => ({}))
    const nodeWidth = 220
    const nodeHeight = 72
    for (const n of nodes)
      g.setNode(n.id, { width: nodeWidth, height: nodeHeight })
    for (const e of edges) g.setEdge(e.source, e.target)
    dagre.layout(g)
    return nodes.map((n) => {
      const pos = g.node(n.id)
      return {
        ...n,
        position: pos
          ? { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 }
          : n.position,
      }
    })
  }, [nodes, edges])

  return (
    <div className="absolute inset-0">
      <ReactFlow
        nodes={layoutedNodes}
        edges={edges}
        nodeTypes={lineageNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        panOnDrag
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, n) => {
          const data = n.data
          data.onSelect(n.id)
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          className="bg-muted/20"
        />
        <MiniMap
          pannable
          zoomable
          className="!bg-background !border"
          maskColor="rgba(0,0,0,0.05)"
          nodeColor={(node) => {
            const data = node.data as LineageNodeData
            return ENTITY_TYPE_COLORS[data.node.entityType]
          }}
        />
        <Panel position="top-left">
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <span className="font-medium">Legend:</span>
            {(
              [
                'experiment',
                'sample',
                'dataset',
                'figure',
                'review',
                'approval',
                'file',
              ] as LineageEntityType[]
            ).map((type) => (
              <span key={type} className="flex items-center gap-1">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: ENTITY_TYPE_COLORS[type] }}
                  aria-hidden="true"
                />
                {ENTITY_TYPE_LABELS[type]}
              </span>
            ))}
          </div>
        </Panel>
        <Panel position="top-right">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const rf = document.querySelector('.react-flow')
                if (rf)
                  rf.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Escape' }),
                  )
              }}
            >
              <Maximize className="size-3.5" aria-hidden="true" />
              Fit to view
            </Button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}

function LineageNodeComponent({ data }: NodeProps<LineageRFNode>) {
  const { node, isSelected, onSelect } = data
  const Icon = entityIcon(node.entityType)
  const color = ENTITY_TYPE_COLORS[node.entityType]

  return (
    <div
      className={cn(
        'w-[220px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors',
        node.accessible
          ? 'border-border'
          : 'border-dashed border-muted-foreground/40 opacity-70',
        isSelected && 'ring-2 ring-primary',
      )}
      role="button"
      tabIndex={0}
      aria-label={`${ENTITY_TYPE_LABELS[node.entityType]}: ${node.identifier} — ${node.title}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(node.id)
        }
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-0 !bg-muted-foreground"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            className="size-3.5 shrink-0"
            style={{ color }}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-semibold">
            {node.identifier}
          </span>
        </div>
        {!node.accessible && (
          <CircleAlert
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {node.title}
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        <span
          className="rounded px-1.5 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: `${color}20`,
            color,
          }}
        >
          {ENTITY_TYPE_LABELS[node.entityType]}
        </span>
        {node.status &&
          node.status !== 'missing' &&
          node.status !== 'restricted' && (
            <span className="text-xs text-muted-foreground">{node.status}</span>
          )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-0 !bg-muted-foreground"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Timeline view
// ---------------------------------------------------------------------------

function TimelineView({ graph }: { graph: LineageGraph }) {
  const entries = useMemo(() => buildTimeline(graph.events), [graph.events])

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No events to display in the timeline.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-2xl">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">
          Key Events
        </h2>
        <ol className="relative space-y-4">
          {entries.map((entry, idx) => {
            const node = graph.nodes.find((n) => n.recordId === entry.recordId)
            return (
              <li key={entry.id} className="relative flex gap-3">
                {/* Timeline line */}
                {idx < entries.length - 1 && (
                  <span
                    className="absolute left-2 top-6 h-full w-px bg-border"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    'mt-0.5 size-4 shrink-0 rounded-full border-2',
                    entry.operation === 'create'
                      ? 'border-blue-500 bg-blue-500/20'
                      : entry.operation === 'delete' ||
                          entry.operation === 'archive'
                        ? 'border-red-400 bg-red-400/20'
                        : 'border-muted-foreground bg-muted',
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {entry.operationLabel}
                    </span>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={entry.createdAt}
                    >
                      {formatRelativeTime(entry.createdAt)}
                    </time>
                  </div>
                  {node && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      <span className="font-mono">{node.identifier}</span> —{' '}
                      {node.title}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table view (keyboard-navigable)
// ---------------------------------------------------------------------------

function TableView({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: LineageGraph
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
}) {
  const rows = useMemo(() => buildTableData(graph), [graph])

  return (
    <div
      className="h-full overflow-auto"
      role="region"
      aria-label="Lineage table"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Identifier</TableHead>
            <TableHead scope="col">Title</TableHead>
            <TableHead scope="col">Type</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Relationship</TableHead>
            <TableHead scope="col">Direction</TableHead>
            <TableHead scope="col">Depth</TableHead>
            <TableHead scope="col">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={
                selectedNodeId === row.id.split(':')[0] ? 'selected' : undefined
              }
              onClick={() => onSelectNode(row.id.split(':')[0])}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectNode(row.id.split(':')[0])
                }
              }}
              tabIndex={0}
              className="cursor-pointer"
              aria-label={`${row.entityTypeLabel}: ${row.identifier} — ${row.title}`}
            >
              <TableCell className="font-mono text-xs">
                {row.identifier}
              </TableCell>
              <TableCell className="max-w-[240px] truncate text-sm">
                {row.title}
              </TableCell>
              <TableCell>
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: `${ENTITY_TYPE_COLORS[row.entityType]}20`,
                    color: ENTITY_TYPE_COLORS[row.entityType],
                  }}
                >
                  {row.entityTypeLabel}
                </span>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.status}
              </TableCell>
              <TableCell className="text-xs">{row.relationshipLabel}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.direction}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.depth}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatRelativeTime(row.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------

function LineageInspector({
  node,
  graph,
  onSelectNode,
  onTraceDirection,
}: {
  node: LineageNode
  graph: LineageGraph
  onSelectNode: (id: string) => void
  onTraceDirection: (direction: 'upstream' | 'downstream') => void
}) {
  const summary = useMemo(
    () => getLineageSummary(graph, node.id),
    [graph, node.id],
  )
  const linkedRecords = useMemo(
    () => getLinkedRecordsByType(graph, node.id),
    [graph, node.id],
  )
  const transformations = useMemo(
    () => getTransformationHistory(graph, node.id),
    [graph, node.id],
  )
  const destination = useMemo(() => lineageNodeDestination(node), [node])

  const Icon = entityIcon(node.entityType)
  const color = ENTITY_TYPE_COLORS[node.entityType]

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Header */}
      <div className="shrink-0 border-b p-4">
        <div className="flex items-center gap-2">
          <Icon
            className="size-4 shrink-0"
            style={{ color }}
            aria-hidden="true"
          />
          <span className="font-mono text-sm font-semibold">
            {node.identifier}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: `${color}20`,
              color,
            }}
          >
            {ENTITY_TYPE_LABELS[node.entityType]}
          </span>
          {node.status && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <span
                className={cn(
                  'inline-block size-2 rounded-full',
                  node.status === 'approved' || node.status === 'signed'
                    ? 'bg-green-500'
                    : node.status === 'rejected'
                      ? 'bg-red-500'
                      : node.status === 'restricted' ||
                          node.status === 'missing'
                        ? 'bg-muted-foreground'
                        : 'bg-blue-500',
                )}
                aria-hidden="true"
              />
              {node.status}
            </span>
          )}
        </div>
        {!node.accessible && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            <CircleAlert className="size-3.5" aria-hidden="true" />
            <span>
              {node.status === 'missing'
                ? 'This record is missing or was deleted.'
                : 'You do not have permission to view this record.'}
            </span>
          </div>
        )}
      </div>

      {/* Details */}
      {node.accessible && (
        <div className="shrink-0 space-y-1.5 border-b p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Details
          </h3>
          <DetailRow label="Title" value={node.title} />
          <DetailRow label="Type" value={ENTITY_TYPE_LABELS[node.entityType]} />
          <DetailRow label="Status" value={node.status} />
          <DetailRow
            label="Created"
            value={formatRelativeTime(node.createdAt)}
          />
          <DetailRow
            label="Updated"
            value={formatRelativeTime(node.updatedAt)}
          />
        </div>
      )}

      {/* Lineage summary */}
      <div className="shrink-0 space-y-2 border-b p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Lineage Summary
        </h3>
        <div className="flex items-center gap-4">
          <SummaryMetric
            label="Upstream"
            value={summary.upstreamCount}
            icon={ArrowUpToLine}
          />
          <SummaryMetric
            label="Downstream"
            value={summary.downstreamCount}
            icon={ArrowDownToLine}
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Total links: {summary.totalLinks}</span>
          <span>External: {summary.externalLinks}</span>
        </div>
      </div>

      {/* Transformation history */}
      {transformations.length > 1 && (
        <div className="shrink-0 space-y-2 border-b p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Transformation History
          </h3>
          <div className="space-y-1">
            {transformations.map((step, idx) => (
              <div key={step.id} className="flex items-center gap-2">
                {idx > 0 && (
                  <ChevronRight
                    className="size-3 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="font-mono text-xs font-medium">
                  {step.identifier}
                </span>
                <span className="text-xs text-muted-foreground">
                  {step.relationshipLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Linked records */}
      {linkedRecords.length > 0 && (
        <div className="shrink-0 space-y-2 border-b p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Linked Records ({summary.totalLinks})
          </h3>
          <div className="space-y-1">
            {linkedRecords.map((group) => (
              <button
                key={group.entityType}
                type="button"
                className="flex w-full items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted"
                onClick={() => {
                  const firstNode = graph.nodes.find(
                    (n) => n.id === group.records[0]?.id,
                  )
                  if (firstNode) onSelectNode(firstNode.id)
                }}
              >
                <span className="text-muted-foreground">
                  {group.entityTypeLabel}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {group.count}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions — KNOW-02: submitted/frozen evidence nodes link to the
          frozen evidence workspace; live nodes link to their canonical
          surface. Inaccessible nodes expose no action (honest state above). */}
      {node.accessible && (
        <div className="shrink-0 space-y-1.5 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Actions
          </h3>
          {destination ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-xs"
              asChild
            >
              <a href={destination}>
                <ExternalLink className="size-3.5" aria-hidden="true" />
                {node.revisionId ? 'Open evidence' : 'Open record'}
              </a>
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => onTraceDirection('upstream')}
          >
            <ArrowUpToLine className="size-3.5" aria-hidden="true" />
            Trace upstream
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => onTraceDirection('downstream')}
          >
            <ArrowDownToLine className="size-3.5" aria-hidden="true" />
            Trace downstream
          </Button>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}

function SummaryMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number
  icon: LucideIcon
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <Icon className="size-3 text-muted-foreground" aria-hidden="true" />
        <span className="text-lg font-semibold">{value}</span>
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exported sub-components for testing
// ---------------------------------------------------------------------------

export {
  LineageHeader,
  FilterBar,
  GraphView,
  TimelineView,
  TableView,
  LineageInspector,
  EmptyLineageState,
  ViewTabButton,
}
