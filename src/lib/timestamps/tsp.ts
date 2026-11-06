/**
 * RFC 3161 trusted timestamps: build a request for a SHA-256 imprint, send it
 * to a time-stamping authority, and check what comes back.
 *
 * Checks made here: the authority granted the request, the token's imprint is
 * the one we sent, the nonce is ours, and the token's CMS signature verifies
 * against the signer certificate carried in the token. Whether that
 * certificate chains to an authority you trust is a separate decision: pass
 * `trustedRoots` (PEM) to have it checked, or run the bundle's verify script
 * with the authority's CA file.
 */
import { X509Certificate, createHash, randomBytes, verify } from 'node:crypto'

import {
  DerError,
  derChildren,
  derConcat,
  derContent,
  derEncode,
  derEncodeOid,
  derEncodePositiveInteger,
  derInteger,
  derOid,
  derWhole,
  readDer,
} from './der'
import type { DerNode } from './der'

const OID_SHA256 = '2.16.840.1.101.3.4.2.1'
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4'
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4'

const HASH_BY_OID: Record<string, string> = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
}

export interface TimestampRequest {
  der: Uint8Array
  /** Hex of the 8 random bytes sent as the nonce. */
  nonce: string
}

/** A TimeStampReq asking for the authority's certificates to be included. */
export function buildTimestampRequest(imprintHex: string): TimestampRequest {
  if (!/^[0-9a-f]{64}$/.test(imprintHex)) {
    throw new Error('the imprint must be a SHA-256 digest in hex')
  }
  const imprint = Uint8Array.from(Buffer.from(imprintHex, 'hex'))
  const nonceBytes = randomBytes(8)
  nonceBytes[0] &= 0x7f
  const algorithm = derEncode(
    0x30,
    derConcat(derEncodeOid(OID_SHA256), Uint8Array.of(0x05, 0x00)),
  )
  const messageImprint = derEncode(
    0x30,
    derConcat(algorithm, derEncode(0x04, imprint)),
  )
  const der = derEncode(
    0x30,
    derConcat(
      Uint8Array.of(0x02, 0x01, 0x01),
      messageImprint,
      derEncodePositiveInteger(Uint8Array.from(nonceBytes)),
      Uint8Array.of(0x01, 0x01, 0xff),
    ),
  )
  return { der, nonce: nonceBytes.toString('hex').replace(/^0+(?=.)/, '') }
}

export interface TimestampInfo {
  /** The instant the authority attests to, ISO 8601 UTC. */
  genTime: string
  serial: string
  policy: string
  imprintHex: string
  nonce: string | null
  /** Subject of the certificate that signed the token. */
  signer: string
  signerIssuer: string
  /** True when the signer chains to one of the supplied trusted roots. */
  trusted: boolean | null
  /** Certificates carried in the token, PEM. */
  certificatesPem: string[]
}

export class TimestampError extends Error {}

function parseGeneralizedTime(text: string): string {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(?:\.(\d+))?Z$/.exec(text)
  if (!m) throw new TimestampError('unreadable time in the token')
  const millis = (m[7] ?? '').padEnd(3, '0').slice(0, 3) || '000'
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${millis}Z`
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function child(nodes: DerNode[], index: number): DerNode {
  const node = nodes[index]
  if (!node) throw new TimestampError('the token is incomplete')
  return node
}

/** Splits a TimeStampResp into the status and the bare token (ContentInfo). */
function splitResponse(resp: Uint8Array): { status: number; token: DerNode } {
  const top = readDer(resp, 0)
  if (top.tag !== 0x30) throw new TimestampError('not a timestamp response')
  const parts = derChildren(resp, top)
  const statusInfo = derChildren(resp, child(parts, 0))
  const status = Number(derInteger(resp, child(statusInfo, 0)))
  if (status !== 0 && status !== 1) {
    throw new TimestampError(`the authority refused the request (status ${status})`)
  }
  return { status, token: child(parts, 1) }
}

export interface VerifyOptions {
  expectedImprintHex: string
  expectedNonce?: string | null
  trustedRoots?: string[]
}

/** Verify a TimeStampResp (as returned by an authority) and read its facts. */
export function verifyTimestampResponse(
  resp: Uint8Array,
  options: VerifyOptions,
): TimestampInfo {
  try {
    return verifyInner(resp, options)
  } catch (error) {
    if (error instanceof DerError) {
      throw new TimestampError(`unreadable timestamp: ${error.message}`)
    }
    throw error
  }
}

function verifyInner(resp: Uint8Array, options: VerifyOptions): TimestampInfo {
  const { token } = splitResponse(resp)
  const tokenParts = derChildren(resp, token)
  if (derOid(resp, child(tokenParts, 0)) !== OID_SIGNED_DATA) {
    throw new TimestampError('the token is not signed data')
  }
  const signedData = derChildren(resp, child(derChildren(resp, child(tokenParts, 1)), 0))
  // version, digestAlgorithms, encapContentInfo, [0] certificates, [1] crls, signerInfos
  const encap = derChildren(resp, child(signedData, 2))
  if (derOid(resp, child(encap, 0)) !== OID_TST_INFO) {
    throw new TimestampError('the token does not carry timestamp information')
  }
  const eContentOctets = child(derChildren(resp, child(encap, 1)), 0)
  const tstBytes = derContent(resp, eContentOctets)
  const tst = readDer(tstBytes, 0)
  const tstParts = derChildren(tstBytes, tst)

  const policy = derOid(tstBytes, child(tstParts, 1))
  const imprintParts = derChildren(tstBytes, child(tstParts, 2))
  const imprintAlg = derOid(
    tstBytes,
    child(derChildren(tstBytes, child(imprintParts, 0)), 0),
  )
  const imprintHex = hex(derContent(tstBytes, child(imprintParts, 1)))
  if (imprintAlg !== OID_SHA256 || imprintHex !== options.expectedImprintHex) {
    throw new TimestampError('the timestamp is for different data')
  }
  const serial = derInteger(tstBytes, child(tstParts, 3)).toString(16)
  const genTime = parseGeneralizedTime(
    Buffer.from(derContent(tstBytes, child(tstParts, 4))).toString('ascii'),
  )
  let nonce: string | null = null
  for (const part of tstParts.slice(5)) {
    if (part.tag === 0x02) {
      nonce = derInteger(tstBytes, part).toString(16)
    }
  }
  if (options.expectedNonce != null && nonce !== options.expectedNonce) {
    throw new TimestampError('the response does not answer this request')
  }

  const certNodes: DerNode[] = []
  let signerInfosNode: DerNode | null = null
  for (const node of signedData.slice(3)) {
    if (node.tag === 0xa0) certNodes.push(...derChildren(resp, node))
    else if (node.tag === 0x31) signerInfosNode = node
  }
  if (!signerInfosNode) throw new TimestampError('the token has no signature')
  const certs: X509Certificate[] = []
  for (const node of certNodes) {
    try {
      certs.push(new X509Certificate(Buffer.from(derWhole(resp, node))))
    } catch {
      // A certificate Node cannot read is skipped; the signer is looked up below.
    }
  }

  const signerInfo = derChildren(
    resp,
    child(derChildren(resp, signerInfosNode), 0),
  )
  // version, sid, digestAlgorithm, [0] signedAttrs, signatureAlgorithm, signature
  const digestOid = derOid(
    resp,
    child(derChildren(resp, child(signerInfo, 2)), 0),
  )
  const hashName = HASH_BY_OID[digestOid]
  if (!hashName) throw new TimestampError('unsupported digest in the token')
  const attrsNode = child(signerInfo, 3)
  if (attrsNode.tag !== 0xa0) {
    throw new TimestampError('the token has no signed attributes')
  }
  const messageDigest = (() => {
    for (const attr of derChildren(resp, attrsNode)) {
      const parts = derChildren(resp, attr)
      if (derOid(resp, child(parts, 0)) === OID_MESSAGE_DIGEST) {
        return derContent(resp, child(derChildren(resp, child(parts, 1)), 0))
      }
    }
    return null
  })()
  if (!messageDigest) throw new TimestampError('the token has no message digest')
  const contentDigest = createHash(hashName).update(tstBytes).digest('hex')
  if (hex(messageDigest) !== contentDigest) {
    throw new TimestampError('the token content does not match its signature')
  }
  // The signature covers the attributes encoded as a SET (tag 0x31).
  const attrsBytes = Uint8Array.from(derWhole(resp, attrsNode))
  attrsBytes[0] = 0x31
  const signature = derContent(resp, child(signerInfo, 5))

  let signerCert: X509Certificate | null = null
  for (const cert of certs) {
    try {
      if (verify(hashName, attrsBytes, cert.publicKey, signature)) {
        signerCert = cert
        break
      }
    } catch {
      // Not the signer; try the next certificate.
    }
  }
  if (!signerCert) {
    throw new TimestampError('the signature on the timestamp does not verify')
  }

  let trusted: boolean | null = null
  if (options.trustedRoots && options.trustedRoots.length > 0) {
    trusted = chainsToRoot(signerCert, certs, options.trustedRoots)
  }
  return {
    genTime,
    serial,
    policy,
    imprintHex,
    nonce,
    signer: signerCert.subject.replaceAll('\n', ', '),
    signerIssuer: signerCert.issuer.replaceAll('\n', ', '),
    trusted,
    certificatesPem: certs.map((c) => c.toString()),
  }
}

function chainsToRoot(
  leaf: X509Certificate,
  carried: X509Certificate[],
  rootsPem: string[],
): boolean {
  const roots = rootsPem.flatMap((pem) => {
    try {
      return [new X509Certificate(pem)]
    } catch {
      return []
    }
  })
  let current = leaf
  for (let depth = 0; depth < 8; depth++) {
    for (const root of roots) {
      if (current.checkIssued(root) && current.verify(root.publicKey)) {
        return true
      }
    }
    const next = carried.find(
      (c) =>
        c !== current && current.checkIssued(c) && current.verify(c.publicKey),
    )
    if (!next) return false
    current = next
  }
  return false
}

export interface TimestampFetchDeps {
  fetch?: typeof fetch
  timeoutMs?: number
}

/** POST the request to an authority and return its raw TimeStampResp. */
export async function requestTimestamp(
  url: string,
  request: TimestampRequest,
  deps: TimestampFetchDeps = {},
): Promise<Uint8Array> {
  const doFetch = deps.fetch ?? fetch
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/timestamp-query' },
    body: request.der as unknown as BodyInit,
    signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
  })
  if (!res.ok) {
    throw new TimestampError(`the authority answered ${res.status}`)
  }
  const body = new Uint8Array(await res.arrayBuffer())
  if (body.length === 0 || body.length > 256 * 1024) {
    throw new TimestampError('the authority sent an unusable response')
  }
  return body
}
