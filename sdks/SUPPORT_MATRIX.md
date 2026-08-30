# SDK public-contract support matrix

[`support-matrix.json`](support-matrix.json) is the machine-readable coverage
decision for the Python and TypeScript SDKs. Its operation set must exactly
match the generated external OpenAPI contract at
[`docs/openapi/external-api-v0.json`](../docs/openapi/external-api-v0.json).
The root contract test rejects an added, removed, or changed public operation
until this matrix and both SDKs make an explicit matching decision.

## Support modes

| Mode        | Meaning                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automatic` | The transport performs credential exchange and refresh without a direct user call.                                                                             |
| `generic`   | The operation is available through the SDK's generic allowlisted table methods. Typed resource conveniences may also exist, but are not the coverage boundary. |
| `resource`  | A named method on the indicated resource wraps the public RPC in both SDKs.                                                                                    |

The matrix covers 1 token operation, every operation on all 24 public tables,
and all 59 public RPCs in contract version `0.1.0`. Python and TypeScript must
make the same support decision for every operation. Raw table and RPC helpers
cannot bypass the server's fail-closed external allowlist: private or unknown
resources remain unavailable.

Python decisions are package-level: `resource` means a named method on the
synchronous resource API. The asynchronous client exposes complete generic
table/RPC primitives plus typed resources where documented, but this matrix
does not claim method-for-method sync/async symmetry.

## Shared contract semantics

- **Version:** `API_VERSION` / `apiVersion` is the exact OpenAPI
  `info.version` (`0.1.0`). It describes the contract, not a URL prefix; public
  database paths remain under `/api/db`.
- **Errors:** token exchange uses the contract's `error.code` values; proxy
  failures use `error.category`. Both SDKs export the exact token-code and
  proxy-category sets and map known categories to language-idiomatic exception
  classes while retaining the message and optional request id.
- **Pagination:** table reads pass PostgREST `limit` and `offset` unchanged.
  Iterators advance by the number of returned rows and stop on a short page.
  `HEAD` exposes response headers plus the total parsed from
  `Content-Range`; callers request an exact total with
  `Prefer: count=exact`. Webhook delivery listing exposes its canonical RPC
  `limit` and `offset` parameters.
- **Idempotency:** dataset and sheet commit helpers retain their existing
  retry-safe idempotency behavior. Agent proposal/workflow creation and sheet
  materialization require the contract's idempotency key. Webhook creation is
  keyed by its canonical workspace subscription key. SDKs forward these
  values; they do not implement server state machines.
- **Wire format:** RPC parameter names use the contract's `p_snake_case`
  envelope. Nested canonical values (including camelCase agent operation,
  plan, provenance and budget JSON), enum/string values, optimistic revisions,
  filters and result JSON retain their documented casing and shape. Optional
  RPC parameters are omitted unless provided. Table insert/update helpers
  request `return=representation` when they construct a typed return object.

The server remains authoritative for validation, permissions, agent operation
policy, workflow transitions and budgets, webhook delivery behavior,
calculation semantics, and all scientific/domain rules. In particular, the
agent operation and workflow wrappers accept and return canonical JSON; they
do not duplicate those rules in an SDK. Dataframe/domain workflow conveniences
and release automation are outside this matrix.
