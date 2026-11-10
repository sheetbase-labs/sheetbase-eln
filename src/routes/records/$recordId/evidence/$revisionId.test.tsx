import { describe, expect, it } from 'vitest'

import { Route } from './$revisionId'

describe('old evidence address', () => {
  it('redirects to the one evidence view', () => {
    const beforeLoad = Route.options.beforeLoad
    const options = { params: { recordId: 'rec-1', revisionId: 'rev-1' } }

    let thrown: unknown

    try {
      // SAFETY: this route's beforeLoad reads only `params` and throws the redirect it builds from them; the router supplies the rest of its argument in production.
      beforeLoad?.(options as never)
    } catch (e) {
      thrown = e
    }

    expect(JSON.stringify(thrown)).toContain('/evidence/$revisionId')
    expect(JSON.stringify(thrown)).toContain('rev-1')
  })
})
