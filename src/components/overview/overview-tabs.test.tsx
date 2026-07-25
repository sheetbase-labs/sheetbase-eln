import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OverviewTabs } from './overview-tabs'
import type { NotebookBlock } from '#/lib/notebook-data'
import type { OverviewSection } from '#/lib/overview'

afterEach(() => {
  cleanup()
})

// Stub BlockPreview to avoid React Query / chart / file rendering deps.
vi.mock('#/components/notebook/block-preview', () => ({
  BlockPreview: ({ block }: { block: NotebookBlock }) => (
    <div data-testid={`block-${block.id}`}>
      {block.type}: {block.id}
    </div>
  ),
}))

// Stub tanstack Link so we don't need a full router provider in unit tests.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children?: ReactNode
    [key: string]: unknown
  }) => {
    const href = to
      .replace('$projectId', params?.projectId ?? '')
      .replace('$recordId', params?.recordId ?? '')
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))

// Stub the file-object fetcher + query keys so FilesView doesn't hit network.
vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {},
  notebookQueryKeys: {
    fileObject: (id: string) => ['notebook', 'file-object', id] as const,
  },
  fetchFileObjectByRecordId: vi.fn().mockResolvedValue(null),
}))

function makeBlock(
  overrides: Partial<NotebookBlock> & { id: string; type: string },
): NotebookBlock {
  return {
    recordId: 'r1',
    payload: {},
    payloadSchemaVersion: 1,
    order: 0,
    version: 1,
    ...overrides,
  }
}

const blocks: NotebookBlock[] = [
  makeBlock({ id: 'b1', type: 'rich_text', order: 1 }),
  makeBlock({ id: 'b2', type: 'table', order: 2 }),
  makeBlock({ id: 'b3', type: 'chart', order: 3 }),
  makeBlock({
    id: 'b4',
    type: 'file',
    order: 4,
    payload: {
      fileRecordId: 'f1',
      displayName: 'report.pdf',
      mediaType: 'application/pdf',
      byteSize: 1024,
    },
  }),
  makeBlock({ id: 'b5', type: 'metric', order: 5 }),
]

function makeSections(): OverviewSection[] {
  return [
    { id: 'notes', label: 'Notes', blocks: [blocks[0]] },
    { id: 'tables', label: 'Tables & data', blocks: [blocks[1]] },
    { id: 'visualizations', label: 'Visualizations', blocks: [blocks[2]] },
    { id: 'files', label: 'Files', blocks: [blocks[3]] },
    { id: 'metrics', label: 'Metrics', blocks: [blocks[4]] },
  ]
}

async function setup(jsx: React.ReactElement) {
  const user = userEvent.setup()
  return { user, ...renderWithQuery(jsx) }
}

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('OverviewTabs', () => {
  it('renders all four tab triggers', () => {
    renderWithQuery(
      <OverviewTabs
        sections={makeSections()}
        blocks={blocks}
        mode="active"
        excludedBlockIds={[]}
        projectId="p1"
        recordId="r1"
      />,
    )
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Results' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Files/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy()
  })

  it('shows a file count badge on the Files tab', () => {
    renderWithQuery(
      <OverviewTabs
        sections={makeSections()}
        blocks={blocks}
        mode="active"
        excludedBlockIds={[]}
        projectId="p1"
        recordId="r1"
      />,
    )
    // 1 file block -> badge "1"
    const filesTab = screen.getByRole('tab', { name: /Files/ })
    expect(filesTab.textContent).toMatch(/1/)
  })

  it('Overview tab renders the composed sections', () => {
    renderWithQuery(
      <OverviewTabs
        sections={makeSections()}
        blocks={blocks}
        mode="active"
        excludedBlockIds={[]}
        projectId="p1"
        recordId="r1"
      />,
    )
    expect(screen.getByText('Notes')).toBeTruthy()
    expect(screen.getByText('Tables & data')).toBeTruthy()
    expect(screen.getByText('Visualizations')).toBeTruthy()
  })

  it('Results tab shows only data-heavy blocks', async () => {
    const { user } = await setup(
      <OverviewTabs
        sections={makeSections()}
        blocks={blocks}
        mode="active"
        excludedBlockIds={[]}
        projectId="p1"
        recordId="r1"
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'Results' }))
    // data blocks: b2 (table), b3 (chart), b5 (metric)
    expect(screen.getByTestId('block-b2')).toBeTruthy()
    expect(screen.getByTestId('block-b3')).toBeTruthy()
    expect(screen.getByTestId('block-b5')).toBeTruthy()
    // notes (b1) and file (b4) should not be present in Results
    expect(screen.queryByTestId('block-b1')).toBeNull()
    expect(screen.queryByTestId('block-b4')).toBeNull()
  })

  it('Results tab shows empty state when no data blocks', async () => {
    const { user } = await setup(
      <OverviewTabs
        sections={[{ id: 'notes', label: 'Notes', blocks: [blocks[0]] }]}
        blocks={[blocks[0]]}
        mode="active"
        excludedBlockIds={[]}
        projectId="p1"
        recordId="r1"
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'Results' }))
    expect(screen.getByText('No results yet')).toBeTruthy()
  })

  it('Files tab shows empty state when no file blocks', async () => {
    const { user } = await setup(
      <OverviewTabs
        sections={[{ id: 'notes', label: 'Notes', blocks: [blocks[0]] }]}
        blocks={[blocks[0]]}
        mode="active"
        excludedBlockIds={[]}
        projectId="p1"
        recordId="r1"
      />,
    )
    await user.click(screen.getByRole('tab', { name: /Files/ }))
    expect(screen.getByText('No files')).toBeTruthy()
  })

  it('Activity tab shows coming-soon placeholder', async () => {
    const { user } = await setup(
      <OverviewTabs
        sections={makeSections()}
        blocks={blocks}
        mode="active"
        excludedBlockIds={[]}
        projectId="p1"
        recordId="r1"
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(screen.getByText('Activity feed coming soon')).toBeTruthy()
  })

  it('block controls include expand and open-in-notebook in active mode', () => {
    renderWithQuery(
      <OverviewTabs
        sections={makeSections()}
        blocks={blocks}
        mode="active"
        excludedBlockIds={[]}
        projectId="p1"
        recordId="r1"
      />,
    )
    expect(screen.getAllByLabelText('Expand block').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('Open in notebook').length).toBeGreaterThan(
      0,
    )
  })

  it('table blocks show an "Open full table" link', () => {
    renderWithQuery(
      <OverviewTabs
        sections={makeSections()}
        blocks={blocks}
        mode="active"
        excludedBlockIds={[]}
        projectId="p1"
        recordId="r1"
      />,
    )
    expect(screen.getByText('Open full table')).toBeTruthy()
  })
})
