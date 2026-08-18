# Service-credential OpenAPI (API-03)

Authoritative OpenAPI 3.1 for the **API-key** surface that exists today.

| File                                                           | Role                                      |
| -------------------------------------------------------------- | ----------------------------------------- |
| [`service-credentials-v0.json`](./service-credentials-v0.json) | Published spec (OpenAPI 3.1)              |
| `src/lib/public-api-openapi.ts`                                | Builds the spec from the API-07 allowlist |
| `src/lib/public-api-openapi.test.ts`                           | Proves the file matches the allowlist     |

Regenerate after allowlist changes:

```bash
pnpm openapi:generate
```

## What is in the spec

Operations an API key can complete: `POST /api/token`, allowlisted `/api/db/{table}` reads (and the documented project-domain / Dataset INSERT writes), and allowlisted `/api/db/rpc/{name}` calls including Dataset/Sheet data-plane RPCs and `preview_submission_digest`.

Each data operation carries `x-sheetbase-scopes`.

## What is not in the spec

- Human-session-only: `submit_record_revision`, `run_revision_checks`, `sign_revision`, `create_amendment`
- `reviews:write` is not required by any operation
- Schema-authoring RPCs, file RPCs, scientific-table REST, `DELETE` on `projects`

Narrative contract: [`../public-api-contract.md`](../public-api-contract.md). Credential mechanics: [`../external-api.md`](../external-api.md).
