/**
 * REV-006 review inbox route tests: inspector states (overdue, withdrawn,
 * no-selection), registry integration (rows, keyboard selection, empty,
 * permission-denied, no-results) and summary derivation. The route module's
 * router/start seams are mocked so the exported presentational pieces can be
 * rendered without a server or database.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RegistryComposition } from '#/components/registry/registry-composition'
import type { RegistryCompositionProps } from '#/components/registry/registry-composition'
import type { RegistryQuery } from '#/lib/registry'
import { toReviewItem, workflowStepsFor } from '#/lib/reviews'
import type { ReviewItem, ReviewSubmissionWire } from '#/lib/reviews'
import type { RecordWire } from '#/lib/notebook-data'

import {
  buildReviewSummaries,
  ReviewInspector,
  buildReviewColumns,
} from './reviews'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {}))
      href = href.replace(`$${key}`, encodeURIComponent(value))
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: () => ({ handler: () => vi.fn() }) }),
}))

// jsdom does not implement ResizeObserver; radix UI reads it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function submission(
  overrides: Partial<ReviewSubmissionWire> = {},
): ReviewSubmissionWire {
  return {
    id: 'sub-1',
    workspace_id: 'ws-1',
    record_id: 'rec-1',
    revision_id: 'rev-1',
    state: 'submitted',
    workflow_definition_key: 'default-scientific-review',
    workflow_definition_version: 1,
    assigned_reviewer_user_ids: ['reviewer-a'],
    submitted_by_user_id: 'owner-a',
    submitted_session_id: 'session-owner-a',
    submitted_role: 'authenticated',
    submitted_at: new Date().toISOString(),
    idempotency_key: 'idem-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function record(overrides: Partial<RecordWire> = {}): RecordWire {
  return {
    id: 'rec-1',
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    folder_id: null,
    kind: 'experiment',
    identifier: 'EXP-2025-0001',
    title: 'Virus stability',
    status: 'draft',
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'owner-a',
    updated_by_user_id: null,
    properties: {},
    locked_at: null,
    locked_by_revision_id: null,
    ...overrides,
  }
}

function reviewItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  const base = toReviewItem(
    submission({
      id: overrides.id ?? 'sub-1',
      record_id: overrides.recordId ?? 'rec-1',
      state: overrides.status ?? 'submitted',
      assigned_reviewer_user_ids: overrides.assignedReviewerUserIds ?? [
        'reviewer-a',
      ],
      submitted_by_user_id: overrides.submittedByUserId ?? 'owner-a',
      submitted_at: overrides.submittedAt ?? new Date().toISOString(),
      workflow_definition_key:
        overrides.workflowDefinitionKey ?? 'default-scientific-review',
    }),
    record({
      id: overrides.recordId ?? 'rec-1',
      identifier: overrides.recordIdentifier ?? 'EXP-2025-0001',
      title: overrides.recordTitle ?? 'Virus stability',
      kind: overrides.recordKind ?? 'experiment',
      project_id: overrides.projectId ?? 'proj-1',
    }),
    overrides.projectTitle ?? 'Lentivector',
    'LV',
  )
  return base
}

const query: RegistryQuery = {
  pageIndex: 0,
  pageSize: 25,
  sorting: [],
  grouping: [],
  filters: [],
}

function inboxProps(
  overrides: Partial<RegistryCompositionProps<ReviewItem>> = {},
): RegistryCompositionProps<ReviewItem> {
  return {
    registryId: 'reviews',
    title: 'Review inbox',
    rows: [reviewItem({ id: 'sub-1' })],
    totalCount: 1,
    fields: buildReviewColumns((id) => id).map((column) => ({
      id: String(column.id),
      label: String(column.id),
      column,
      groupable: false,
    })),
    query,
    onQueryChange: vi.fn(),
    getRowId: (row) => row.id,
    selectedId: null,
    onSelectedIdChange: vi.fn(),
    renderInspector: (row) =>
      row ? (
        <ReviewInspector
          row={row}
          steps={workflowStepsFor(row.workflowDefinitionKey)}
          submitterLabel={row.submittedByUserId}
          overdue={row.isOverdue}
          userLabel={(id) => id}
          onClose={() => {}}
        />
      ) : (
        <p>No review selected</p>
      ),
    emptyTitle: 'No reviews yet',
    noResultsTitle: 'No matching reviews',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe('ReviewInspector states', () => {
  it('renders the selected review identity and current step', () => {
    const item = reviewItem()
    render(
      <ReviewInspector
        row={item}
        steps={workflowStepsFor(item.workflowDefinitionKey)}
        submitterLabel="Owner A"
        overdue={false}
        userLabel={(id) => id}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    expect(screen.getByText('Virus stability')).toBeTruthy()
    // "Scientific review" appears in both the current-step field and the
    // workflow stepper; assert it is rendered at least once.
    expect(
      screen.getAllByText('Scientific review').length,
    ).toBeGreaterThanOrEqual(1)
    // Transition actions are present but disabled (not yet supported).
    for (const name of ['Approve', 'Changes', 'Reassign']) {
      expect(
        screen.getByRole('button', { name }).hasAttribute('disabled'),
      ).toBe(true)
    }
  })

  it('surfaces an overdue notice for aging submissions', () => {
    const item = reviewItem({
      submittedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    })
    render(
      <ReviewInspector
        row={item}
        steps={workflowStepsFor(item.workflowDefinitionKey)}
        submitterLabel="Owner A"
        overdue
        userLabel={(id) => id}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/Overdue — pending for more than/)).toBeTruthy()
  })

  it('shows a withdrawn notice and disables the open-record path is still offered', () => {
    const item = reviewItem({ status: 'withdrawn' })
    render(
      <ReviewInspector
        row={item}
        steps={workflowStepsFor(item.workflowDefinitionKey)}
        submitterLabel="Owner A"
        overdue={false}
        userLabel={(id) => id}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Withdrawn')).toBeTruthy()
    expect(
      screen.getByText(/was withdrawn\. No further actions are available\./),
    ).toBeTruthy()
  })
})

describe('review inbox registry integration', () => {
  it('renders review rows with the entry, type badge and current step', () => {
    render(<RegistryComposition {...inboxProps()} />)
    const table = screen.getByRole('table', { name: 'Review inbox' })
    expect(within(table).getByText('EXP-2025-0001')).toBeTruthy()
    expect(within(table).getByText('Experiment')).toBeTruthy()
    expect(within(table).getByText('Scientific review')).toBeTruthy()
  })

  it('supports keyboard navigation and populates the inspector on Enter', () => {
    const onSelectedIdChange = vi.fn()
    const rows = [
      reviewItem({ id: 'sub-a', recordIdentifier: 'EXP-0001' }),
      reviewItem({
        id: 'sub-b',
        recordIdentifier: 'EXP-0002',
        recordId: 'rec-b',
      }),
    ]
    render(
      <RegistryComposition
        {...inboxProps({
          rows,
          totalCount: 2,
          onSelectedIdChange,
        })}
      />,
    )
    const first = screen.getByRole('row', { name: /EXP-0001/ })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    const second = screen.getByRole('row', { name: /EXP-0002/ })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'Enter' })
    expect(onSelectedIdChange).toHaveBeenCalledWith('sub-b')
  })

  it('renders the empty state when there are no reviews', () => {
    render(<RegistryComposition {...inboxProps({ rows: [], totalCount: 0 })} />)
    expect(screen.getByText('No reviews yet')).toBeTruthy()
  })

  it('renders the no-results state when filters match nothing', () => {
    render(
      <RegistryComposition
        {...inboxProps({
          rows: [],
          totalCount: 0,
          query: {
            ...query,
            filters: [
              { fieldId: 'status', operator: 'eq', values: ['withdrawn'] },
            ],
          },
        })}
      />,
    )
    expect(screen.getByText('No matching reviews')).toBeTruthy()
  })

  it('hides summaries, filters and inspector when permission is denied', () => {
    render(
      <RegistryComposition
        {...inboxProps({
          permissionDenied: true,
          actions: <button type="button">Export reviews</button>,
        })}
      />,
    )
    expect(screen.getByText('Permission denied')).toBeTruthy()
    expect(screen.queryByText('Awaiting review')).toBeNull()
    expect(screen.queryByLabelText('Filter by Status')).toBeNull()
    expect(screen.queryByLabelText('Registry inspector')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export reviews' })).toBeNull()
  })

  it('renders summary counts derived from the full review set', () => {
    const items = [
      reviewItem({ id: 'sub-a', assignedReviewerUserIds: ['me'] }),
      reviewItem({
        id: 'sub-b',
        assignedReviewerUserIds: ['other'],
        submittedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
      }),
      reviewItem({ id: 'sub-c', status: 'withdrawn' }),
    ]
    const summaries = buildReviewSummaries(items, 'me')
    const byLabel = new Map(summaries.map((s) => [s.label, s.value]))
    expect(byLabel.get('Awaiting review')).toBe(2)
    expect(byLabel.get('Overdue')).toBe(1)
    expect(byLabel.get('My queue')).toBe(1)
    expect(byLabel.get('Withdrawn')).toBe(1)
  })
})
