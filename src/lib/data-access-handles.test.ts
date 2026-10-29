import { describe, expect, it } from 'vitest'

import {
  apiRoute,
  dataAccessSnippets,
  pgIdentifier,
  reportingColumnName,
  reportingViewName,
  resolveDataAccessHandle,
} from './data-access-handles'
import { canUseDataAccess } from './data-access'

const uuid = '3f1c8c0e-2a34-4d6e-9b8a-1c2d3e4f5a6b'

describe('data-access names', () => {
  it('spells keys the way Postgres does', () => {
    expect(pgIdentifier('Cell-culture.v2')).toBe('cell_culture_v2')
    expect(pgIdentifier('seedDensity')).toBe('seed_density')
    expect(pgIdentifier('2nd_pass')).toBe('m_2nd_pass')
    expect(reportingViewName('protocol_template')).toBe(
      'data.protocol_templates',
    )
    expect(reportingViewName('cell_culture')).toBe('data.cell_culture')
    expect(reportingColumnName(null, 'Seed Density')).toBe('seed_density')
  })

  it('prefers the names the database reports', () => {
    const names = {
      viewName: (key: string) =>
        key === 'experiment' ? 'experiments_000300' : undefined,
      columnName: (model: string, field: string) =>
        model === 'experiment' && field === 'seedDensity'
          ? 'seed_density_2'
          : undefined,
    }
    expect(reportingViewName('experiment', names)).toBe(
      'data.experiments_000300',
    )
    expect(reportingColumnName('experiment', 'seedDensity', names)).toBe(
      'seed_density_2',
    )
    expect(resolveDataAccessHandle('/experiments', names)?.relation).toBe(
      'data.experiments_000300',
    )
  })
})

describe('resolveDataAccessHandle', () => {
  it('describes a list with its current filters', () => {
    const handle = resolveDataAccessHandle(
      '/experiments?status=running,review&q=gfp',
    )!
    expect(handle.scope).toBe('list')
    expect(apiRoute(handle)).toBe(
      '/api/db/records?kind=eq.experiment&status=in.(running,review)&title=ilike.*gfp*',
    )
    expect(handle.where).toEqual([
      "status IN ('running', 'review')",
      "title ILIKE '%gfp%'",
    ])
    expect(handle.relation).toBe('data.experiments')
  })

  it('fetches one record by id or by display ID', () => {
    expect(apiRoute(resolveDataAccessHandle(`/experiments/${uuid}`)!)).toBe(
      `/api/db/records?id=eq.${uuid}`,
    )
    const byDisplay = resolveDataAccessHandle('/samples/SMP-2026-0001/history')!
    expect(apiRoute(byDisplay)).toBe(
      '/api/db/records?identifier=eq.SMP-2026-0001',
    )
    expect(byDisplay.relation).toBe('data.samples')
    expect(byDisplay.where).toEqual(["display_id = 'SMP-2026-0001'"])
  })

  it('gives a model page the model key and its view', () => {
    const handle = resolveDataAccessHandle('/models/cell_culture/fields')!
    expect(handle.scope).toBe('model')
    expect(handle.modelKey).toBe('cell_culture')
    expect(handle.relation).toBe('data.cell_culture')
  })

  it('reads datasets and projects from their own tables', () => {
    expect(resolveDataAccessHandle(`/datasets/${uuid}`)?.scope).toBe('dataset')
    expect(resolveDataAccessHandle('/datasets')?.relation).toBe('api.datasets')
    expect(resolveDataAccessHandle('/projects')?.relation).toBe('data.projects')
  })

  it('has nothing for pages without data handles', () => {
    expect(resolveDataAccessHandle('/settings/api')).toBeNull()
    expect(resolveDataAccessHandle('/')).toBeNull()
    expect(resolveDataAccessHandle('/experiments/new')).toBeNull()
  })

  it('adds a Python SDK snippet where the SDK has a matching call', () => {
    const sdkOf = (href: string) =>
      dataAccessSnippets(resolveDataAccessHandle(href)!, 'https://x.test').find(
        (snippet) => snippet.id === 'sdk',
      )
    const list = sdkOf('/experiments')!
    expect(list.label).toBe('Python SDK')
    expect(list.code).toContain('base_url="https://x.test"')
    expect(list.code).toContain('scopes=["records:read"]')
    expect(list.code).toContain(
      'rows = client.records.list(kind="experiment", limit=50)',
    )
    expect(
      sdkOf('/experiments/00000000-0000-4000-8000-000000000350')?.code,
    ).toContain('client.records.get("00000000-0000-4000-8000-000000000350")')
    expect(sdkOf('/datasets')?.code).toContain('client.datasets.list(limit=50)')
    // Filters the SDK's list call cannot express leave the tab out.
    expect(sdkOf('/samples?q=a')).toBeUndefined()
    expect(sdkOf('/models')).toBeUndefined()
  })

  it('escapes quotes in SQL snippets', () => {
    const handle = resolveDataAccessHandle("/samples/O'Neil")!
    const sql = dataAccessSnippets(handle, 'https://x.test').at(-1)!
    expect(sql.code).toContain("display_id = 'O''Neil'")
  })
})

describe('canUseDataAccess', () => {
  it('follows the enabled roles and never includes client viewers', () => {
    expect(canUseDataAccess('steward')).toBe(true)
    expect(canUseDataAccess('scientist')).toBe(false)
    expect(canUseDataAccess('client_viewer', ['client_viewer'])).toBe(false)
    expect(canUseDataAccess('analyst', ['steward', 'analyst'])).toBe(true)
    expect(canUseDataAccess(null)).toBe(false)
  })
})
