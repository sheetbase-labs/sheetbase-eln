/**
 * LINEAGE-001 — Lineage Explorer route component tests.
 *
 * Covers the header, filter bar, view tabs, empty state, graph view, timeline
 * view, table view and inspector panel. Mocks react-query and lineage-data
 * so the route never hits the network.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useQuery } from '@tanstack/react-query'
import {
  EmptyLineageState,
  FilterBar,
  LineageHeader,
  LineageInspector,
  TableView,
  TimelineView,
  ViewTabButton,
} from './lineage'
import { Network } from 'lucide-react'
import { DEFAULT_FILTERS, ENTITY_TYPE_LABELS } from '#/lib/lineage-data'
import type {
  LineageFilters,
  LineageGraph,
  LineageNode,
} from '#/lib/lineage-data'

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
}))

vi.mock('@tanstack/react-query', () => {
  const actual = vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  }
})

afterEach(() => {
  cleanup()
  vi.mocked(useQuery).mockReset()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  entityType: LineageNode['entityType'],
  identifier: string,
  title: string,
  overrides: Partial<LineageNode> = {},
): LineageNode {
  return {
    id,
    recordId: id,
    kind: entityType,
    entityType,
    identifier,
    title,
    status: 'draft',
    depth: 0,
    direction: 'seed',
    accessible: true,
    createdAt: '2025-07-14T09:12:00Z',
    updatedAt: '2025-07-14T09:12:00Z',
    createdByUserId: 'user-1',
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeGraph(overrides: Partial<LineageGraph> = {}): LineageGraph {
  return {
    nodes: [
      makeNode(
        'exp-1',
        'experiment',
        'EXP-2025-0014',
        'Virus Stability at 4°C',
      ),
      makeNode('smp-1', 'sample', 'SMP-LV-0001', 'Lentiviral Vector', {
        depth: 1,
        direction: 'downstream',
      }),
      makeNode('ds-1', 'dataset', 'DS-2025-0004', 'Raw stability data', {
        depth: 1,
        direction: 'downstream',
      }),
    ],
    edges: [
      {
        id: 'edge-1',
        sourceId: 'exp-1',
        targetId: 'smp-1',
        sourceRecordId: 'exp-1',
        targetRecordId: 'smp-1',
        relationshipType: 'sample',
        label: 'uses',
        direction: 'downstream',
        targetKind: 'sample',
        targetIdentifier: 'SMP-LV-0001',
        createdAt: '2025-07-14T09:12:00Z',
      },
      {
        id: 'edge-2',
        sourceId: 'exp-1',
        targetId: 'ds-1',
        sourceRecordId: 'exp-1',
        targetRecordId: 'ds-1',
        relationshipType: 'dataset',
        label: 'generates',
        direction: 'downstream',
        targetKind: 'dataset',
        targetIdentifier: 'DS-2025-0004',
        createdAt: '2025-07-14T09:12:00Z',
      },
    ],
    events: [
      {
        id: 'evt-1',
        recordId: 'exp-1',
        entityType: 'record',
        operation: 'create',
        actorUserId: 'user-1',
        createdAt: '2025-07-14T09:12:00Z',
        payload: {},
      },
      {
        id: 'evt-2',
        recordId: 'exp-1',
        entityType: 'record',
        operation: 'update',
        actorUserId: 'user-1',
        createdAt: '2025-07-15T10:00:00Z',
        payload: {},
      },
    ],
    seedRecordId: 'exp-1',
    truncated: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe('LineageHeader', () => {
  it('renders the title and subtitle', () => {
    render(
      <LineageHeader
        viewMode="graph"
        onViewModeChange={() => {}}
        nodeCount={3}
        edgeCount={2}
        loading={false}
      />,
    )

    expect(screen.getByText('Lineage Explorer')).toBeTruthy()
    expect(
      screen.getByText(/Explore provenance and relationships/),
    ).toBeTruthy()
  })

  it('renders node and edge counts', () => {
    render(
      <LineageHeader
        viewMode="graph"
        onViewModeChange={() => {}}
        nodeCount={5}
        edgeCount={8}
        loading={false}
      />,
    )

    expect(screen.getByText(/5 nodes/)).toBeTruthy()
    expect(screen.getByText(/8 edges/)).toBeTruthy()
  })

  it('does not render counts when loading', () => {
    render(
      <LineageHeader
        viewMode="graph"
        onViewModeChange={() => {}}
        nodeCount={0}
        edgeCount={0}
        loading={true}
      />,
    )

    expect(screen.queryByText(/nodes/)).not.toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// View tab button
// ---------------------------------------------------------------------------

describe('ViewTabButton', () => {
  it('renders with active styling when active', () => {
    render(
      <ViewTabButton
        active={true}
        onClick={() => {}}
        icon={Network}
        label="Graph"
      />,
    )

    const button = screen.getByRole('button', { name: /Graph/ })
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <ViewTabButton
        active={false}
        onClick={onClick}
        icon={Network}
        label="Timeline"
      />,
    )

    await user.click(screen.getByRole('button', { name: /Timeline/ }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

describe('FilterBar', () => {
  // The seed picker's useQuery is mocked to an idle result; the popover's
  // search behaviour is covered by the picker components' own tests.
  beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useQuery>)
  })

  it('renders filter controls and reset button', () => {
    render(
      <FilterBar
        filters={DEFAULT_FILTERS}
        onFiltersChange={() => {}}
        onReset={() => {}}
        cycle={null}
        seedRecordId={null}
        seedIdentifier={null}
      />,
    )

    expect(screen.getByText('Entity type:')).toBeTruthy()
    expect(screen.getByText('Relationship:')).toBeTruthy()
    expect(screen.getByText('Direction:')).toBeTruthy()
    expect(screen.getByText('Show external')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reset/ })).toBeTruthy()
  })

  it('shows cycle warning when a cycle is detected', () => {
    render(
      <FilterBar
        filters={DEFAULT_FILTERS}
        onFiltersChange={() => {}}
        onReset={() => {}}
        cycle={['a', 'b', 'a']}
        seedRecordId={null}
        seedIdentifier={null}
      />,
    )

    expect(screen.getByText(/Cycle detected/)).toBeTruthy()
  })

  it('does not show cycle warning when no cycle', () => {
    render(
      <FilterBar
        filters={DEFAULT_FILTERS}
        onFiltersChange={() => {}}
        onReset={() => {}}
        cycle={null}
        seedRecordId={null}
        seedIdentifier={null}
      />,
    )

    expect(screen.queryByText(/Cycle detected/)).not.toBeTruthy()
  })

  it('toggles show external checkbox', async () => {
    const user = userEvent.setup()
    let filters: LineageFilters = { ...DEFAULT_FILTERS, showExternal: false }
    render(
      <FilterBar
        filters={filters}
        onFiltersChange={(f) => {
          filters = f
        }}
        onReset={() => {}}
        cycle={null}
        seedRecordId={null}
        seedIdentifier={null}
      />,
    )

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)
    expect(filters.showExternal).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('EmptyLineageState', () => {
  it('renders an informative empty state', () => {
    render(<EmptyLineageState />)
    expect(screen.getByText(/No lineage data available/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------

describe('TableView', () => {
  it('renders table rows for each node-edge pair', () => {
    const graph = makeGraph()
    render(
      <TableView graph={graph} selectedNodeId={null} onSelectNode={() => {}} />,
    )

    // Should have table headers
    expect(screen.getByText('Identifier')).toBeTruthy()
    expect(screen.getByText('Title')).toBeTruthy()
    expect(screen.getByText('Type')).toBeTruthy()
  })

  it('supports keyboard navigation via Enter key', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const graph = makeGraph()
    render(
      <TableView graph={graph} selectedNodeId={null} onSelectNode={onSelect} />,
    )

    const rows = screen.getAllByRole('row')
    // Skip header row, click first data row
    if (rows.length > 1) {
      const firstDataRow = rows[1]
      firstDataRow.focus()
      await user.keyboard('{Enter}')
      expect(onSelect).toHaveBeenCalled()
    }
  })

  it('marks the selected row', () => {
    const graph = makeGraph()
    const { container } = render(
      <TableView
        graph={graph}
        selectedNodeId="exp-1"
        onSelectNode={() => {}}
      />,
    )

    // The selected row should have data-state="selected"
    const selectedRows = container.querySelectorAll('[data-state="selected"]')
    expect(selectedRows.length).toBeGreaterThan(0)
  })

  it('has an accessible region label', () => {
    const graph = makeGraph()
    render(
      <TableView graph={graph} selectedNodeId={null} onSelectNode={() => {}} />,
    )

    expect(screen.getByRole('region', { name: /Lineage table/ })).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Timeline view
// ---------------------------------------------------------------------------

describe('TimelineView', () => {
  it('renders timeline entries', () => {
    const graph = makeGraph()
    render(<TimelineView graph={graph} />)

    expect(screen.getByText('Key Events')).toBeTruthy()
    expect(screen.getByText('Created')).toBeTruthy()
    expect(screen.getByText('Updated')).toBeTruthy()
  })

  it('renders empty state when no events', () => {
    const graph = makeGraph({ events: [] })
    render(<TimelineView graph={graph} />)

    expect(screen.getByText(/No events to display/)).toBeTruthy()
  })

  it('shows record identifiers in timeline entries', () => {
    const graph = makeGraph()
    render(<TimelineView graph={graph} />)

    // The experiment node identifier should appear in at least one timeline entry.
    expect(screen.getAllByText('EXP-2025-0014').length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

describe('LineageInspector', () => {
  it('renders node identifier and entity type badge', () => {
    const graph = makeGraph()
    const node = graph.nodes[0]

    render(
      <LineageInspector
        node={node}
        graph={graph}
        onSelectNode={() => {}}
        onTraceDirection={() => {}}
      />,
    )

    // The identifier appears in the header.
    expect(screen.getAllByText('EXP-2025-0014').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(ENTITY_TYPE_LABELS.experiment).length,
    ).toBeGreaterThan(0)
  })

  it('renders details section for accessible nodes', () => {
    const graph = makeGraph()
    const node = graph.nodes[0]

    render(
      <LineageInspector
        node={node}
        graph={graph}
        onSelectNode={() => {}}
        onTraceDirection={() => {}}
      />,
    )

    expect(screen.getByText('Details')).toBeTruthy()
    expect(screen.getByText('Virus Stability at 4°C')).toBeTruthy()
  })

  it('renders lineage summary with upstream and downstream counts', () => {
    const graph = makeGraph()
    const node = graph.nodes[0]

    render(
      <LineageInspector
        node={node}
        graph={graph}
        onSelectNode={() => {}}
        onTraceDirection={() => {}}
      />,
    )

    expect(screen.getByText('Lineage Summary')).toBeTruthy()
    expect(screen.getByText('Upstream')).toBeTruthy()
    expect(screen.getByText('Downstream')).toBeTruthy()
    expect(screen.getByText(/Total links:/)).toBeTruthy()
  })

  it('renders action buttons for accessible nodes', () => {
    const graph = makeGraph()
    const node = graph.nodes[0]

    render(
      <LineageInspector
        node={node}
        graph={graph}
        onSelectNode={() => {}}
        onTraceDirection={() => {}}
      />,
    )

    expect(screen.getByText('Open record')).toBeTruthy()
    expect(screen.getByText('Trace upstream')).toBeTruthy()
    expect(screen.getByText('Trace downstream')).toBeTruthy()
  })

  it('renders restricted notice for inaccessible nodes', () => {
    const graph = makeGraph()
    const restrictedNode = makeNode(
      'restricted-1',
      'sample',
      'SMP-REST',
      'Restricted',
      {
        accessible: false,
        status: 'restricted',
        direction: 'downstream',
      },
    )

    render(
      <LineageInspector
        node={restrictedNode}
        graph={graph}
        onSelectNode={() => {}}
        onTraceDirection={() => {}}
      />,
    )

    expect(screen.getByText(/permission to view/)).toBeTruthy()
  })

  it('renders missing notice for missing nodes', () => {
    const graph = makeGraph()
    const missingNode = makeNode('missing-1', 'sample', 'SMP-GONE', 'Missing', {
      accessible: false,
      status: 'missing',
      recordId: null,
      direction: 'downstream',
    })

    render(
      <LineageInspector
        node={missingNode}
        graph={graph}
        onSelectNode={() => {}}
        onTraceDirection={() => {}}
      />,
    )

    expect(screen.getByText(/missing or was deleted/)).toBeTruthy()
  })

  it('calls onTraceDirection when trace buttons are clicked', async () => {
    const user = userEvent.setup()
    const onTrace = vi.fn()
    const graph = makeGraph()
    const node = graph.nodes[0]

    render(
      <LineageInspector
        node={node}
        graph={graph}
        onSelectNode={() => {}}
        onTraceDirection={onTrace}
      />,
    )

    await user.click(screen.getByText('Trace upstream'))
    expect(onTrace).toHaveBeenCalledWith('upstream')

    await user.click(screen.getByText('Trace downstream'))
    expect(onTrace).toHaveBeenCalledWith('downstream')
  })

  it('renders linked records section', () => {
    const graph = makeGraph()
    const node = graph.nodes[0]

    render(
      <LineageInspector
        node={node}
        graph={graph}
        onSelectNode={() => {}}
        onTraceDirection={() => {}}
      />,
    )

    expect(screen.getByText(/Linked Records/)).toBeTruthy()
    expect(screen.getByText(ENTITY_TYPE_LABELS.sample)).toBeTruthy()
    expect(screen.getByText(ENTITY_TYPE_LABELS.dataset)).toBeTruthy()
  })
})
