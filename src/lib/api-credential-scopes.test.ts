import { describe, expect, it } from 'vitest'

import {
  SCOPE_GROUPS,
  VALID_SCOPES,
  isValidScope,
} from '#/lib/api-credential-scopes'

describe('API-02 canonical scopes', () => {
  it('does not include scientific:* in the vocabulary', () => {
    expect(VALID_SCOPES).not.toContain('scientific:read')
    expect(VALID_SCOPES).not.toContain('scientific:write')
    expect(VALID_SCOPES).not.toContain('scientific:schema')
    expect(isValidScope('scientific:read')).toBe(false)
  })

  it('covers the API-01 Core vocabulary in the admin grouping', () => {
    const grouped = SCOPE_GROUPS.flatMap((group) => [...group.scopes])
    expect(grouped.sort()).toEqual([...VALID_SCOPES].sort())
    expect(grouped).toContain('datasets:read')
    expect(grouped).toContain('schema:publish')
    expect(grouped).toContain('sheets:write')
  })
})
