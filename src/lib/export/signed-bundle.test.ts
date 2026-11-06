// @requirement VAL-TS-02, VAL-EXP-01
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  generateWorkspaceKeyPair,
  keyFingerprint,
  signWithKey,
} from './bundle-key'
import { buildSignedBundle } from './signed-bundle'
import type { EvidencePackageInput } from './evidence-package'
import { canonicalSignedData, sha256Hex } from '../timestamps/signed-data'
import {
  createTestAuthority,
  opensslAvailable,
} from '../timestamps/test-authority'
import type { TestAuthority } from '../timestamps/test-authority'
import { buildTimestampRequest } from '../timestamps/tsp'

const haveTools = opensslAvailable && spawnSync('unzip', ['-v']).status === 0

const evidence: EvidencePackageInput = {
  revision: {
    id: 'rev-1',
    recordId: 'rec-1',
    workspaceId: 'ws-1',
    reason: 'submit',
    structureVersion: 1,
    metadataVersion: 1,
    integrityAlgorithm: 'sha256',
    integrityDigest: 'ab'.repeat(32),
    supersededByRevisionId: null,
    createdAt: '2026-11-06T10:00:00Z',
    createdByUserId: 'u1',
  },
  record: {
    identifier: 'EXP-1',
    title: 'Assay',
    kind: 'experiment',
    status: 'approved',
  },
  metadataSnapshot: {},
  blockSnapshot: [],
  canonicalSnapshot: {},
  sheetEvidence: [],
  files: [],
  submission: null,
  decisions: [],
  checkResults: [],
  signatures: [],
  comments: [],
}

describe.skipIf(!haveTools)('signed export bundle', () => {
  let authority: TestAuthority
  let dir: string
  let rootFile: string
  let fingerprint: string
  const run = (cmd: string, args: string[]) =>
    spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' })

  async function extract(mutate?: (dir: string) => void) {
    const key = generateWorkspaceKeyPair()
    fingerprint = keyFingerprint(key.publicKeyPem)
    const signedData = canonicalSignedData({
      signatureId: 'sig-1',
      workspaceId: 'ws-1',
      recordId: 'rec-1',
      revisionId: 'rev-1',
      revisionIntegrityDigest: evidence.revision.integrityDigest!,
      signerUserId: 'u1',
      meaning: 'reviewed-and-approved',
      signedAt: '2026-11-06T10:00:00.123456Z',
    })
    const request = buildTimestampRequest(sha256Hex(signedData))
    const zip = await buildSignedBundle({
      evidence,
      timestamps: [
        {
          signatureId: 'sig-1',
          signedData,
          responseB64: Buffer.from(authority.reply(request.der)).toString(
            'base64',
          ),
          authorityName: 'Test TSA',
          authorityUrl: 'https://tsa.test',
          genTime: '2026-11-06T10:00:01.000Z',
          serial: '1',
          signer: 'CN=Test',
        },
      ],
      publicKeyPem: key.publicKeyPem,
      fingerprint,
      sign: (manifest) => signWithKey(key.privateKeyPem, manifest),
      generatedAt: '2026-11-06T10:05:00Z',
    })
    dir = mkdtempSync(join(tmpdir(), 'sheetbase-bundle-'))
    writeFileSync(join(dir, 'bundle.zip'), zip)
    execFileSync('unzip', ['-q', 'bundle.zip', '-d', 'out'], { cwd: dir })
    dir = join(dir, 'out')
    mutate?.(dir)
  }

  beforeAll(() => {
    authority = createTestAuthority()
    rootFile = join(authority.dir, 'ca.pem')
  })

  it('verifies offline with node and with openssl', async () => {
    await extract()
    const node = run('node', [
      'verify.mjs',
      '--tsa-ca',
      rootFile,
      '--key-fingerprint',
      fingerprint,
    ])
    expect(node.stdout).toContain('Bundle verified.')
    expect(node.status).toBe(0)
    expect(node.stdout).toContain('manifest.json is signed by public-key.pem')
    expect(node.stdout).toContain('signed/sig-1.tsr is signed by an authority')
    const sh = run('sh', ['verify.sh', rootFile])
    expect(sh.stdout).toContain('Bundle verified.')
    const shNoCa = run('sh', ['verify.sh'])
    expect(shNoCa.stdout).toContain('covers signed/sig-1.json')
    expect(shNoCa.status).toBe(0)
  })

  it('fails when a file, the signed data or the manifest is altered', async () => {
    await extract((d) => {
      const f = join(d, 'evidence.json')
      writeFileSync(f, readFileSync(f, 'utf8').replace('Assay', 'Altered'))
    })
    const edited = run('node', ['verify.mjs'])
    expect(edited.status).toBe(1)
    expect(edited.stdout).toContain('FAILED  evidence.json')
    expect(run('sh', ['verify.sh']).status).toBe(1)

    await extract((d) => {
      const f = join(d, 'signed/sig-1.json')
      writeFileSync(f, readFileSync(f, 'utf8').replace('u1', 'u2'))
    })
    expect(run('node', ['verify.mjs']).status).toBe(1)

    await extract((d) => {
      const f = join(d, 'manifest.json')
      writeFileSync(f, readFileSync(f, 'utf8').replace('sheetbase-signed', 'x'))
    })
    const manifest = run('node', ['verify.mjs'])
    expect(manifest.status).toBe(1)
    expect(manifest.stdout).toContain('FAILED  manifest.json is signed')
  })

  it('fails against the wrong authority root or the wrong key', async () => {
    await extract()
    const other = createTestAuthority()
    const wrongRoot = run('node', [
      'verify.mjs',
      '--tsa-ca',
      join(other.dir, 'ca.pem'),
    ])
    expect(wrongRoot.status).toBe(1)
    const wrongKey = run('node', ['verify.mjs', '--key-fingerprint', 'aa:bb'])
    expect(wrongKey.status).toBe(1)
    expect(wrongKey.stdout).toContain(
      'FAILED  key fingerprint is the one you expected',
    )
  })
})
