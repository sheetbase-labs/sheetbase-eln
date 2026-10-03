import { describe, expect, it, vi } from 'vitest'

import {
  canonicaliseIdentifierPath,
  isUuid,
  resolveIdentifierParam,
} from './identifier-resolution'

const UUID = '4c0e6d8a-1f2b-4a3c-9d4e-5f60718293a4'

/** Read the href off a TanStack Router redirect without an unchecked cast. */
function redirectHref(value: unknown): string | undefined {
  if (!(value instanceof Response)) return undefined
  if (!('options' in value)) return undefined
  const options = value.options
  if (typeof options !== 'object' || options === null) return undefined
  if (!('href' in options)) return undefined
  return typeof options.href === 'string' ? options.href : undefined
}

describe('isUuid', () => {
  it('accepts a canonical row id', () => {
    expect(isUuid(UUID)).toBe(true)
  })

  it('rejects display identifiers and junk', () => {
    expect(isUuid('PRJ-0217')).toBe(false)
    expect(isUuid('SHT-0019')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid('not-a-uuid')).toBe(false)
  })
})

describe('canonicaliseIdentifierPath', () => {
  it('rewrites the identifier segment and keeps the child, query and hash', () => {
    expect(
      canonicaliseIdentifierPath(
        '/datasets/DS-0311/rows?view=grid#cell',
        'DS-0311',
        UUID,
      ),
    ).toBe(`/datasets/${UUID}/rows?view=grid#cell`)
  })

  it('does not rewrite a longer segment that merely contains the id', () => {
    expect(
      canonicaliseIdentifierPath('/projects/PRJ-0217x', 'PRJ-0217', UUID),
    ).toBe('/projects/PRJ-0217x')
  })

  it('handles a bare layout route without a trailing segment', () => {
    expect(
      canonicaliseIdentifierPath('/projects/PRJ-0217', 'PRJ-0217', UUID),
    ).toBe(`/projects/${UUID}`)
  })
})

describe('resolveIdentifierParam', () => {
  it('leaves a UUID param alone without resolving', async () => {
    const resolve = vi.fn()
    await expect(
      resolveIdentifierParam(
        { entity: 'project', ref: UUID, href: `/projects/${UUID}` },
        resolve,
      ),
    ).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('redirects a resolved identifier to its canonical UUID URL', async () => {
    const resolve = vi.fn().mockResolvedValue(UUID)
    const thrown = await resolveIdentifierParam(
      {
        entity: 'project',
        ref: 'PRJ-0217',
        href: '/projects/PRJ-0217/members',
      },
      resolve,
    ).catch((error: unknown) => error)
    expect(resolve).toHaveBeenCalledWith({
      entity: 'project',
      identifier: 'PRJ-0217',
    })
    expect(thrown).toBeInstanceOf(Response)
    expect(redirectHref(thrown)).toBe(`/projects/${UUID}/members`)
  })

  it('returns without throwing when the identifier is not in the workspace', async () => {
    const resolve = vi.fn().mockResolvedValue(null)
    await expect(
      resolveIdentifierParam(
        { entity: 'sample', ref: 'SMP-9999', href: '/samples/SMP-9999' },
        resolve,
      ),
    ).resolves.toBeUndefined()
  })
})
