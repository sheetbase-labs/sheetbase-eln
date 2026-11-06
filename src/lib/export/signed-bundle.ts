/**
 * Signed export bundle for one submitted revision.
 *
 * It holds everything in the evidence package plus the proof that nothing has
 * changed since it left Sheetbase:
 *
 *   manifest.json   sha256 of every other file, and the stamped signatures
 *   manifest.sig    Ed25519 signature over manifest.json (raw bytes)
 *   public-key.pem  the workspace's export key, with its fingerprint in the manifest
 *   signed/<id>.json  the exact bytes a time-stamping authority was shown
 *   signed/<id>.tsr   the authority's RFC 3161 answer
 *   verify.mjs, verify.sh, VERIFY.md   how to check it without Sheetbase
 *
 * What the checks prove: the files are the ones Sheetbase exported (signature
 * plus a key fingerprint you compare with the lab's), and, for stamped
 * signatures, that the signature record existed unchanged at the time the
 * authority states. They do not make the science correct.
 */
import { addEvidenceEntries, checksumLines } from './evidence-package'
import type { EvidencePackageInput } from './evidence-package'
import { VERIFY_MJS, VERIFY_SH } from './bundle-verify-script'
import { ZipWriter } from './zip'
import { createHash } from 'node:crypto'

export const BUNDLE_FORMAT = 'sheetbase-signed-bundle/1'

export interface BundleTimestamp {
  signatureId: string
  signedData: string
  responseB64: string
  authorityName: string | null
  authorityUrl: string | null
  genTime: string | null
  serial: string | null
  signer: string | null
}

export interface SignedBundleInput {
  evidence: EvidencePackageInput
  timestamps: BundleTimestamp[]
  publicKeyPem: string
  fingerprint: string
  /** Signs the manifest bytes with the workspace key. */
  sign: (manifest: Uint8Array) => Uint8Array
  generatedAt: string
}

function viewDoc(input: SignedBundleInput): string {
  const stamped = input.timestamps.length
  return [
    '# Checking this bundle',
    '',
    `Format: ${BUNDLE_FORMAT}. Exported ${input.generatedAt}.`,
    '',
    'This is a Sheetbase export of one submitted revision. You do not need',
    'Sheetbase to check it.',
    '',
    '## Quick check',
    '',
    '    node verify.mjs --tsa-ca authority-root.pem --key-fingerprint aa:bb:...',
    '    ./verify.sh authority-root.pem',
    '',
    '`authority-root.pem` is the root certificate of the time-stamping authority',
    'named in `manifest.json`. Get it from the authority, not from this bundle.',
    'The key fingerprint is shown in Settings > Audit in the lab that exported',
    'this; compare it, because a key inside the bundle only proves the bundle',
    'is consistent with itself.',
    '',
    '## By hand',
    '',
    '    sha256sum -c checksums.sha256',
    '    openssl pkeyutl -verify -pubin -inkey public-key.pem -rawin \\',
    '      -in manifest.json -sigfile manifest.sig',
    '    openssl ts -verify -data signed/<id>.json -in signed/<id>.tsr \\',
    '      -CAfile authority-root.pem',
    '',
    '## What the checks show',
    '',
    '- The files are exactly what Sheetbase exported (manifest and signature).',
    stamped > 0
      ? `- ${stamped} signature record(s) were timestamped by an independent authority: the data in \`signed/*.json\` existed, unchanged, at the time in the token.`
      : '- No signature in this revision has a trusted timestamp, so there is no independent proof of when it was signed.',
    '- They do not say the results are right, and they make no claim of',
    '  compliance with any regulation.',
    '',
  ].join('\n')
}

export async function buildSignedBundle(
  input: SignedBundleInput,
): Promise<Uint8Array> {
  const writer = new ZipWriter()
  addEvidenceEntries(writer, input.evidence)

  const stamps: Array<{
    signatureId: string
    data: string
    token: string
    authority: string | null
    authorityUrl: string | null
    genTime: string | null
    serial: string | null
    signer: string | null
    imprint: string
  }> = []
  for (const t of [...input.timestamps].sort((a, b) =>
    a.signatureId.localeCompare(b.signatureId),
  )) {
    const data = `signed/${t.signatureId}.json`
    const token = `signed/${t.signatureId}.tsr`
    writer.add(data, t.signedData)
    writer.add(token, new Uint8Array(Buffer.from(t.responseB64, 'base64')))
    stamps.push({
      signatureId: t.signatureId,
      data,
      token,
      authority: t.authorityName,
      authorityUrl: t.authorityUrl,
      genTime: t.genTime,
      serial: t.serial,
      signer: t.signer,
      imprint: createHash('sha256').update(t.signedData).digest('hex'),
    })
  }

  writer.add('public-key.pem', input.publicKeyPem)
  writer.add('VERIFY.md', viewDoc(input))
  writer.add('verify.mjs', VERIFY_MJS)
  writer.add('verify.sh', VERIFY_SH)
  writer.add('checksums.sha256', await checksumLines(writer))

  const files = writer.entries().map(([path, data]) => ({
    path,
    sha256: createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
  }))
  const manifest = new TextEncoder().encode(
    JSON.stringify(
      {
        format: BUNDLE_FORMAT,
        generatedAt: input.generatedAt,
        workspaceId: input.evidence.revision.workspaceId,
        revisionId: input.evidence.revision.id,
        revisionIntegrityDigest: input.evidence.revision.integrityDigest,
        keyAlgorithm: 'ed25519',
        keyFingerprint: input.fingerprint,
        timestamps: stamps,
        files,
      },
      null,
      2,
    ),
  )
  writer.add('manifest.json', manifest)
  writer.add('manifest.sig', input.sign(manifest))
  return writer.stream()
}
