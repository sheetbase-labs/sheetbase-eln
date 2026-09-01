import { describe, expect, it } from 'vitest'

import {
  datasetPath,
  notebookTemplatePath,
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
      '/samples?selected=sample-id',
    )
    expect(recordDestination('reagent', 'reagent-id')).toBe(
      '/reagents?selected=reagent-id',
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
    expect(
      searchResultDestination('template', 'notebook_template', 'template-id'),
    ).toBe('/templates?template=template-id')
    expect(
      searchResultDestination('record', 'notebook_template', 'record-id'),
    ).toBe('/records/record-id')
  })

  it('encodes IDs without depending on display labels', () => {
    expect(recordPath('stable/id')).toBe('/records/stable%2Fid')
  })
})
