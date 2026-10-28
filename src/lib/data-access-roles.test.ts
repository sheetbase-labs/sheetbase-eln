import { describe, expect, it } from 'vitest'

import {
  DATA_ACCESS_ROLE_OPTIONS,
  DEFAULT_DATA_ACCESS_ROLES,
  hasDataAccess,
} from './data-access-roles'

describe('hasDataAccess', () => {
  it('defaults to stewards only', () => {
    expect(DEFAULT_DATA_ACCESS_ROLES).toEqual(['steward'])
    expect(hasDataAccess('steward', undefined)).toBe(true)
    expect(hasDataAccess('scientist', null)).toBe(false)
  })

  it('follows the workspace setting', () => {
    expect(hasDataAccess('analyst', ['steward', 'analyst'])).toBe(true)
    expect(hasDataAccess('steward', [])).toBe(false)
    expect(hasDataAccess(null, ['steward'])).toBe(false)
  })

  it('never offers client_viewer', () => {
    expect(DATA_ACCESS_ROLE_OPTIONS.map((option) => option.role)).not.toContain(
      'client_viewer',
    )
  })
})
