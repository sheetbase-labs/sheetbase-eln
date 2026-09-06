/**
 * EXT-03 compat/trust unit tests: semver ordering, range grammar, compat
 * states, update detection and the source-trust policy.
 */
import { describe, expect, it } from 'vitest'

import {
  checkExtensionCompat,
  compareSemver,
  describeExtensionCompat,
  isTrustedExtensionSource,
  isUpdateAvailable,
  requiresTrustAcknowledgement,
  validateCompatRange,
} from './compat'

describe('compareSemver', () => {
  it('orders releases numerically, not lexically', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1)
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1)
    expect(compareSemver('2.0.0', '10.0.0')).toBe(-1)
  })

  it('sorts prereleases below their release', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBe(-1)
    expect(compareSemver('1.0.0', '1.0.0-alpha')).toBe(1)
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1)
  })

  it('ignores build metadata and reports NaN for garbage', () => {
    expect(compareSemver('1.0.0+build.1', '1.0.0')).toBe(0)
    expect(Number.isNaN(compareSemver('banana', '1.0.0'))).toBe(true)
    expect(Number.isNaN(compareSemver('1.0.0', ''))).toBe(true)
  })
})

describe('validateCompatRange', () => {
  it('accepts wildcards, exact versions and comparator ranges', () => {
    expect(validateCompatRange('*')).toEqual([])
    expect(validateCompatRange('1.2.3')).toEqual([])
    expect(validateCompatRange('>=1.0.0 <2.0.0')).toEqual([])
    expect(validateCompatRange('>=0.9.0 <=1.4.2')).toEqual([])
    expect(validateCompatRange('>1.0.0-alpha')).toEqual([])
  })

  it('rejects empty, fuzzy and malformed ranges fail-closed', () => {
    expect(validateCompatRange(undefined)).not.toEqual([])
    expect(validateCompatRange('')).not.toEqual([])
    expect(validateCompatRange('^1.0.0')).not.toEqual([])
    expect(validateCompatRange('~1.0.0')).not.toEqual([])
    expect(validateCompatRange('>=1.0')).not.toEqual([])
    expect(validateCompatRange('banana')).not.toEqual([])
    expect(validateCompatRange('>=1.0.0 banana')).not.toEqual([])
  })
})

describe('checkExtensionCompat', () => {
  it('reports compatible when the app satisfies the declared range', () => {
    expect(
      checkExtensionCompat({ compatibleWith: '>=1.0.0 <2.0.0' }, '1.4.0'),
    ).toBe('compatible')
    expect(checkExtensionCompat({ compatibleWith: '*' }, '0.0.1')).toBe(
      'compatible',
    )
    expect(checkExtensionCompat({ compatibleWith: '=1.2.3' }, '1.2.3')).toBe(
      'compatible',
    )
  })

  it('reports incompatible when the app violates the declared range', () => {
    expect(
      checkExtensionCompat({ compatibleWith: '>=1.0.0 <2.0.0' }, '2.0.0'),
    ).toBe('incompatible')
    expect(
      checkExtensionCompat({ compatibleWith: '>=1.0.0 <2.0.0' }, '0.9.9'),
    ).toBe('incompatible')
  })

  it('reports unknown without a range or without an app version — never assumes', () => {
    expect(checkExtensionCompat({}, '1.0.0')).toBe('unknown')
    expect(
      checkExtensionCompat({ compatibleWith: '>=1.0.0' }, null),
    ).toBe('unknown')
    expect(
      checkExtensionCompat({ compatibleWith: '>=1.0.0' }, 'not-a-version'),
    ).toBe('unknown')
    expect(
      checkExtensionCompat({ compatibleWith: 'banana' }, '1.0.0'),
    ).toBe('unknown')
  })

  it('describes every state without leaking internals', () => {
    for (const state of ['compatible', 'unknown', 'incompatible'] as const) {
      expect(describeExtensionCompat(state)).toMatch(/\S/)
    }
    expect(describeExtensionCompat('incompatible')).toMatch(/acknowledgement/)
  })
})

describe('isUpdateAvailable', () => {
  it('detects strictly newer known versions', () => {
    expect(isUpdateAvailable('1.0.0', '1.0.1')).toBe(true)
    expect(isUpdateAvailable('1.0.0', '1.0.0')).toBe(false)
    expect(isUpdateAvailable('2.0.0', '1.9.9')).toBe(false)
  })

  it('reports no update for unparsable input, never a prompt', () => {
    expect(isUpdateAvailable('banana', '1.0.0')).toBe(false)
    expect(isUpdateAvailable('1.0.0', 'banana')).toBe(false)
  })
})

describe('source trust policy', () => {
  it('trusts https sources only', () => {
    expect(isTrustedExtensionSource('https://extensions.example.com/x.tgz')).toBe(
      true,
    )
    expect(isTrustedExtensionSource('dev:sheetbase-sample-panel')).toBe(false)
    expect(isTrustedExtensionSource('registry:acme/retest-tracker')).toBe(false)
    expect(isTrustedExtensionSource('http://extensions.example.com/x.tgz')).toBe(
      false,
    )
  })

  it('requires acknowledgement exactly for untrusted sources', () => {
    expect(requiresTrustAcknowledgement('https://example.com/x.tgz')).toBe(false)
    expect(requiresTrustAcknowledgement('dev:sample')).toBe(true)
  })
})
