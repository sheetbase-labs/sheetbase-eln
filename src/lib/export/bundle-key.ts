/**
 * Keys for signing export bundles (Ed25519). Pure helpers; the stored pair is
 * read and made by bundle-key.server.ts.
 */
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto'

export interface WorkspaceKey {
  publicKeyPem: string
  privateKeyPem: string
  fingerprint: string
  createdAt: string
}

/** SHA-256 of the DER public key, hex, in groups of two for reading aloud. */
export function keyFingerprint(publicKeyPem: string): string {
  const der = createHash('sha256')
    .update(
      Buffer.from(
        publicKeyPem.replace(/-----[A-Z ]+-----|\s/g, ''),
        'base64',
      ),
    )
    .digest('hex')
  return der.match(/.{2}/g)!.join(':')
}

export function generateWorkspaceKeyPair(): {
  publicKeyPem: string
  privateKeyPem: string
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  }
}

/** Raw Ed25519 signature over the bytes. */
export function signWithKey(
  privateKeyPem: string,
  data: Uint8Array,
): Uint8Array {
  return new Uint8Array(sign(null, data, createPrivateKey(privateKeyPem)))
}
