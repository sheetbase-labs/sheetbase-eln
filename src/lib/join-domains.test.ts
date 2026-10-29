import { describe, expect, it } from 'vitest'

import {
  emailDomainOf,
  isDomainShaped,
  isPublicEmailDomain,
  normaliseDomainInput,
} from './join-domains'

describe('join domains', () => {
  it('reads the domain of an address', () => {
    expect(emailDomainOf('Dana@Acme-Bio.com')).toBe('acme-bio.com')
    expect(emailDomainOf('no-at-sign')).toBe('')
    expect(emailDomainOf(null)).toBe('')
  })

  it('cleans what someone types into the domain box', () => {
    expect(normaliseDomainInput(' @Acme-Bio.com ')).toBe('acme-bio.com')
    expect(normaliseDomainInput('https://acme-bio.com/team')).toBe(
      'acme-bio.com',
    )
  })

  it('checks the shape of a domain', () => {
    expect(isDomainShaped('acme-bio.com')).toBe(true)
    expect(isDomainShaped('acme')).toBe(false)
    expect(isDomainShaped('-bad.com')).toBe(false)
  })

  it('knows public mail domains', () => {
    expect(isPublicEmailDomain('Gmail.com')).toBe(true)
    expect(isPublicEmailDomain('acme-bio.com')).toBe(false)
  })
})
