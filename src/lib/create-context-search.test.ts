import { describe, expect, it } from 'vitest'

import {
  cancelTarget,
  parseCreateContext,
  safeReturnTo,
} from './create-context-search'

describe('safeReturnTo', () => {
  it('keeps in-app paths', () => {
    expect(safeReturnTo('/projects/abc?tab=x')).toBe('/projects/abc?tab=x')
  })
  it('refuses anything that could leave the app', () => {
    expect(safeReturnTo('https://evil.example')).toBeUndefined()
    expect(safeReturnTo('//evil.example')).toBeUndefined()
    expect(safeReturnTo('/\\evil.example')).toBeUndefined()
    expect(safeReturnTo(undefined)).toBeUndefined()
  })
})

describe('parseCreateContext', () => {
  it('keeps the known params and drops empty or foreign ones', () => {
    expect(
      parseCreateContext({
        project: 'p1',
        experiment: '',
        sample: 's1',
        other: 'x',
        returnTo: '/experiments/e1',
      }),
    ).toEqual({ project: 'p1', sample: 's1', returnTo: '/experiments/e1' })
  })
})

describe('cancelTarget', () => {
  it('prefers returnTo, then the project, then the fallback', () => {
    expect(cancelTarget({ returnTo: '/a', project: 'p' }, '/list')).toBe('/a')
    expect(cancelTarget({ project: 'p' }, '/list')).toBe('/projects/p')
    expect(cancelTarget({}, '/list')).toBe('/list')
  })
})
