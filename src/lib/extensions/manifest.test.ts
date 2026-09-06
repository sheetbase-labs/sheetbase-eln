/**
 * EXT-01 contract tests: manifest validation (fail-closed declarations),
 * capability mapping and audit identity. SQL parity lives in
 * tests/db/ext-01-extensions.test.ts.
 */
import { describe, expect, it } from 'vitest'

import {
  effectiveExtensionCapabilities,
  extensionAuditIdentity,
} from './contract'
import {
  ExtensionManifestError,
  parseExtensionManifest,
  validateExtensionManifest,
} from './manifest'

function validManifestInput() {
  return {
    id: 'acme.retest-tracker',
    name: 'Retest Tracker',
    version: '1.2.3',
    source: 'https://extensions.example.com/acme/retest-tracker-1.2.3.tgz',
    capabilities: ['record.create', 'record.link'],
    scopes: ['projects:read', 'projects:write'],
    contributions: {
      'object-actions': [{ id: 'queue-retest', title: 'Queue retest' }],
      panels: [{ id: 'retest-board', title: 'Retest board' }],
      commands: [{ id: 'retest-today', title: 'Show retests due today' }],
      'event-subscriptions': [{ eventType: 'record.updated' }],
    },
  }
}

describe('extension manifest validation', () => {
  it('accepts a fully declared manifest', () => {
    expect(validateExtensionManifest(validManifestInput())).toEqual([])
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        source: 'registry:acme/retest-tracker',
      }),
    ).toEqual([])
    const parsed = parseExtensionManifest(validManifestInput())
    expect(parsed.name).toBe('Retest Tracker')
    expect(parsed.capabilities).toEqual(['record.create', 'record.link'])
  })
  it('normalizes names, dedupes authority and resolves event aliases', () => {
    const parsed = parseExtensionManifest({
      ...validManifestInput(),
      name: '  Retest Tracker  ',
      capabilities: ['record.create', 'record.create'],
      contributions: {
        'event-subscriptions': [{ eventType: 'sheet_instance.created' }],
      },
    })
    expect(parsed.name).toBe('Retest Tracker')
    expect(parsed.capabilities).toEqual(['record.create'])
    expect(parsed.contributions['event-subscriptions']).toEqual([
      { eventType: 'sheet.created' },
    ])
  })
  it('accepts an optional compatibleWith range and rejects malformed ones', () => {
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        compatibleWith: '>=1.0.0 <2.0.0',
      }),
    ).toEqual([])
    expect(
      parseExtensionManifest({
        ...validManifestInput(),
        compatibleWith: '>=1.0.0 <2.0.0',
      }).compatibleWith,
    ).toBe('>=1.0.0 <2.0.0')
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        compatibleWith: '^1.0.0',
      }),
    ).not.toEqual([])
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        compatibleWith: 'banana',
      }),
    ).not.toEqual([])
    expect(parseExtensionManifest(validManifestInput()).compatibleWith).toBeUndefined()
  })


  it('rejects unknown contribution points fail-closed', () => {
    const errors = validateExtensionManifest({
      ...validManifestInput(),
      contributions: { widgets: [{ id: 'x', title: 'X' }] },
    })
    expect(errors.some((error) => error.includes('unknown contribution point: widgets'))).toBe(
      true,
    )
    expect(() => parseExtensionManifest({
      ...validManifestInput(),
      contributions: { widgets: [{ id: 'x', title: 'X' }] },
    })).toThrow(ExtensionManifestError)
  })

  it('rejects unknown capabilities, scopes and event subscriptions', () => {
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        capabilities: ['record.create', 'database.drop'],
      }).some((error) => error.includes('unknown capability')),
    ).toBe(true)
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        scopes: ['projects:read', 'database:admin'],
      }).some((error) => error.includes('unknown scope')),
    ).toBe(true)
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        contributions: {
          'event-subscriptions': [{ eventType: 'record.teleported' }],
        },
      }).some((error) => error.includes('unknown event subscription')),
    ).toBe(true)
  })

  it('rejects malformed identity, empty authority and bad declarations', () => {
    expect(
      validateExtensionManifest({ ...validManifestInput(), id: 'not namespaced!' }),
    ).not.toEqual([])
    expect(
      validateExtensionManifest({ ...validManifestInput(), version: 'tomorrow' }),
    ).not.toEqual([])
    expect(
      validateExtensionManifest({ ...validManifestInput(), source: 'ftp://x/y' }),
    ).not.toEqual([])
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        capabilities: [],
        scopes: [],
      }).some((error) => error.includes('at least one capability or scope')),
    ).toBe(true)
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        contributions: {
          commands: [{ id: 'Bad Key!', title: 'x' }],
        },
      }),
    ).not.toEqual([])
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        contributions: {
          commands: [
            { id: 'dup', title: 'One' },
            { id: 'dup', title: 'Two' },
          ],
        },
      }).some((error) => error.includes('duplicate id')),
    ).toBe(true)
  })
})

describe('extension capability mapping', () => {
  const manifest = {
    capabilities: ['record.create', 'schema.edit', 'extensions.manage'] as const,
  } as unknown as Parameters<typeof effectiveExtensionCapabilities>[0]

  it('intersects declared capabilities with the caller role', () => {
    expect(effectiveExtensionCapabilities(manifest, 'steward')).toEqual([
      'record.create',
      'schema.edit',
      'extensions.manage',
    ])
    expect(effectiveExtensionCapabilities(manifest, 'member')).toEqual([
      'record.create',
    ])
    expect(effectiveExtensionCapabilities(manifest, 'viewer')).toEqual([])
    expect(effectiveExtensionCapabilities(manifest, null)).toEqual([])
  })

  it('stamps a stable audit identity for extension work', () => {
    expect(
      extensionAuditIdentity({
        extensionId: 'ext-1',
        extensionKey: 'retest',
        manifest: { id: 'acme.retest-tracker', version: '1.2.3' },
      }),
    ).toEqual({
      extension_id: 'ext-1',
      extension_key: 'retest',
      extension_manifest: 'acme.retest-tracker',
      extension_version: '1.2.3',
    })
  })
})
