import { describe, expect, it } from 'vitest'

import { contextFromPathname } from './assistant-context'

const ID = '22222222-2222-4222-8222-222222222222'

describe('assistant page context', () => {
  it.each([
    [`/datasets/${ID}`, 'dataset'],
    [`/datasets/${ID}/rows`, 'dataset'],
    [`/sheets/${ID}`, 'sheet'],
    [`/analysis/${ID}`, 'analysis'],
    [`/records/${ID}`, 'record'],
    [`/records/${ID}/notebook`, 'record'],
    [`/experiments/${ID}`, 'record'],
    [`/samples/${ID}`, 'record'],
    [`/materials/${ID}`, 'record'],
    [`/instruments/${ID}`, 'record'],
  ])('maps %s to %s', (pathname, kind) => {
    expect(contextFromPathname(pathname)).toEqual({ kind, id: ID })
  })

  it('returns null for a page with no stable object', () => {
    expect(contextFromPathname('/projects')).toBeNull()
    expect(contextFromPathname('/settings/ai')).toBeNull()
    expect(contextFromPathname(`/datasets/EXP-024`)).toBeNull()
  })
})
