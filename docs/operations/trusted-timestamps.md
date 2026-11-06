# Trusted timestamps and signed export bundles

## What it is for

A signature in Sheetbase says who signed which revision and when, but the "when"
comes from the install's own clock. With trusted timestamps switched on, an
independent time-stamping service (RFC 3161) confirms it: it signs a statement
that a given fingerprint existed at a given moment. Anyone can check that
statement later with openssl, without Sheetbase and without trusting this
install.

It does not make a result correct and it is not a compliance claim. It shows
that a signature record existed unchanged at the time the service states.

## Setting it up

Settings > Audit > Trusted timestamps (needs audit access).

| Choice         | Service                          |
| -------------- | -------------------------------- |
| DFN-Verein     | `https://zeitstempel.dfn.de`     |
| DigiCert       | `http://timestamp.digicert.com`  |
| My own service | Any RFC 3161 service, by address |

Check the service's terms and rate limits before relying on one: the public
services are free but carry no promise. A lab that needs one can run its own
(`openssl ts` can act as a small one) or buy a qualified service.

It is off by default and **outbound**: once on, the server sends each new
signature's SHA-256 fingerprint (not the signature, the record or any data) to
the chosen address. An install behind a firewall needs that address allowed
outbound.

## How it works

- Every minute the server finds signatures in workspaces that have it on, builds
  a fixed description of each (ids, revision digest, meaning, time), and sends
  the SHA-256 of it with a random nonce.
- The answer is checked (right fingerprint, right nonce, the service's signature
  over the token) and stored beside the signature.
- A failed try is repeated after 5, 15, 45 minutes and so on. After six failures
  the signature is marked "Gave up", an event is sent, and an admin can ask again
  from the same panel. The signature itself is unaffected.
- Several servers on one database are fine; the first stamp stands.

The app checks the token's signature but does not decide whether to trust the
service; that is for the person verifying (they supply the service's root
certificate).

## Signed export bundles

On a record's History, "signed bundle" next to "evidence ZIP" downloads the
evidence package plus:

- `signed/<signature>.json` and `.tsr`: the stamped data and the service's answer
- `manifest.json`: SHA-256 of every file
- `manifest.sig` and `public-key.pem`: an Ed25519 signature over the manifest from
  the workspace's export key
- `verify.mjs` (Node 18+) and `verify.sh` (openssl 3 and sha256sum)

```
node verify.mjs --tsa-ca authority-root.pem --key-fingerprint aa:bb:...
```

Get the key fingerprint from Settings > Audit > Trusted timestamps in the lab
that exported the bundle (a key inside the bundle only proves the bundle agrees
with itself). Get the authority's root certificate from the authority.

The export key is made the first time a bundle is downloaded. Its private half
lives in the database (`internal.workspace_signing_keys`) and is covered by your
backups; protect backups accordingly. There is no key rotation yet: to replace
a key, delete its row and the next download makes a new one (older bundles keep
verifying against the key inside them).
