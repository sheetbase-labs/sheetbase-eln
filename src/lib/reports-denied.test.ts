import { describe, expect, it } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import { isPermissionDenied } from '#/lib/reports'

describe('isPermissionDenied', () => {
  it('recognises the database refusing a person', () => {
    expect(
      isPermissionDenied(
        new DataClientError('42501', 'Object access denied', 403),
      ),
    ).toBe(true)
    expect(
      isPermissionDenied(
        new DataClientError('permission_denied', 'Request denied', 403),
      ),
    ).toBe(true)
  })

  it('leaves other failures to the generic message', () => {
    expect(
      isPermissionDenied(new DataClientError('SB033', 'wrong workspace', 400)),
    ).toBe(false)
    expect(isPermissionDenied(new Error('Object access denied'))).toBe(false)
  })
})
