import { describe, expect, it } from 'vitest'

import {
  SCOPE_GROUPS,
  SERVICE_SCOPE_GROUPS,
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
    expect(grouped).toContain('agent_operations:write')
  })

  it('does not treat reviews:write as an effective credential capability', () => {
    const attestation = SCOPE_GROUPS.find((group) =>
      group.scopes.includes('reviews:write'),
    )
    expect(attestation?.effective).toBe(false)
    expect(attestation?.description).toMatch(/human-session-only/)
    const preview = SCOPE_GROUPS.find((group) =>
      group.scopes.includes('reviews:read'),
    )
    expect(preview?.effective).toBe(true)
    expect(preview?.description).toMatch(/Does not submit/)
  })

  it('offers the administration scopes only to personal tokens', () => {
    const administration = SCOPE_GROUPS.find((group) =>
      group.scopes.includes('admin:read'),
    )
    expect(administration?.personalOnly).toBe(true)
    const serviceScopes = SERVICE_SCOPE_GROUPS.flatMap((group) => [
      ...group.scopes,
    ])
    expect(serviceScopes).not.toContain('admin:read')
    expect(serviceScopes).not.toContain('admin:write')
  })
})
