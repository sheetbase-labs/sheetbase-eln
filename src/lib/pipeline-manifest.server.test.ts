import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  MANIFEST_SCHEMA,
  canonicalJson,
  digestManifest,
  digestRows,
  keyIdFor,
  loadSigningKey,
  signDigest,
  verifyRunManifest,
} from './pipeline-manifest.server'
import type { RunManifest } from './pipeline-manifest.server'

vi.mock('#/env.server', () => ({
  env: {
    PIPELINE_MANIFEST_SIGNING_KEY: undefined,
    SHEETBASE_ARTIFACT_VERSION: 'test',
  },
}))

function pem() {
  const { privateKey } = generateKeyPairSync('ed25519')
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

function manifest(): RunManifest {
  return {
    schema: MANIFEST_SCHEMA,
    run: {
      id: 'run-1',
      workspaceId: 'ws-1',
      attempt: 1,
      retryOfRunId: null,
      triggerKind: 'manual',
      triggerOccurrenceId: null,
      scheduleId: null,
      actorUserId: 'user-1',
      inputDigest: 'a'.repeat(64),
      finishedAt: '2026-10-21T12:00:00.000Z',
    },
    definition: {
      name: 'Scale',
      versionId: 'v1',
      versionNumber: 1,
      configurationDigest: 'b'.repeat(64),
    },
    parameters: { factor: 2 },
    inputs: [],
    steps: [],
    decisions: [],
    outputs: {
      mode: 'create',
      datasetId: 'd1',
      datasetVersionId: 'dv1',
      label: 'out',
      rowCount: 0,
      contentDigest: digestRows([]),
    },
    actions: [],
    executor: { artifactVersion: 'test', sandboxRole: 'pipeline_sandbox' },
  }
}

describe('canonical form', () => {
  it('sorts keys at every depth so key order never changes a digest', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } })).toBe(
      '{"a":{"c":[{"x":2,"y":1}],"d":2},"b":1}',
    )
  })

  it('digests a result set the same whatever order its rows arrive in', () => {
    const rows = [
      { id: 1, v: '2.0' },
      { id: 2, v: '4.0' },
      { id: 3, v: '8.0' },
    ]
    expect(digestRows([...rows].reverse())).toBe(digestRows(rows))
    expect(digestRows(rows)).not.toBe(digestRows(rows.slice(1)))
    expect(digestRows([{ id: 1, v: '2.0' }])).not.toBe(
      digestRows([{ id: 1, v: '2.1' }]),
    )
  })
})

describe('signing and verification', () => {
  it('has no key unless one is configured', () => {
    expect(loadSigningKey(undefined)).toBeNull()
  })

  it('rejects a key that is not Ed25519', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(() =>
      loadSigningKey(
        privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ),
    ).toThrow(/Ed25519/)
  })

  it('accepts a key carried on one line with escaped newlines', () => {
    const key = loadSigningKey(pem().replaceAll('\n', '\\n'))
    expect(key?.keyId).toBe(keyIdFor(key!.publicKey))
  })

  it('verifies an untouched manifest and fails each kind of tampering', () => {
    const key = loadSigningKey(pem())!
    const publicKey = key.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString()
    const m = manifest()
    const manifestDigest = digestManifest(m)
    const stored = {
      manifest: m,
      manifestDigest,
      previousDigest: null,
      signature: signDigest(manifestDigest, key),
    }
    expect(verifyRunManifest(stored, publicKey, null)).toEqual({
      digestMatches: true,
      signatureValid: true,
      chainValid: true,
    })

    const altered = {
      ...stored,
      manifest: { ...m, parameters: { factor: 3 } },
    }
    expect(verifyRunManifest(altered, publicKey).digestMatches).toBe(false)
    expect(verifyRunManifest(altered, publicKey).signatureValid).toBe(false)

    const other = loadSigningKey(pem())!
    const wrongKey = other.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString()
    expect(verifyRunManifest(stored, wrongKey).signatureValid).toBe(false)
    expect(verifyRunManifest(stored, null).signatureValid).toBe(false)

    expect(
      verifyRunManifest(stored, publicKey, 'c'.repeat(64)).chainValid,
    ).toBe(false)
  })

  it('reports an unsigned manifest as unsigned, not as invalid', () => {
    const m = manifest()
    const result = verifyRunManifest(
      {
        manifest: m,
        manifestDigest: digestManifest(m),
        previousDigest: null,
        signature: null,
      },
      null,
    )
    expect(result.signatureValid).toBeNull()
    expect(result.digestMatches).toBe(true)
  })
})
