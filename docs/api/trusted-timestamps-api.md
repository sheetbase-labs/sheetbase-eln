# Trusted timestamps and signed bundles

A workspace can ask an independent time-stamping service (RFC 3161) to vouch
for when each signature was made. This page is the API for reading the result
and for asking again. For what it means and how to set it up, see
[`../operations/trusted-timestamps.md`](../operations/trusted-timestamps.md).

Nothing is sent anywhere until an admin chooses a service. Only a SHA-256
fingerprint of the signature record leaves the install.

## Reading timestamps

`GET /api/db/signature_timestamps` (scope `reviews:read`). One row per signature
that has been queued or stamped.

| Column                                      | Meaning                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `signature_id`, `revision_id`               | What was timestamped                                                                   |
| `status`                                    | `pending` (waiting or retrying), `stamped`, or `failed` (gave up after six tries)      |
| `signed_data`                               | The exact bytes a fingerprint was made of                                              |
| `imprint_sha256`                            | SHA-256 of `signed_data`; this is what the service stamped                             |
| `response_b64`                              | The service's answer (DER `TimeStampResp`, base64)                                     |
| `authority_name`, `authority_url`           | Which service                                                                          |
| `gen_time`, `serial`, `signer`              | The time the service attests to, its serial number, and the certificate that signed it |
| `attempts`, `last_error`, `next_attempt_at` | Retry state                                                                            |

To check one without Sheetbase: write `response_b64` (decoded) to `token.tsr`,
`signed_data` to `data.json`, get the service's root certificate from the
service, then

```
openssl ts -verify -data data.json -in token.tsr -CAfile authority-root.pem
```

## Calls

| Call                                           | Scope           | What it does                                                           |
| ---------------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `POST /api/db/rpc/timestamp_settings`          | `admin:read`    | Which service the workspace uses, if any                               |
| `POST /api/db/rpc/set_timestamp_settings`      | `admin:write`   | Choose `dfn`, `digicert` or `custom` (with an address), or turn it off |
| `POST /api/db/rpc/request_signature_timestamp` | `reviews:write` | Queue a signature that has no stamp or gave up. Needs audit access     |
| `POST /api/db/rpc/workspace_signing_key`       | `reviews:read`  | The public half of the workspace's export key and its fingerprint      |

Choosing a service and asking again act as a person, so they need a personal
token and that person's own audit access.

## Signed bundle download

`GET /api/export/revision/$id/bundle` (browser session) returns a ZIP: the
evidence package, every stamped signature's data and token, a manifest of
SHA-256 digests, an Ed25519 signature over that manifest, the public key, and
`verify.mjs` / `verify.sh`. The bundle's `VERIFY.md` explains the checks. The
download is recorded in the export receipts like the other exports.

## Events

`signature.timestamped`, `signature.timestamp_failed` and
`workspace.timestamping.updated`; see [`event-catalogue.md`](event-catalogue.md).
