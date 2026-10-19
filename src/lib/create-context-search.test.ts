import { describe, expect, it } from 'vitest'

import {
  cancelTarget,
  parseCreateContext,
  returnWithContext,
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
  it('goes back to the experiment before the project', () => {
    expect(cancelTarget({ experiment: 'e', project: 'p' }, '/list')).toBe(
      '/experiments/e',
    )
    expect(
      cancelTarget({ experiment: 'e', returnTo: '/a', project: 'p' }, '/list'),
    ).toBe('/a')
  })
})

describe('returnWithContext', () => {
  it('hands what the detour made back to the page that sent the person', () => {
    expect(returnWithContext('/datasets/new', { model: 'm1' })).toBe(
      '/datasets/new?model=m1',
    )
  })

  it('keeps what the return path already carries and replaces a value it names', () => {
    expect(
      returnWithContext('/datasets/new?project=p1&model=old', { model: 'm2' }),
    ).toBe('/datasets/new?project=p1&model=m2')
  })

  it('leaves an unsafe path alone', () => {
    expect(returnWithContext('https://example.com', { model: 'm1' })).toBe(
      'https://example.com',
    )
  })
})
