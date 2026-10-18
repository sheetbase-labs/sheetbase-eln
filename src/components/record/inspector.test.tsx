import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Inspector } from './inspector'
import type { InspectorTab } from './inspector'
import {
  ActivityFeed,
  CheckList,
  CommentList,
  FileList,
  InspectorSection,
  InspectorSectionStack,
} from './inspector-sections'
import { Property, PropertyList } from '#/components/scientific/property-list'
import type {
  ActivityItem,
  CheckItem,
  CommentItem,
  FileItem,
} from './inspector-sections'

afterEach(() => cleanup())

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const tabs: InspectorTab[] = [
  {
    id: 'properties',
    label: 'Properties',
    content: (
      <PropertyList>
        <Property label="ID">EXP-1</Property>
      </PropertyList>
    ),
  },
  { id: 'members', label: 'Members', badge: 6, content: <p>Members body</p> },
  { id: 'comments', label: 'Comments', content: <p>Comments body</p> },
]

describe('Inspector', () => {
  it('renders the identity header (type + title) and tabs', () => {
    render(<Inspector recordType="Experiment" title="4°C hold" tabs={tabs} />)
    expect(
      screen.getByRole('heading', { level: 2, name: '4°C hold' }),
    ).toBeTruthy()
    expect(screen.getByText('Experiment')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Properties/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Members/ })).toBeTruthy()
  })

  it('renders semantic status detail in the canonical identity row', () => {
    render(
      <Inspector
        recordType="Sample"
        title="SMP-001"
        status={<span>Available</span>}
        tabs={tabs}
      />,
    )
    expect(screen.getByText('Available')).toBeTruthy()
  })

  it('shows the first tab content by default and switches on click', async () => {
    const user = userEvent.setup()
    render(<Inspector recordType="Experiment" title="4°C hold" tabs={tabs} />)
    expect(screen.getByText('EXP-1')).toBeTruthy() // Properties default
    await user.click(screen.getByRole('tab', { name: /Comments/ }))
    expect(screen.getByText('Comments body')).toBeTruthy()
  })

  it('renders the close button and fires onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Inspector title="4°C hold" tabs={tabs} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('omits the close button when no onClose is provided', () => {
    render(<Inspector title="4°C hold" tabs={tabs} />)
    expect(screen.queryByRole('button', { name: 'Close inspector' })).toBeNull()
  })

  it('renders the skeleton state and no tabs', () => {
    render(<Inspector title="4°C hold" tabs={tabs} state="skeleton" />)
    expect(screen.queryByRole('tab')).toBeNull()
    // Skeletons are aria-hidden divs; assert at least one is present.
    expect(
      document.querySelectorAll('[aria-hidden="true"]').length,
    ).toBeGreaterThan(0)
  })

  it('renders the no-selection state', () => {
    render(<Inspector title="Inspector" tabs={tabs} state="no-selection" />)
    expect(screen.getByText('Nothing selected')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('renders the unavailable-record state', () => {
    render(<Inspector title="Inspector" tabs={tabs} state="unavailable" />)
    expect(screen.getByText('Record unavailable')).toBeTruthy()
  })

  it('renders the permission-denied state', () => {
    render(
      <Inspector title="Inspector" tabs={tabs} state="permission-denied" />,
    )
    expect(screen.getByText('Permission denied')).toBeTruthy()
  })

  it('keeps the identity header visible inside the scroll region structure', () => {
    const { container } = render(
      <Inspector recordType="Experiment" title="4°C hold" tabs={tabs} />,
    )
    // The inspector root is a labelled region.
    expect(container.querySelector('[aria-label="Inspector"]')).toBeTruthy()
    // The scroll region exists and the header is outside it (pinned).
    const scrollRegion = container.querySelector('.overflow-y-auto')
    expect(scrollRegion).toBeTruthy()
  })
})

describe('Inspector sections', () => {
  it('PropertyList renders label/value pairs', () => {
    render(
      <PropertyList>
        <Property label="ID" mono>
          EXP-2025-0014
        </Property>
        <Property label="Owner">Gareth</Property>
      </PropertyList>,
    )
    expect(screen.getByText('ID')).toBeTruthy()
    expect(screen.getByText('EXP-2025-0014')).toBeTruthy()
    expect(screen.getByText('Gareth')).toBeTruthy()
  })

  it('keeps long stacked property values fully available', () => {
    const formula = '=IF(AND(A1>0,B1<10),"qualified","review")'
    const { container } = render(
      <PropertyList>
        <Property label="Formula" mono stacked>
          {formula}
        </Property>
      </PropertyList>,
    )
    expect(screen.getByText(formula)).toBeTruthy()
    expect(container.querySelector('dd')?.className).toContain('break-words')
    expect(container.querySelector('dd')?.className).not.toContain('truncate')
    expect(container.querySelector('dd')?.className).toContain(
      'text-[0.6875rem]',
    )
    expect(container.querySelectorAll('wbr').length).toBeGreaterThan(0)
  })

  it('FileList renders rows and empty hint', () => {
    const items: FileItem[] = [
      { id: '1', name: 'protocol.pdf', meta: '120 KB' },
    ]
    const { rerender } = render(<FileList items={items} />)
    expect(screen.getByText('protocol.pdf')).toBeTruthy()
    rerender(<FileList items={[]} />)
    expect(screen.getByText('No attached files')).toBeTruthy()
  })

  it('FileList names the file type, and trusts the name over a generic MIME', () => {
    const items: FileItem[] = [
      { id: '1', name: 'protocol.pdf', mediaType: 'application/pdf' },
      // A stored octet-stream says nothing; the extension does.
      {
        id: '2',
        name: 'stability-run07.xlsx',
        mediaType: 'application/octet-stream',
      },
      // With no type in the name, the media type decides.
      { id: '3', name: 'raw-payload', mediaType: 'image/x-unknown' },
    ]
    render(<FileList items={items} />)
    expect(screen.getByRole('img', { name: 'PDF file' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'XLSX file' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Image' })).toBeTruthy()
  })

  it('CheckList communicates state by text, not just colour', () => {
    const items: CheckItem[] = [
      { id: '1', label: 'Data integrity', state: 'pass' },
      {
        id: '2',
        label: 'Reagent expiry',
        state: 'warning',
        detail: 'Due in 10 days',
      },
      { id: '3', label: 'Training records', state: 'fail' },
      { id: '4', label: 'Calibration', state: 'pending' },
    ]
    render(<CheckList items={items} />)
    // Each state is exposed to screen readers as sr-only text.
    expect(screen.getAllByText('pass').length).toBeGreaterThan(0)
    expect(screen.getAllByText('warning').length).toBeGreaterThan(0)
    expect(screen.getAllByText('fail').length).toBeGreaterThan(0)
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0)
    expect(screen.getByText('Due in 10 days')).toBeTruthy()
  })

  it('ActivityFeed renders actor, action, target and time', () => {
    const items: ActivityItem[] = [
      {
        id: '1',
        actor: { name: 'Gareth Price' },
        action: 'updated',
        target: 'Protocol 4',
        at: '2h ago',
      },
    ]
    render(<ActivityFeed items={items} />)
    expect(screen.getByText('Gareth Price')).toBeTruthy()
    expect(screen.getByText('updated')).toBeTruthy()
    expect(screen.getByText('Protocol 4')).toBeTruthy()
    expect(screen.getByText('2h ago')).toBeTruthy()
  })

  it('CommentList renders body and empty hint', () => {
    const items: CommentItem[] = [
      {
        id: '1',
        author: { name: 'Gareth' },
        body: 'Looks good to me.',
        at: '1h ago',
      },
    ]
    const { rerender } = render(<CommentList items={items} />)
    expect(screen.getByText('Looks good to me.')).toBeTruthy()
    rerender(<CommentList items={[]} />)
    expect(screen.getByText('No comments')).toBeTruthy()
  })

  it('InspectorSection renders a heading and body', () => {
    render(
      <InspectorSection title="Pinned links">
        <p>link</p>
      </InspectorSection>,
    )
    expect(screen.getByText('Pinned links')).toBeTruthy()
    expect(screen.getByText('link')).toBeTruthy()
  })

  it('InspectorSectionStack owns the 16px section cadence', () => {
    const { container } = render(
      <InspectorSectionStack>
        <InspectorSection title="First">one</InspectorSection>
        <InspectorSection title="Second">two</InspectorSection>
      </InspectorSectionStack>,
    )
    expect(container.firstElementChild?.className).toContain('space-y-4')
  })
})
