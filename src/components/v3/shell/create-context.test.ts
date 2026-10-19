import { describe, expect, it } from 'vitest'

import { createContextFromPath } from './create-context'

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
