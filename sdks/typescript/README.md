# Sheetbase TypeScript SDK

A typed, isomorphic client for the [Sheetbase ELN](https://github.com/phlohouse/sheetbase-eln) public API.

Application and integration developers can consume the public contract through maintained types rather than internal app code. Uses the global `fetch` API — works in Node 18+ and all modern browsers.

## Install

```bash
npm install @sheetbase/eln-sdk
```

No runtime dependencies. Requires `fetch` (Node 18+ or browser).

This package targets public API contract `0.1.0`. The complete TypeScript /
Python operation inventory and shared wire-semantics decisions live in the
[SDK support matrix](../SUPPORT_MATRIX.md).

## Quick start

```ts
import { SheetbaseClient } from "@sheetbase/eln-sdk";

const client = new SheetbaseClient({
  baseUrl: "https://app.sheetbase.co.uk",
  credential: "sb_01234567_...",
  scopes: ["datasets:read", "datasets:write"],
});

// List projects
const projects = await client.projects.list();

// Query dataset rows
const page = await client.datasets.queryRows({ datasetId: "..." });

// Commit with idempotency
const result = await client.datasets.commitRows(
  "dataset-uuid",
  3, // expected revision
  [
    {
      operation: "create",
      rowId: crypto.randomUUID(),
      values: { "field-uuid": 1.2e9 },
    },
  ],
);

// Iterate all rows
for await (const row of client.datasets.iterRows("dataset-uuid")) {
  console.log(row.rowId, row.values);
}

client.close();
```

## Authentication

The SDK exchanges your credential (`sb_<prefix>_<secret>`) for a short-lived JWT (300s TTL) via `POST /api/token`, then injects it as `Authorization: Bearer` on every data request. Token refresh is automatic — the SDK refreshes 30s before expiry.

```ts
const client = new SheetbaseClient({
  baseUrl: "https://app.sheetbase.co.uk",
  credential: "sb_01234567_...",
  scopes: ["datasets:read", "datasets:write"],
});
```

Scopes are canonical capability strings from the [public API contract](https://github.com/phlohouse/sheetbase-eln/blob/main/docs/public-api-contract.md#8-proposed-credential-scopes-core-domain).

## Error handling

All errors extend `SheetbaseError`. The SDK maps the two error surfaces from the contract:

```ts
import { SheetbaseError, TokenError, StaleVersionError, NotFoundError } from "@sheetbase/eln-sdk";

try {
  await client.datasets.commitRows(...);
} catch (err) {
  if (err instanceof StaleVersionError) {
    // Optimistic concurrency mismatch — re-read and retry
  } else if (err instanceof NotFoundError) {
    // Resource missing
  } else if (err instanceof TokenError) {
    // Credential exchange failed
    console.error(err.code); // "invalid_credential", "insufficient_scope", etc.
  } else if (err instanceof SheetbaseError) {
    // Other data-path errors — check err.category
  }
}
```

### Stable error categories

| Category                    | Exception                      | HTTP    |
| --------------------------- | ------------------------------ | ------- |
| `validation_error`          | `ValidationError`              | 400     |
| `not_found`                 | `NotFoundError`                | 404     |
| `permission_denied`         | `PermissionDeniedError`        | 403     |
| `unauthenticated`           | `UnauthenticatedError`         | 401     |
| `stale_version`             | `StaleVersionError`            | 409     |
| `conflict`                  | `ConflictError`                | 409     |
| `missing_link`              | `MissingLinkError`             | 422     |
| `invalid_transition`        | `InvalidTransitionError`       | 422     |
| `invalid_properties`        | `InvalidPropertiesError`       | 422     |
| `template_not_instantiable` | `TemplateNotInstantiableError` | 422     |
| `rate_limited`              | `RateLimitedError`             | 429     |
| `service_unavailable`       | `ServiceUnavailableError`      | 502/503 |
| `server_error`              | `ServerError`                  | 500     |

## Resources

### Projects

```ts
await client.projects.list();
await client.projects.get("uuid");
await client.projects.getByKey("lenti-purification");
await client.projects.create("My Project");
await client.projects.update("uuid", { title: "New Title" });
for await (const p of client.projects.iter({ pageSize: 100 })) { ... }
```

### Records

```ts
await client.records.list({ kind: "experiment", projectId: "uuid" });
await client.records.get("uuid");
await client.records.create({ projectId: "...", kind: "experiment", title: "...", status: "in-progress" });
await client.records.update("uuid", { title: "..." });
await client.records.archive("uuid");
await client.records.restore("uuid");
await client.records.transitionStatus("uuid", "completed");
await client.records.createLink("source-uuid", "target-uuid");
for await (const r of client.records.iter({ pageSize: 100 })) { ... }

// Provenance — immutable revision trail (audit history, not live state)
await client.records.history("uuid");
for await (const rev of client.records.iterHistory("uuid")) { ... }
```

### Datasets

```ts
await client.datasets.list();
await client.datasets.get("uuid");
const page = await client.datasets.queryRows({ datasetId: "uuid" });
const versionPage = await client.datasets.queryVersionRows({ datasetVersionId: "uuid" });

// Validate before committing
const validation = await client.datasets.validateRows("uuid", 3, rows);
if (!validation.ok) console.error(validation.errors);

// Commit with automatic idempotency + stale-version retry
const result = await client.datasets.commitRows("uuid", 3, rows);

// Batch builder
const batch = new DatasetRowBatch();
batch.create({ "field-uuid": "value1" });
batch.create({ "field-uuid": "value2" });
batch.update("row-uuid", 1, { "field-uuid": "new-value" });
await client.datasets.commitRows("uuid", 3, batch);

// Iterate all rows
for await (const row of client.datasets.iterRows("uuid")) { ... }

// Snapshot, archive, restore
await client.datasets.snapshot("uuid", 3, "v1.0");
await client.datasets.archive("uuid");
await client.datasets.restore("uuid");

// Version access — frozen-evidence entry points
await client.datasets.listVersions("uuid");
for await (const v of client.datasets.iterVersions("uuid")) { ... }

// Bulk transfer — batched commits with revision chaining / expanded reads
await client.datasets.uploadRecords("uuid", 3, records, { batchSize: 500 });
const expanded = await client.datasets.downloadRecords("uuid");
const frozen = await client.datasets.downloadVersionRecords("version-uuid");

// Analysis ergonomics — field labels from the schema version
const fields = await client.datasets.schemaFields(dataset.schemaVersionId);
const labels = await client.datasets.fieldLabelMap(dataset.schemaVersionId);
const labelled = await client.datasets.downloadRecords("uuid", { fieldLabels: labels });
```

### Sheets

```ts
await client.sheets.list();
await client.sheets.get("uuid");
await client.sheets.create({ name: "My Sheet" });
await client.sheets.queryRows({ instanceId: "uuid" });
await client.sheets.update("uuid", 3, { name: "New Name" });
await client.sheets.archive("uuid");
await client.sheets.materialize("uuid", 3);
await client.sheets.mutateLocalState("uuid", 3, { ... });
for await (const row of client.sheets.iterRows("uuid")) { ... }
```

### Search

```ts
const page = await client.search.search({ query: "lentivector", kind: "experiment" });
await client.search.searchSheetRecords({ modelKey: "sample", query: "A" });
for await (const r of client.search.iter({ query: "exp", pageSize: 50 })) { ... }
```

### Catalogues (read-only)

```ts
await client.catalogues.listSchemaDefinitions();
await client.catalogues.listSchemaVersionFields({ schemaVersionId: "uuid" });
await client.catalogues.listSheetDefinitions();
await client.catalogues.listTemplates();
await client.catalogues.instantiateTemplate({
  templateVersionId: "uuid",
  projectId: "uuid",
});
```

### Agent operations and workflows

```ts
await client.agentOperations.propose({
  workspaceId: "uuid",
  title: "Create assay dataset schema",
  summary: "Prepare a bounded proposal for human approval",
  operation,
  provenance,
  idempotencyKey: "agent-run-42",
});

await client.agentOperations.createWorkflow({
  workspaceId: "uuid",
  goal: "Prepare and populate the assay dataset",
  plan,
  budget,
  initialUsage: { tokens: 0, costMicrousd: 0 },
  provenance,
  idempotencyKey: "workflow-run-42",
});
```

Operation, plan, provenance and budget objects retain their canonical contract
shape. The server remains authoritative for policy, validation, transitions,
budgets and scientific rules.

### Webhooks

```ts
await client.webhooks.createSubscription({
  workspaceId: "uuid",
  key: "analysis-complete",
  url: "https://integration.example/hooks/sheetbase",
  eventTypes: ["dataset.version.created"],
});

const deliveries = await client.webhooks.listDeliveries({
  workspaceId: "uuid",
  limit: 50,
  offset: 0,
});
```

### Public tables

Every allowlisted table operation is available through `tableGet`,
`tableHead`, `tablePost` and `tablePatch`. `tableHead` returns the
`Content-Range`, its parsed total when present, and the request id. Pass
`headers: { Prefer: "count=exact" }` when an exact total is required.

### Raw public RPC access

```ts
await client.rpc("query_dataset_rows", { dataset_id: "uuid", limit: 100 });
```

Only RPC names in the support matrix are supported. The server's external
allowlist remains authoritative and rejects private or unknown resources.

## Pagination

The SDK provides async generators for auto-pagination:

- `iterTable` — PostgREST `limit`/`offset` table reads (projects, records)
- `iterRpc` — RPC responses with `hasMore`/`totalCount` (datasets, search)

All `iter()` methods accept `pageSize` and `maxItems` options.

## Idempotency and concurrency

`commitRows` automatically generates an idempotency key (UUID). On `stale_version` (409), it re-reads the dataset revision and retries with a fresh key (up to 3 retries by default). Pass `retryOnStale: false` to disable.

## Browser/server safety

The SDK uses the global `fetch` API. No Node-specific APIs are used at runtime. The `crypto.randomUUID()` call in `DatasetRowBatch.create()` uses the Web Crypto API when available, with a fallback for older environments.

## Development

```bash
npm install
npm test          # run vitest
npm run typecheck # tsc --noEmit
```
