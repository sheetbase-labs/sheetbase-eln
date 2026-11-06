/**
 * The verifier scripts that travel inside a signed export bundle. They use
 * only Node's standard library (verify.mjs) or openssl and sha256sum
 * (verify.sh), so a bundle can be checked years later on a machine that has
 * never heard of Sheetbase.
 */

export const VERIFY_MJS = `#!/usr/bin/env node
// Checks a Sheetbase signed export bundle. Needs Node 18 or newer, no packages.
//
//   node verify.mjs [--tsa-ca authority-root.pem] [--key-fingerprint aa:bb:...]
//
// 1. every file matches the sha256 in manifest.json
// 2. manifest.json carries a valid Ed25519 signature from public-key.pem
// 3. each stamped signature record has a timestamp token for exactly that data
//    (with --tsa-ca, openssl also checks the authority's signature)
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : null
}
const caFile = option('--tsa-ca')
const expectedFingerprint = option('--key-fingerprint')
let failures = 0
const report = (ok, message) => {
  if (!ok) failures++
  console.log((ok ? 'ok      ' : 'FAILED  ') + message)
}
const note = (message) => console.log('note    ' + message)
const read = (path) => readFileSync(join(root, path))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// --- 1 and 2: the manifest and its signature --------------------------------
const manifestBytes = read('manifest.json')
const manifest = JSON.parse(manifestBytes.toString('utf8'))
for (const file of manifest.files) {
  const present = existsSync(join(root, file.path))
  const okHash = present && sha256(read(file.path)) === file.sha256
  report(okHash, file.path)
}
const publicKeyPem = read('public-key.pem').toString('utf8')
const signatureOk = verify(
  null,
  manifestBytes,
  createPublicKey(publicKeyPem),
  read('manifest.sig'),
)
report(signatureOk, 'manifest.json is signed by public-key.pem')
const der = Buffer.from(publicKeyPem.replace(/-----[A-Z ]+-----|\\s/g, ''), 'base64')
const fingerprint = sha256(der).match(/.{2}/g).join(':')
report(fingerprint === manifest.keyFingerprint, 'key fingerprint ' + fingerprint)
if (expectedFingerprint) {
  report(
    expectedFingerprint.toLowerCase() === fingerprint,
    'key fingerprint is the one you expected',
  )
} else {
  note('compare that fingerprint with the one in Settings > Audit of the lab it came from')
}

// --- 3: the timestamps -------------------------------------------------------
function kids(buf, start, end) {
  const out = []
  let at = start
  while (at < end) {
    let len = buf[at + 1]
    let content = at + 2
    if (len & 0x80) {
      const count = len & 0x7f
      len = 0
      for (let i = 0; i < count; i++) len = len * 256 + buf[content + i]
      content += count
    }
    out.push({ tag: buf[at], content, end: content + len })
    at = content + len
  }
  return out
}
function readToken(tsr) {
  const top = kids(tsr, 0, tsr.length)[0]
  const parts = kids(tsr, top.content, top.end)
  const contentInfo = kids(tsr, parts[1].content, parts[1].end)
  const signedData = kids(tsr, contentInfo[1].content, contentInfo[1].end)[0]
  const sd = kids(tsr, signedData.content, signedData.end)
  const encap = kids(tsr, sd[2].content, sd[2].end)
  const octets = kids(tsr, encap[1].content, encap[1].end)[0]
  const tst = kids(tsr, octets.content, octets.end)[0]
  const fields = kids(tsr, tst.content, tst.end)
  const imprint = kids(tsr, fields[2].content, fields[2].end)[1]
  return {
    imprint: tsr.subarray(imprint.content, imprint.end).toString('hex'),
    genTime: tsr.subarray(fields[4].content, fields[4].end).toString('ascii'),
  }
}
const stamps = manifest.timestamps || []
if (stamps.length === 0) note('no signature in this bundle has a timestamp')
for (const stamp of stamps) {
  const data = read(stamp.data)
  const tsr = read(stamp.token)
  let token
  try {
    token = readToken(tsr)
  } catch (error) {
    report(false, stamp.token + ' could not be read')
    continue
  }
  report(
    token.imprint === sha256(data),
    stamp.data + ' is the data the authority timestamped (' + token.genTime + ')',
  )
  if (caFile) {
    const run = spawnSync('openssl', ['ts', '-verify', '-data', join(root, stamp.data), '-in', join(root, stamp.token), '-CAfile', caFile], { encoding: 'utf8' })
    report(run.status === 0, stamp.token + ' is signed by an authority chaining to ' + caFile)
  }
}
if (stamps.length > 0 && !caFile) {
  note('the authority\\'s own signature was not checked: pass --tsa-ca with its root certificate')
}

console.log(failures === 0 ? '\\nBundle verified.' : '\\n' + failures + ' check(s) failed.')
process.exit(failures === 0 ? 0 : 1)
`

export const VERIFY_SH = `#!/bin/sh
# Checks a Sheetbase signed export bundle with sha256sum and openssl 3 only.
#
#   ./verify.sh [authority-root.pem]
#
# Without the authority's root certificate the timestamps are checked for the
# data they cover but not for the authority's own signature.
set -u
cd "$(dirname "$0")" || exit 2
fail=0

echo "== files"
sha256sum -c checksums.sha256 --quiet && echo "ok      every file matches checksums.sha256" || fail=1

echo "== manifest signature"
if openssl pkeyutl -verify -pubin -inkey public-key.pem -rawin -in manifest.json -sigfile manifest.sig >/dev/null 2>&1; then
  echo "ok      manifest.json is signed by public-key.pem"
else
  echo "FAILED  manifest.json signature"; fail=1
fi
echo "key fingerprint (sha256 of the DER key):"
openssl pkey -pubin -in public-key.pem -outform DER | sha256sum | cut -d' ' -f1

echo "== timestamps"
for token in signed/*.tsr; do
  [ -e "$token" ] || { echo "note    no timestamps in this bundle"; break; }
  data="\${token%.tsr}.json"
  if [ $# -ge 1 ]; then
    openssl ts -verify -data "$data" -in "$token" -CAfile "$1" >/dev/null 2>&1 \\
      && echo "ok      $token verifies against $1" || { echo "FAILED  $token"; fail=1; }
  else
    want=$(sha256sum "$data" | cut -d' ' -f1)
    got=$(openssl ts -reply -in "$token" -text 2>/dev/null \\
      | awk '/Message data:/{f=1;next} /Serial number/{f=0} f' \\
      | sed 's/^ *[0-9a-f]* - //; s/   .*$//' | tr -d ' \\n-')
    if [ "$got" = "$want" ]; then
      echo "ok      $token covers $data (authority signature not checked)"
    else
      echo "FAILED  $token does not cover $data"; fail=1
    fi
  fi
done

[ "$fail" -eq 0 ] && echo "Bundle verified." || echo "Some checks failed."
exit $fail
`
