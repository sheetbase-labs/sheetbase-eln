import { describe, expect, it } from 'vitest'

import {
  datasetPath,
  notebookTemplatePath,
  objectContextBreadcrumbs,
  projectPath,
  recordDestination,
  recordPath,
  searchResultDestination,
  sheetPath,
} from './navigation'

describe('canonical navigation destinations', () => {
  it('keeps project and working-object identity in stable UUID paths', () => {
    expect(projectPath('project-id')).toBe('/projects/project-id')
    expect(recordPath('record-id')).toBe('/records/record-id')
    expect(sheetPath('sheet-id')).toBe('/sheets/sheet-id')
    expect(datasetPath('dataset-id')).toBe('/datasets?dataset=dataset-id')
  })

  it('routes workspace catalogue records to their owning surface', () => {
    expect(recordDestination('sample', 'sample-id')).toBe(
      '/samples/sample-id',
    )
    expect(recordDestination('material', 'material-id')).toBe(
      '/materials/material-id',
    )
    expect(recordDestination('protocol_template', 'protocol-id')).toBe(
      '/templates?protocol=protocol-id',
    )
  })

  it('routes notebook-backed records by record ID, not mutable placement', () => {
    for (const kind of ['experiment', 'study', 'report', 'file']) {
      expect(recordDestination(kind, 'record-id')).toBe('/records/record-id')
    }
  })

  it('distinguishes canonical versioned templates from legacy template records', () => {
    expect(notebookTemplatePath('template-id')).toBe(
      '/templates?template=template-id',
    )
    expect(searchResultDestination('template', 'template-id')).toBe(
      '/templates?template=template-id',
    )
    expect(searchResultDestination('record', 'record-id')).toBe(
      '/records/record-id',
    )
  })

  it('encodes IDs without depending on display labels', () => {
    expect(recordPath('stable/id')).toBe('/records/stable%2Fid')
  })

  it('keeps comment identity separate from its visible live or frozen owner', () => {
    const comment = '56000000-0000-4000-8000-000000000041'
    const owner = '56000000-0000-4000-8000-000000000042'
    for (const destination of [
      `/sheets/${owner}?commentId=${comment}`,
      `/review/${owner}?tab=comments&commentId=${comment}`,
    ]) {
      expect(searchResultDestination('comment', comment, destination)).toBe(
        destination,
      )
    }
  })

  it('rejects comment links with missing, foreign, mismatched or invented context', () => {
    const comment = '56000000-0000-4000-8000-000000000041'
    const owner = '56000000-0000-4000-8000-000000000042'
    for (const destination of [
      undefined,
      `https://example.test/sheets/${owner}?commentId=${comment}`,
      `//example.test/sheets/${owner}?commentId=${comment}`,
      `javascript:alert(1)`,
      `/records/${owner}?commentId=${comment}`,
      `/sheets/A1?commentId=${comment}`,
      `/sheets/${owner}?commentId=${owner}`,
      `/sheets/${owner}?commentId=${comment}&projectId=${owner}`,
      `/review/${owner}?tab=diff&commentId=${comment}`,
      `/review/${owner}?commentId=${comment}`,
    ]) {
      expect(() =>
        searchResultDestination('comment', comment, destination),
      ).toThrow()
    }
  })
})

describe('object context breadcrumbs (NAV-02)', () => {
  it('derives sheet context from the instance stable IDs, not history', () => {
    expect(
      objectContextBreadcrumbs({
        objectLabel: 'Purification sheet',
        project: { id: 'project-1', title: 'Lentivector Purification' },
        owningRecord: { id: 'record-1', title: 'Run 042' },
      }),
    ).toEqual([
      { label: 'Home', to: '/' },
      { label: 'Projects', to: '/projects' },
      { label: 'Lentivector Purification', to: '/projects/project-1' },
      { label: 'Run 042', to: '/records/record-1' },
      { label: 'Purification sheet' },
    ])
  })

  it('keeps partial context resolvable', () => {
    expect(
      objectContextBreadcrumbs({
        objectLabel: 'Sheet',
        project: { id: 'project-1', title: 'Assays' },
        owningRecord: null,
      }),
    ).toEqual([
      { label: 'Home', to: '/' },
      { label: 'Projects', to: '/projects' },
      { label: 'Assays', to: '/projects/project-1' },
      { label: 'Sheet' },
    ])
  })

  it('falls back to plane-only crumbs without context IDs', () => {
    expect(objectContextBreadcrumbs({ objectLabel: 'Sheet' })).toEqual([
      { label: 'Home', to: '/' },
      { label: 'Sheet' },
    ])
  })
})
