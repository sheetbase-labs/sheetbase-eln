# SDK release process

Both SDK packages (`@sheetbase/eln-sdk`, `sheetbase`) are versioned and
released as independent products. This document is the release procedure;
[`.github/workflows/sdk-release.yml`](../.github/workflows/sdk-release.yml)
is the automated build-and-verify gate.

## Versioning

- **Package versions** follow [SemVer](https://semver.org/). Both packages
  version together: a breaking change to either ships a major bump of both.
- **Package version ≠ contract version.** The supported public API contract
  (`docs/openapi/external-api-v0.json` `info.version`, surfaced as
  `API_VERSION` / `apiVersion` in each SDK) is recorded per release in
  [`SUPPORT_MATRIX.md`](SUPPORT_MATRIX.md) and machine-checked by the
  contract-parity tests. Bump the package version whenever you change the
  SDK; bump nothing about the contract unless the server contract changed.

## Change and deprecation policy

- **Error taxonomy is stable surface.** `TOKEN_ERROR_CODES`,
  `ERROR_CATEGORIES` and the per-category exception classes are public API.
  Additions require updating `sdks/support-matrix.json`, both SDKs, and the
  root `src/lib/sdk-support-matrix.test.ts` together; removals or renames are
  breaking changes and require a major version.
- **No compatibility shims.** Per the project pre-release rule (no production
  users): remove superseded development-era surface in the same release that
  replaces it rather than shipping aliases. Deprecation notices in the README
  are for released integrators only; they do not justify keeping dead code.
- **Server stays authoritative.** SDKs never duplicate validation, permission,
  agent-policy or scientific rules; a server-side change that alters wire
  shape is an SDK breaking change.

## Release procedure

1. **Update the compatibility record.** If the contract changed, regenerate
   and commit `docs/openapi/external-api-v0.json` (`pnpm openapi:generate`),
   update `sdks/support-matrix.json` and `SUPPORT_MATRIX.md`, and adjust both
   SDKs. The root matrix test fails until every decision is explicit.
2. **Bump both package versions** in
   `sdks/typescript/package.json` (`version`, keep `src/version.ts` `VERSION`
   in step) and `sdks/python/pyproject.toml` (`version`, keep
   `src/sheetbase/_version.py` `__version__` in step). The support-matrix
   tests fail if the package source and manifest drift apart.
3. **Validate locally** (all four must pass — see workflow for the same steps
   in CI):
   ```bash
   # TypeScript: tests, typecheck and a clean standalone build
   cd sdks/typescript && npm install && npm test && npm run build
   # Python: tests and a clean wheel/sdist build
   cd sdks/python && uv run --with pandas,httpx,pytest,respx,pytest-asyncio \
     --python 3.12 --with-editable . python -m pytest -q && uv build
   # Root contract gate
   npx vitest run src/lib/sdk-support-matrix.test.ts
   ```
4. **Run the release workflow.** Actions → _SDK release_ → _Run workflow_
   with the package version as input. It builds and tests both packages,
   builds the artifacts, verifies the smoke paths, and uploads the
   `npm-pack` and `python-dist` artifacts for the run. Nothing is published
   automatically.
5. **Publish manually** (maintainer with registry credentials):
   ```bash
   cd sdks/typescript && npm publish --access public   # @sheetbase/eln-sdk
   cd sdks/python && uvx twine upload dist/*           # sheetbase (PyPI)
   ```
6. **Tag the release** (`sdk-v<version>`) and update
   [`SUPPORT_MATRIX.md`](SUPPORT_MATRIX.md)'s compatibility table with the
   released package versions.

## Reproducibility

Artifacts are built from a clean checkout by the workflow with pinned tool
versions (Node 22 + repo `package-lock.json`; Python 3.12 via `uv build`).
Re-running the workflow on the same commit reproduces the same artifacts
byte-for-byte for the Python wheel/sdist; npm pack output is likewise
deterministic given the same source tree. Never publish from a dirty tree.
