import { describe, expect, it } from 'vitest'

import { Route } from './$revisionId'

describe('old evidence address', () => {
  it('redirects to the one evidence view', () => {
    const beforeLoad = Route.options.beforeLoad as (a: unknown) => unknown
    let thrown: unknown
    try {
      beforeLoad({ params: { recordId: 'rec-1', revisionId: 'rev-1' } })
    } catch (e) {
      thrown = e
    }
    expect(JSON.stringify(thrown)).toContain('/evidence/$revisionId')
    expect(JSON.stringify(thrown)).toContain('rev-1')
  })
})
