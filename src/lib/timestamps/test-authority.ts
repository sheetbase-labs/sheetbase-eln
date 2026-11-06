/**
 * A throwaway RFC 3161 authority for tests, built on the openssl command line.
 * It issues real tokens signed by a freshly made root, so the verifier is
 * exercised against genuine CMS output rather than hand-built bytes.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const opensslAvailable: boolean =
  spawnSync('openssl', ['version']).status === 0

const CONFIG = `
[ tsa ]
default_tsa = tsa_config1
[ tsa_config1 ]
dir = .
serial = $dir/serial
crypto_device = builtin
signer_cert = $dir/tsa.pem
certs = $dir/chain.pem
signer_key = $dir/tsa.key
signer_digest = sha256
default_policy = 1.2.3.4.1
digests = sha256, sha384
accuracy = secs:1
ordering = yes
tsa_name = yes
ess_cert_id_alg = sha256
[ v3_ca ]
basicConstraints = critical,CA:TRUE
keyUsage = keyCertSign
[ v3_tsa ]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,timeStamping
[ req ]
distinguished_name = dn
[ dn ]
`

export interface TestAuthority {
  dir: string
  rootPem: string
  /** Answers a DER TimeStampReq with a DER TimeStampResp. */
  reply: (request: Uint8Array) => Uint8Array
  /** A fetch that behaves like an authority endpoint. */
  fetch: typeof fetch
}

export function createTestAuthority(): TestAuthority {
  const dir = mkdtempSync(join(tmpdir(), 'sheetbase-tsa-'))
  const run = (args: string[]) =>
    execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' })
  writeFileSync(join(dir, 'tsa.cnf'), CONFIG)
  writeFileSync(join(dir, 'serial'), '01\n')
  run([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key',
    '-out', 'ca.pem', '-subj', '/CN=Sheetbase Test Root', '-days', '3650',
    '-config', 'tsa.cnf', '-extensions', 'v3_ca',
  ])
  run([
    'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'tsa.key', '-out',
    'tsa.csr', '-subj', '/CN=Sheetbase Test Timestamp Authority',
    '-config', 'tsa.cnf',
  ])
  run([
    'x509', '-req', '-in', 'tsa.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key',
    '-CAcreateserial', '-out', 'tsa.pem', '-days', '3650', '-extfile',
    'tsa.cnf', '-extensions', 'v3_tsa',
  ])
  writeFileSync(join(dir, 'chain.pem'), readFileSync(join(dir, 'ca.pem')))
  const reply = (request: Uint8Array): Uint8Array => {
    writeFileSync(join(dir, 'q.tsq'), request)
    run([
      'ts', '-reply', '-queryfile', 'q.tsq', '-config', 'tsa.cnf',
      '-section', 'tsa_config1', '-out', 'r.tsr',
    ])
    return new Uint8Array(readFileSync(join(dir, 'r.tsr')))
  }
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    const body = init?.body as Uint8Array
    return new Response(reply(body) as unknown as BodyInit, { status: 200 })
  }) as unknown as typeof fetch
  return {
    dir,
    rootPem: readFileSync(join(dir, 'ca.pem'), 'utf8'),
    reply,
    fetch: fakeFetch,
  }
}
