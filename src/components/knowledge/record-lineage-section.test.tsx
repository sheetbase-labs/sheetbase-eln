/**
 * KNOW-02 — per-object lineage section tests.
 *
 * The pure `RecordLineageList` renders the seeded miniature (existing table
 * representation, seed row excluded) with evidence-vs-live destinations; the
 * live `RecordLineageSection` renders the same through its query seam. The
 * standalone `/lineage` explorer was retired (SHELL-04 DEC-03), so no
 * full-explorer deep-link is rendered.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildLineageGraph } from '#/lib/lineage-data'
import type {
  RecordLinkWire,
  RecordWire,
  ReviewSubmissionWire,
} from '#/lib/lineage-data'
import {
  RecordLineageList,
  RecordLineageSection,
} from './record-lineage-section'

const SEED_ID = 'seed-id'

function makeRecord(id: string, kind: string, identifier: string): RecordWire {
  return {
    id,
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    kind,
    identifier,
    title: `${identifier} title`,
    status: 'draft',
    properties: {},
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2025-07-14T09:12:00Z',
    updated_at: '2025-07-14T09:12:00Z',
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: null,
  }
}

function makeLink(
  id: string,
  sourceId: string,
  targetId: string | null,
  targetIdentifier: string,
): RecordLinkWire {
  return {
    id,
    source_record_id: sourceId,
    target_record_id: targetId,
    target_kind: 'experiment',
    target_identifier: targetIdentifier,
    link_type: 'sample',
    link_metadata: {},
    created_at: '2025-07-14T09:12:00Z',
    created_by_user_id: 'user-1',
  }
}

function makeGraph() {
  const records = [
    makeRecord('up-id', 'sample', 'SMP-UP-1'),
    makeRecord(SEED_ID, 'experiment', 'EXP-SEED-1'),
    makeRecord('down-id', 'experiment', 'EXP-DOWN-1'),
  ]
  const links = [
    makeLink('l-up', 'up-id', SEED_ID, 'EXP-SEED-1'),
    makeLink('l-down', SEED_ID, 'down-id', 'EXP-DOWN-1'),
    // Hard-purged target: honest missing row, never a link.
    makeLink('l-gone', SEED_ID, null, 'GONE-1'),
  ]
  const reviews: ReviewSubmissionWire[] = [
    {
      id: 'sub-9',
      workspace_id: 'ws-1',
      record_id: SEED_ID,
      revision_id: 'rev-9',
      state: 'submitted',
      workflow_definition_key: 'default-scientific-review',
      workflow_definition_version: 1,
      assigned_reviewer_user_ids: [],
      submitted_by_user_id: 'user-1',
      submitted_at: '2025-07-15T09:12:00Z',
      created_at: '2025-07-15T09:12:00Z',
      updated_at: '2025-07-15T09:12:00Z',
    },
  ]
  return buildLineageGraph(records, links, reviews, [], [], [], SEED_ID, 2)
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: makeGraph(),
    isLoading: false,
    error: null,
  }),
}))

afterEach(() => {
  cleanup()
})

describe('RecordLineageList', () => {
  it('renders neighbours with live destinations and excludes the seed row', () => {
    render(<RecordLineageList graph={makeGraph()} seedRecordId={SEED_ID} />)

    expect(
      screen.getByRole('link', { name: /SMP-UP-1/ }).getAttribute('href'),
    ).toBe('/samples/up-id')
    expect(
      screen.getByRole('link', { name: /EXP-DOWN-1/ }).getAttribute('href'),
    ).toBe('/experiments/down-id')
    // The seed's own row describes the viewed object, not its lineage.
    expect(screen.queryByText('EXP-SEED-1')).toBeNull()
  })

  it('lists an object once however many links join it to the viewed record', () => {
    const records = [
      makeRecord(SEED_ID, 'dataset', 'DS-0311'),
      makeRecord('exp-id', 'experiment', 'EXP-0142'),
    ]
    const links = Array.from({ length: 20 }, (_, i) =>
      makeLink(`l-${i}`, 'exp-id', SEED_ID, 'DS-0311'),
    )
    const graph = buildLineageGraph(records, links, [], [], [], [], SEED_ID, 2)
    render(<RecordLineageList graph={graph} seedRecordId={SEED_ID} />)

    expect(screen.getAllByRole('link', { name: /EXP-0142/ })).toHaveLength(1)
    expect(screen.getByText(/· Experiment/)).toBeTruthy()
  })

  it('links submitted evidence nodes to the frozen evidence workspace', () => {
    render(<RecordLineageList graph={makeGraph()} seedRecordId={SEED_ID} />)

    expect(
      screen.getByRole('link', { name: /REV-sub-9/ }).getAttribute('href'),
    ).toBe('/review/rev-9')
  })

  it('renders missing nodes as honest text, never links', () => {
    render(<RecordLineageList graph={makeGraph()} seedRecordId={SEED_ID} />)

    const missing = screen.getByText(/GONE-1/)
    expect(missing.tagName.toLowerCase()).not.toBe('a')
    expect(missing.textContent).toContain('(missing)')
  })

  it('does not deep-link to the retired full explorer', () => {
    render(<RecordLineageList graph={makeGraph()} seedRecordId={SEED_ID} />)

    expect(screen.queryByText('Open full lineage')).toBeNull()
  })

  it('shows an empty hint when the seed has no lineage neighbours', () => {
    const solo = buildLineageGraph(
      [makeRecord(SEED_ID, 'experiment', 'EXP-SEED-1')],
      [],
      [],
      [],
      [],
      [],
      SEED_ID,
      2,
    )
    render(<RecordLineageList graph={solo} seedRecordId={SEED_ID} />)

    expect(screen.getByText('No lineage links yet')).toBeTruthy()
    expect(screen.queryByText('Open full lineage')).toBeNull()
  })
})

describe('RecordLineageSection', () => {
  it('renders the inspector section and links out', () => {
    render(<RecordLineageSection recordId={SEED_ID} />)

    expect(screen.getByText('Lineage')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /SMP-UP-1/ }).getAttribute('href'),
    ).toBe('/samples/up-id')
  })
})
