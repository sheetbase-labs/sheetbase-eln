#!/usr/bin/env node
/**
 * Verify a pipeline run manifest offline.
 *
 *   node scripts/verify-pipeline-manifest.mjs manifest.json [previous.json]
 *
 * `manifest.json` is the body of GET /api/pipelines/manifest?runId=… saved to a
 * file. Pass the previous run's body as the second argument to check the chain
 * link. Uses only the file and Node's crypto: the server is not consulted.
 * Exits 0 when every check that applies holds, 1 otherwise.
 */
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'

function canonicalJson(value) {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  )
}

const [file, previousFile] = process.argv.slice(2)
if (!file) {
  console.error(
    'usage: verify-pipeline-manifest.mjs manifest.json [previous.json]',
  )
  process.exit(2)
}
const body = JSON.parse(readFileSync(file, 'utf8'))
const digest = createHash('sha256')
  .update(canonicalJson(body.manifest))
  .digest('hex')

const results = [
  ['manifest digest matches its content', digest === body.manifestDigest],
]
if (body.signature) {
  let valid = false
  if (body.publicKey && digest === body.manifestDigest) {
    try {
      valid = verify(
        null,
        Buffer.from(body.manifestDigest, 'hex'),
        createPublicKey(body.publicKey),
        Buffer.from(body.signature, 'base64'),
      )
    } catch {
      valid = false
    }
  }
  results.push([`signature verifies (key ${body.keyId})`, valid])
} else {
  console.log('note: this manifest is unsigned (no signing key was configured)')
}
if (previousFile) {
  const previous = JSON.parse(readFileSync(previousFile, 'utf8'))
  results.push([
    `chain link matches manifest ${previous.sequence}`,
    body.sequence === previous.sequence + 1 &&
      body.previousDigest === previous.manifestDigest,
  ])
} else if (body.sequence === 1) {
  results.push(['first in its workspace chain', body.previousDigest === null])
}

for (const [label, ok] of results)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
process.exit(results.every(([, ok]) => ok) ? 0 : 1)
