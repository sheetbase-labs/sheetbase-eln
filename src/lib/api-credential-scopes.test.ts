import { describe, expect, it } from 'vitest'

import {
  PRODUCT_SCOPES,
  SCIENTIFIC_SCOPES,
  SCOPE_GROUPS,
  VALID_SCOPES,
  isProductScope,
  isScientificScope,
} from '#/lib/api-credential-scopes'

describe('API-02 product scopes', () => {
  it('does not offer scientific:* for new issuance', () => {
    expect(PRODUCT_SCOPES.some(isScientificScope)).toBe(false)
    for (const scope of SCIENTIFIC_SCOPES) {
      expect(isProductScope(scope)).toBe(false)
      expect(VALID_SCOPES).toContain(scope)
    }
  })

  it('covers the API-01 Core vocabulary in the admin grouping', () => {
    const grouped = SCOPE_GROUPS.flatMap((group) => [...group.scopes])
    expect(grouped.sort()).toEqual([...PRODUCT_SCOPES].sort())
    expect(grouped).toContain('datasets:read')
    expect(grouped).toContain('schema:publish')
    expect(grouped).toContain('sheets:write')
    expect(grouped).not.toContain('scientific:read')
  })
})
