import { describe, expect, it } from 'vitest'

import {
  buildUpstreamUrl,
  isValidScientificMutationQuery,
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

  it('rejects malformed keys and oversized values', () => {
    const long = 'x'.repeat(501)
    expect(() => sanitizeQuery('?select=id&bad[key]=1')).toThrow()
    expect(() => sanitizeQuery(`?select=id&other=${long}`)).toThrow()
  })

  it('returns an empty string when the query is empty', () => {
    expect(sanitizeQuery('')).toBe('')
  })
})

describe('isValidScientificMutationQuery', () => {
  const id = '10000000-0000-4000-8000-000000000001'

  it('requires exactly one UUID id and one positive version filter', () => {
    expect(isValidScientificMutationQuery(`?id=eq.${id}&version=eq.2`)).toBe(
      true,
    )
    expect(isValidScientificMutationQuery(`?id=eq.${id}`)).toBe(false)
    expect(
      isValidScientificMutationQuery(`?id=eq.${id}&id=eq.${id}&version=eq.2`),
    ).toBe(false)
    expect(isValidScientificMutationQuery(`?id=eq.${id}&version=gt.0`)).toBe(
      false,
    )
  })

  it('rejects additional filters and response-shaping parameters', () => {
    for (const extra of ['select=id', 'limit=0', 'col_value=eq.hidden']) {
      expect(
        isValidScientificMutationQuery(`?id=eq.${id}&version=eq.2&${extra}`),
        extra,
      ).toBe(false)
    }
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
