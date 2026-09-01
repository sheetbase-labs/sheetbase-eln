# SDK — SDK Product Maturity

**Status:** active; SDK-01 (contract coverage & parity) and SDK-02 (developer ergonomics) implemented on #101/#102, in review; SDK-03 (lifecycle, compatibility & release quality) implemented on #110, in review.

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

### Implemented contract (on #110, pending review/merge)

- **Release automation — encoded but currently paused.**
  `.github/workflows/sdk-release.yml` encodes the release gate: the root
  support-matrix contract test, a version match between the dispatched
  version and both package manifests, then per-SDK build/test/pack with
  artifact upload (`npm-pack` / `python-dist`). It never publishes and reads
  no secrets beyond `GITHUB_TOKEN`; publishing is a manual maintainer step.
  **Its `workflow_dispatch` trigger is deliberately commented out** (PLAT-03:
  this GitHub account cannot currently run hosted-runner jobs — dispatching
  would only produce a failed run). Until runners are restored, the documented
  local procedure in `sdks/RELEASE.md` is the operative release process; the
  trigger is uncommented as part of re-enabling hosted automation. The
  procedure — versioning rules, local validation commands, tagging — is
  documented in `sdks/RELEASE.md`, including the
  change/deprecation policy (taxonomy additions go through the support
  matrix in both SDKs; removals are breaking; no compatibility shims, per the
  pre-release rule).
- **Machine-checked compatibility.** `sdks/SUPPORT_MATRIX.md` gains a
  package-compatibility table (package version → supported contract
  version). Each SDK's own suite now asserts its exported `API_VERSION` /
  `apiVersion` equals the committed `docs/api/openapi/external-api-v0.json`
  `info.version` and that its error vocabularies equal
  `sdks/support-matrix.json`'s `contract` sets, so a contract bump without a
  matching SDK decision fails CI in both suites. The root
  `src/lib/sdk-support-matrix.test.ts` additionally asserts each package
  manifest version stays in step with the SDK source constants.
- **Stable error taxonomy proven by tests.** Both SDK suites assert the
  exported `TOKEN_ERROR_CODES` / `ERROR_CATEGORIES` surface equals the
  matrix (and therefore the server contract) exactly; accidental taxonomy
  drift fails the SDK suites and the root contract test.
- **Smoke tests.** `sdks/typescript/tests/smoke.test.ts` and
  `sdks/python/tests/test_smoke.py` drive the full critical path against a
  mock transport — token exchange once, bearer-authorised dataset row
  query, commit with an explicit idempotency key, stale-version retry
  re-reading the authoritative revision with a fresh key — asserting the
  `p_` wire envelope at every step (sync and async on Python).
- **Standalone usability.** `sdks/typescript/tsconfig.json` pins
  `rootDir: "src"`, so the package builds under the repo's TypeScript 6.0.3
  as well as the package's 5.9 toolchain (TS5011 fixed); the workflow imports
  the built `dist/` as a standalone consumer. The Python wheel installs and
  imports in an isolated environment (`uv run --isolated --no-project --with
dist/*.whl`), verified locally today and by the workflow once hosted runners are restored.

## Boundaries

- SDKs wrap the public domain contract; they do not become a second source of business rules.
- Do not expose internal PostgREST resources merely to improve SDK convenience.
