import { describe, expect, it } from 'vitest'

import { Route } from './new'

const validate = Route.options.validateSearch as (
  search: Record<string, unknown>,
) => Record<string, unknown>

describe('/sheets/new search', () => {
  it('accepts the shared create-context params', () => {
    expect(
      validate({
        project: 'p-1',
        experiment: 'e-1',
        returnTo: '/projects/p-1',
      }),
    ).toEqual({ project: 'p-1', experiment: 'e-1', returnTo: '/projects/p-1' })
  })

  it('drops a returnTo that leaves the app and empty values', () => {
    expect(validate({ project: '', returnTo: '//evil.example' })).toEqual({})
  })
})
