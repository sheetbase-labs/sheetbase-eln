import { describe, expect, it } from 'vitest'

import {
  buildUpstreamUrl,
  parseProxyPath,
  sanitizeQuery,
} from './postgrest-path'

describe('parseProxyPath', () => {
  it('accepts plain table resources', () => {
    expect(parseProxyPath('projects')).toEqual({
      kind: 'table',
      resource: 'projects',
    })
  })

  it('accepts rpc resources', () => {
    expect(parseProxyPath('rpc/create_project')).toEqual({
      kind: 'rpc',
      resource: 'create_project',
    })
  })

  it('rejects traversal, schemas, dots and extra segments', () => {
    for (const bad of [
      '',
      '..',
      '../projects',
      'api.projects',
      'internal.user',
      'projects/1',
      'rpc/admin/drop',
      'Projects',
      'projects;drop',
      'rpc/../x',
    ]) {
      expect(parseProxyPath(bad), bad).toBeNull()
    }
  })
})

describe('sanitizeQuery', () => {
  it('keeps ordinary PostgREST parameters', () => {
    expect(sanitizeQuery('?select=id,title&limit=10&status=eq.active')).toBe(
      '?select=id%2Ctitle&limit=10&status=eq.active',
    )
  })

  it('drops malformed keys and oversized values', () => {
    const long = 'x'.repeat(501)
    expect(sanitizeQuery(`?select=id&bad[key]=1&other=${long}`)).toBe(
      '?select=id',
    )
  })

  it('returns an empty string when nothing survives', () => {
    expect(sanitizeQuery('?bad[key]=1')).toBe('')
    expect(sanitizeQuery('')).toBe('')
  })
})

describe('buildUpstreamUrl', () => {
  it('builds table and rpc URLs from validated pieces', () => {
    expect(
      buildUpstreamUrl(
        'http://localhost:3001',
        { kind: 'table', resource: 'projects' },
        '?limit=5',
      ),
    ).toBe('http://localhost:3001/projects?limit=5')
    expect(
      buildUpstreamUrl(
        'http://localhost:3001',
        { kind: 'rpc', resource: 'create_project' },
        '',
      ),
    ).toBe('http://localhost:3001/rpc/create_project')
  })
})
