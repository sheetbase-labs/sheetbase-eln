import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

it('verifies canonical nested objects, ordered arrays and scalar strings offline, rejecting tampering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manifest-verifier-'))
  directories.push(directory)
  const file = join(directory, 'manifest.json')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  const manifest = {
    z: ['scalar', { z: 2, a: 'nested' }, null, false],
    a: { z: 'last', a: 'first' },
  }

  const canonical =
    '{"a":{"a":"first","z":"last"},"z":["scalar",{"a":"nested","z":2},null,false]}'

  const manifestDigest = createHash('sha256').update(canonical).digest('hex')

  const body = {
    manifest,
    manifestDigest,
    signature: sign(
      null,
      Buffer.from(manifestDigest, 'hex'),
      privateKey,
    ).toString('base64'),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    keyId: 'offline-test',
    sequence: 1,
    previousDigest: null,
  }

  const verify = () =>
    spawnSync(
      process.execPath,
      ['scripts/verify-pipeline-manifest.mjs', file],
      { encoding: 'utf8' },
    )

  await writeFile(file, JSON.stringify(body))
  const valid = verify()
  expect(valid.status).toBe(0)
  expect(valid.stdout).toContain('PASS  manifest digest matches its content')
  expect(valid.stdout).toContain('PASS  signature verifies')

  await writeFile(
    file,
    JSON.stringify({ ...body, signature: Buffer.alloc(64).toString('base64') }),
  )
  const forgedSignature = verify()
  expect(forgedSignature.status).toBe(1)
  expect(forgedSignature.stdout).toContain('FAIL  signature verifies')

  await writeFile(
    file,
    JSON.stringify({
      ...body,
      manifest: { ...manifest, z: [...manifest.z].reverse() },
    }),
  )
  const reorderedArray = verify()
  expect(reorderedArray.status).toBe(1)
  expect(reorderedArray.stdout).toContain(
    'FAIL  manifest digest matches its content',
  )
})
