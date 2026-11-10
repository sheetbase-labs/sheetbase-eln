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
  it.each([null, false, [], 42])(
    'rejects non-object manifest input %j',
    (input) => {
      expect(validateExtensionManifest(input)).toEqual([
        'manifest must be an object',
      ])
      expect(() => parseExtensionManifest(input)).toThrow(
        ExtensionManifestError,
      )
    },
  )

  it('keeps the complete diagnostic order and legacy malformed-authority text', () => {
    const input = {
      ...validManifestInput(),
      id: 1,
      name: ' ',
      version: false,
      source: null,
      compatibleWith: 2,
      description: false,
      author: 0,
      capabilities: [{}],
      scopes: [{}],
      contributions: {
        widgets: [],
        panels: [{ id: 'p', title: 'P', ui: '../escape.html' }],
        commands: [
          { id: 'x', title: 'X' },
          { id: 'x', title: '' },
        ],
      },
    }

    const errors = [
      'id must be a namespaced package identity (e.g. acme.retest-tracker)',
      'name must be 1-200 non-blank characters',
      'version must be semver (e.g. 1.2.3)',
      'source must be 1-500 characters',
      'compatibleWith must be a version range string',
      'description must be 1-600 characters',
      'author must be 1-200 characters',
      'unknown capability: [object Object]',
      'unknown scope: [object Object]',
      'unknown contribution point: widgets',
      'contributions.panels.p ui must be an .html file in ui/, such as ui/index.html',
      'contributions.commands entry titles must be 1-120 characters',
    ]

    expect(validateExtensionManifest(input)).toEqual(errors)
    expect(() => parseExtensionManifest(input)).toThrow(
      new ExtensionManifestError(errors),
    )
  })

  it('preserves named-entry forward compatibility and normalized optional fields', () => {
    const input = validManifestInput()

    const parsed = parseExtensionManifest({
      ...input,
      compatibleWith: ' >=1.0.0 <2.0.0 ',
      description: ' About ',
      author: ' Author ',
      scopes: ['projects:read', 'projects:read', 'projects:write'],
      contributions: {
        commands: [{ id: 'x', title: ' X ', futureSetting: true }],
        panels: [
          {
            id: 'p',
            title: ' P ',
            ui: 'ui/panel.html',
            models: ['sample', 'sample'],
            futureSetting: true,
          },
        ],
      },
    })

    expect(parsed).toEqual({
      ...input,
      compatibleWith: '>=1.0.0 <2.0.0',
      description: 'About',
      author: 'Author',
      contributions: {
        commands: [{ id: 'x', title: 'X' }],
        panels: [
          { id: 'p', title: 'P', ui: 'ui/panel.html', models: ['sample'] },
        ],
      },
    })
    const absent = parseExtensionManifest(input)

    for (const key of ['compatibleWith', 'description', 'author', 'python'])
      expect(Object.hasOwn(absent, key)).toBe(false)
  })

  it('rejects unknown original JSON keys and duplicate canonical event aliases', () => {
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        contributions: Object.fromEntries([['__proto__', []]]),
      }),
    ).toEqual(['unknown contribution point: __proto__'])
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        contributions: {
          'event-subscriptions': [
            { eventType: 'sheet_instance.created' },
            { eventType: 'sheet.created' },
          ],
        },
      }),
    ).toEqual(['duplicate event subscription: sheet.created'])
  })

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
    expect(
      parseExtensionManifest(validManifestInput()).compatibleWith,
    ).toBeUndefined()
  })

  it('rejects unknown contribution points fail-closed', () => {
    const errors = validateExtensionManifest({
      ...validManifestInput(),
      contributions: { widgets: [{ id: 'x', title: 'X' }] },
    })

    expect(
      errors.some((error) =>
        error.includes('unknown contribution point: widgets'),
      ),
    ).toBe(true)
    expect(() =>
      parseExtensionManifest({
        ...validManifestInput(),
        contributions: { widgets: [{ id: 'x', title: 'X' }] },
      }),
    ).toThrow(ExtensionManifestError)
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
      validateExtensionManifest({
        ...validManifestInput(),
        id: 'not namespaced!',
      }),
    ).not.toEqual([])
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        version: 'tomorrow',
      }),
    ).not.toEqual([])
    expect(
      validateExtensionManifest({
        ...validManifestInput(),
        source: 'ftp://x/y',
      }),
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
    capabilities: ['record.create', 'schema.edit', 'extensions.manage'],
  } satisfies Parameters<typeof effectiveExtensionCapabilities>[0]

  it('intersects declared capabilities with the caller role', () => {
    expect(effectiveExtensionCapabilities(manifest, 'steward')).toEqual([
      'record.create',
      'schema.edit',
    ])
    expect(effectiveExtensionCapabilities(manifest, 'admin')).toEqual([
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
