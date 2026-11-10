import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { Route } from './samples'

/**
 * The route's search validator: this route declares a plain function, while
 * TanStack's option type also allows validator objects.
 */
const validate = z
  .function({
    input: z.tuple([z.record(z.string(), z.string())]),
    output: z.unknown(),
  })
  .parse(Route.options.validateSearch)

/** What a screen keeps from the URL: `returnTo` only when it stays in the app. */
const retainedSearch = z.object({ returnTo: z.string().optional() })

describe('/samples search', () => {
  it('accepts the shared create-context params', () => {
    expect(
      validate({
        new: 'true',
        project: 'p-1',
        experiment: 'e-1',
        returnTo: '/experiments/e-1/data/links',
      }),
    ).toMatchObject({
      new: true,
      project: 'p-1',
      experiment: 'e-1',
      returnTo: '/experiments/e-1/data/links',
    })
  })

  it('drops a returnTo that leaves the app', () => {
    const retained = retainedSearch.parse(
      validate({ returnTo: 'https://example.com' }),
    )

    expect(retained.returnTo).toBe(undefined)
  })
})
