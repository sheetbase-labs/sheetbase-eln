import { describe, expect, it } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import { isPermissionDenied, reportAccess } from '#/lib/reports'

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

describe('reportAccess', () => {
  it('lets editors change and generate', () => {
    expect(reportAccess({ can_edit: true, can_review: false })).toEqual({
      canEdit: true,
      canGenerate: true,
    })
  })

  it('lets reviewers generate but not change', () => {
    expect(reportAccess({ can_edit: false, can_review: true })).toEqual({
      canEdit: false,
      canGenerate: true,
    })
  })

  it('keeps viewers from both', () => {
    expect(reportAccess({ can_edit: false, can_review: false })).toEqual({
      canEdit: false,
      canGenerate: false,
    })
  })

  it('leaves the database to decide when access is unknown', () => {
    expect(reportAccess(undefined)).toEqual({
      canEdit: true,
      canGenerate: true,
    })
  })
})
