# SDK — SDK Product Maturity

**Status:** planned; begins only after Roadmap 2 API-04/05 establish initial Python and TypeScript SDKs.

## Programme goal

Turn the initial SDKs into durable first-class Sheetbase product surfaces.

## SDK-01 — Contract Coverage & Parity

### Goal
Bring SDK coverage into deliberate parity with the supported public API.

### Scope
- inventory public operations/resources against both SDKs;
- close meaningful coverage gaps;
- shared error/version/pagination semantics;
- parity tests generated from the public contract where useful.

### Exit
Supported public operations have an explicit SDK support matrix and intended parity is proven by tests.

## SDK-02 — Scientific Developer Ergonomics

### Goal
Make common scientific workflows concise and idiomatic.

### Scope
- Python dataframe/analysis-friendly helpers;
- TypeScript typed domain workflows;
- bulk transfer, version access and provenance-friendly helpers;
- examples that use canonical resources rather than internal routes.

### Exit
Representative scientific workflows can be completed idiomatically without hand-building HTTP or reproducing business logic locally.

## SDK-03 — Lifecycle, Compatibility & Release Quality

### Goal
Operate SDKs as maintained products.

### Scope
- package versioning/release automation;
- compatibility matrix with public API versions;
- deprecation/change policy once warranted;
- generated/reference docs, examples and smoke tests;
- stable exception/error taxonomy.

### Exit
SDK releases are reproducible, documented, compatibility-tested and usable independently of the Sheetbase application source tree.

## Boundaries

- SDKs wrap the public domain contract; they do not become a second source of business rules.
- Do not expose internal PostgREST resources merely to improve SDK convenience.
