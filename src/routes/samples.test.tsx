import { describe, expect, it } from 'vitest'

import { Route } from './samples'

const validate = Route.options.validateSearch as (
  search: Record<string, unknown>,
) => Record<string, unknown>

describe('/samples search', () => {
  it('accepts the shared create-context params', () => {
    expect(
      validate({
        new: 'true',
        project: 'p-1',
        experiment: 'e-1',
        returnTo: '/experiments/e-1/links',
      }),
    ).toMatchObject({
      new: true,
      project: 'p-1',
      experiment: 'e-1',
      returnTo: '/experiments/e-1/links',
    })
  })

  it('drops a returnTo that leaves the app', () => {
    expect(validate({ returnTo: 'https://example.com' }).returnTo).toBe(
      undefined,
    )
  })
})
