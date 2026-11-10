import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import { Route } from './index'

describe('/review', () => {
  it('opens the Inbox filtered to reviews', () => {
    let thrown: unknown

    try {
      // @ts-expect-error the redirect does not read its context
      Route.options.beforeLoad?.({})
    } catch (error) {
      thrown = error
    }

    expect(isRedirect(thrown)).toBe(true)
    // SAFETY: `isRedirect` above established that `thrown` is a redirect, which carries its navigation options.
    expect((thrown as { options: unknown }).options).toMatchObject({
      to: '/inbox',
      search: { tab: 'needs-action', type: 'reviews' },
    })
  })
})
