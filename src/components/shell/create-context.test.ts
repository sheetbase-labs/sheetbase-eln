import { describe, expect, it } from 'vitest'

import { createContextFromPath, createMenuSearch } from './create-context'

describe('createContextFromPath', () => {
  it('reads the open record from its detail route', () => {
    expect(createContextFromPath('/projects/p1')).toEqual({ project: 'p1' })
    expect(createContextFromPath('/projects/p1/experiments')).toEqual({
      project: 'p1',
    })
    expect(createContextFromPath('/experiments/e1/datasets')).toEqual({
      experiment: 'e1',
    })
    expect(createContextFromPath('/samples/s1')).toEqual({ sample: 's1' })
    expect(createContextFromPath('/datasets/d1/rows')).toEqual({
      dataset: 'd1',
    })
  })

  it('has no context on lists, create routes or other pages', () => {
    expect(createContextFromPath('/')).toEqual({})
    expect(createContextFromPath('/experiments')).toEqual({})
    expect(createContextFromPath('/experiments/new')).toEqual({})
    expect(createContextFromPath('/import')).toEqual({})
  })
})

describe('createMenuSearch', () => {
  it('hands an open experiment to the sample, sheet and import screens, and the page as returnTo', () => {
    const search = createMenuSearch('/experiments/e1/datasets')
    expect(search.sample).toEqual({
      new: true,
      project: undefined,
      experiment: 'e1',
      returnTo: '/experiments/e1/datasets',
    })
    expect(search.sheet).toMatchObject({
      experiment: 'e1',
      returnTo: '/experiments/e1/datasets',
    })
    expect(search.import).toMatchObject({
      experiment: 'e1',
      returnTo: '/experiments/e1/datasets',
    })
  })

  it('hands an open project to every create screen', () => {
    const search = createMenuSearch('/projects/p1')
    expect(search.experiment).toMatchObject({
      project: 'p1',
      returnTo: '/projects/p1',
    })
    expect(search.sample).toMatchObject({ project: 'p1' })
    expect(search.sheet).toMatchObject({ project: 'p1' })
    expect(search.import).toMatchObject({ project: 'p1' })
  })

  it('hands an open sample to a new experiment and an open dataset to an import', () => {
    expect(createMenuSearch('/samples/s1').experiment).toMatchObject({
      sample: 's1',
      returnTo: '/samples/s1',
    })
    expect(createMenuSearch('/datasets/d1').import).toMatchObject({
      dataset: 'd1',
      returnTo: '/datasets/d1',
    })
  })

  it('sends no returnTo from a page about nothing in particular', () => {
    const search = createMenuSearch('/inbox')
    expect(search.sample.returnTo).toBeUndefined()
    expect(search.import.returnTo).toBeUndefined()
  })
})
