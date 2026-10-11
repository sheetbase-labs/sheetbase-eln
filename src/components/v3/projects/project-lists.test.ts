/**
 * R5-SURF-02 — the project-scoped list reads.
 *
 * The point of these tests is the boundary: every read must carry the project
 * filter to PostgREST/the RPC so a page of results is never filtered in the
 * browser, and rows/counts must share one predicate.
 */
import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import {
  PROJECT_LIST_PAGE_SIZE,
  fetchProjectDatasetsPage,
  fetchProjectExperimentsPage,
  fetchProjectRecordCount,
  fetchProjectSamplesPage,
  parseProjectPage,
  projectDatasetFilter,
  projectPageSummary,
  projectRecordFilter,
} from './project-lists'

const PROJECT = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000b2'

describe('project scope predicates', () => {
  it('scopes records to the project and kind, excluding archived and deleted', () => {
    const filter = projectRecordFilter(PROJECT, 'sample')
    expect(filter).toBe(
      `project_id=eq.${PROJECT}&kind=eq.sample&archived_at=is.null&deleted_at=is.null`,
    )
    expect(filter).not.toContain(OTHER)
  })

  it('scopes datasets to the project primary column, excluding archived', () => {
    expect(projectDatasetFilter(PROJECT)).toBe(
      `primary_project_id=eq.${PROJECT}&archived_at=is.null`,
    )
  })

  it('encodes the project id so a stray separator cannot widen the filter', () => {
    expect(projectRecordFilter('a&kind=eq.experiment', 'sample')).toContain(
      'project_id=eq.a%26kind%3Deq.experiment',
    )
  })
})

describe('parseProjectPage', () => {
  it('defaults to page 1 for missing, zero or unusable values', () => {
    expect(parseProjectPage(undefined)).toBe(1)
    expect(parseProjectPage('0')).toBe(1)
    expect(parseProjectPage('-3')).toBe(1)
    expect(parseProjectPage('nope')).toBe(1)
  })

  it('accepts a positive integer page', () => {
    expect(parseProjectPage('4')).toBe(4)
    expect(parseProjectPage(7)).toBe(7)
  })
})

describe('projectPageSummary', () => {
  it('reports the 1-based rows shown and the page count', () => {
    expect(projectPageSummary(3, 60)).toEqual({
      pageCount: 3,
      start: 51,
      end: 60,
    })
  })

  it('never reports a start beyond the total when empty', () => {
    expect(projectPageSummary(1, 0)).toEqual({ pageCount: 1, start: 0, end: 0 })
  })
})

describe('fetchProjectExperimentsPage', () => {
  it('filters and pages at the boundary and counts with the same predicate', async () => {
    const rows = [
      {
        id: 'exp-1',
        project_id: PROJECT,
        identifier: 'EXP-0001',
        title: 'First',
        status: 'in_progress',
        created_by_user_id: 'u1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ]
    const list = vi.fn().mockResolvedValue(rows)
    const count = vi.fn().mockResolvedValue(31)
    const client = { list, count } as unknown as DataClient

    const page = await fetchProjectExperimentsPage(client, PROJECT, 2)

    const query = String(list.mock.calls[0][1])
    expect(list.mock.calls[0][0]).toBe('records')
    expect(query).toContain(`project_id=eq.${PROJECT}`)
    expect(query).toContain('kind=eq.experiment')
    expect(query).toContain('archived_at=is.null')
    expect(query).toContain('deleted_at=is.null')
    expect(query).not.toContain(OTHER)
    expect(query).toContain(`limit=${PROJECT_LIST_PAGE_SIZE}`)
    expect(query).toContain(`offset=${PROJECT_LIST_PAGE_SIZE}`)
    expect(count).toHaveBeenCalledWith(
      'records',
      `?${projectRecordFilter(PROJECT, 'experiment')}`,
    )
    expect(page).toEqual({ rows, total: 31, page: 2 })
  })
})

describe('fetchProjectSamplesPage', () => {
  it('maps the project’s sample records and returns the boundary total', async () => {
    const wire = {
      id: 'smp-1',
      workspace_id: 'ws',
      project_id: PROJECT,
      folder_id: null,
      kind: 'sample',
      identifier: 'SMP-0001',
      title: 'Lot A',
      status: 'available',
      tags: [],
      structure_version: 1,
      metadata_version: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      archived_at: null,
      deleted_at: null,
      created_by_user_id: 'u1',
      updated_by_user_id: null,
      properties: { sampleType: 'Serum', quantity: 4, quantityUnit: 'mL' },
      custom_fields: {},
      locked_at: null,
      locked_by_revision_id: null,
    }
    const list = vi.fn().mockResolvedValue([wire])
    const count = vi.fn().mockResolvedValue(1)
    const client = { list, count } as unknown as DataClient

    const page = await fetchProjectSamplesPage(client, PROJECT, 1)

    expect(String(list.mock.calls[0][1])).toContain('kind=eq.sample')
    expect(count).toHaveBeenCalledWith(
      'records',
      `?${projectRecordFilter(PROJECT, 'sample')}`,
    )
    expect(page.total).toBe(1)
    expect(page.rows[0]).toMatchObject({
      id: 'smp-1',
      sampleType: 'Serum',
      quantity: 4,
      quantityUnit: 'mL',
    })
  })
})

describe('fetchProjectDatasetsPage', () => {
  it('passes the project filter to the canonical RPC and counts its own column', async () => {
    const rpc = vi.fn().mockResolvedValue([
      {
        id: 'ds-1',
        display_id: 'DS-0001',
        name: 'Plate read',
        model: 'ViCell v2',
        project_id: PROJECT,
        created_by_user_id: 'u1',
        row_count: '10',
        issue_count: '0',
        out_of_range_count: '0',
        missing_unit_count: '0',
        missing_unit_fields: null,
        experiment_display_id: 'EXP-0001',
        review_state: null,
        updated_at: '2026-01-02T00:00:00Z',
        archived_at: null,
      },
    ])
    const count = vi.fn().mockResolvedValue(1)
    const client = { rpc, count } as unknown as DataClient

    const page = await fetchProjectDatasetsPage(client, PROJECT, 1)

    expect(rpc).toHaveBeenCalledWith('dataset_list_summary', {
      p_project_id: PROJECT,
      p_include_archived: false,
      p_limit: PROJECT_LIST_PAGE_SIZE,
      p_offset: 0,
    })
    expect(count).toHaveBeenCalledWith(
      'datasets',
      `?${projectDatasetFilter(PROJECT)}`,
    )
    expect(page.rows[0]).toMatchObject({
      uuid: 'ds-1',
      id: 'DS-0001',
      name: 'Plate read',
      rows: 10,
    })
  })
})

describe('counts', () => {
  it('uses the same predicate as the list for a record kind', async () => {
    const count = vi.fn().mockResolvedValue(5)
    const total = await fetchProjectRecordCount(
      { count } as unknown as DataClient,
      PROJECT,
      'sample',
    )
    expect(total).toBe(5)
    expect(count).toHaveBeenCalledWith(
      'records',
      `?${projectRecordFilter(PROJECT, 'sample')}`,
    )
  })
})
