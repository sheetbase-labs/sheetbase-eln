# SDK release process

Both SDK packages (`@sheetbase/eln-sdk`, `sheetbase`) are versioned and
released as independent products. This document is the release procedure.

[`.github/workflows/sdk-release.yml`](../.github/workflows/sdk-release.yml)
encodes the same build-and-verify gate for hosted automation. **It is
currently paused (PLAT-03): this GitHub account cannot run hosted-runner
jobs, so the workflow's `workflow_dispatch` trigger is commented out and the
workflow cannot run.** Until hosted runners are restored, the local commands
below — which mirror the workflow's steps exactly — are the operative
release process. Re-enabling the workflow is part of restoring hosted
automation: uncomment its `on:` block, then run it via Actions → _SDK
release_ → _Run workflow_.

## Versioning

- **Package versions** follow [SemVer](https://semver.org/). Both packages
  version together: a breaking change to either ships a major bump of both.
- **Package version ≠ contract version.** The supported public API contract
  (`docs/api/openapi/external-api-v0.json` `info.version`, surfaced as
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
   and commit `docs/api/openapi/external-api-v0.json` (`pnpm openapi:generate`),
   update `sdks/support-matrix.json` and `SUPPORT_MATRIX.md`, and adjust both
   SDKs. The root matrix test fails until every decision is explicit.
2. **Bump both package versions** in
   `sdks/typescript/package.json` (`version`, keep `src/version.ts` `VERSION`
   in step) and `sdks/python/pyproject.toml` (`version`, keep
   `src/sheetbase/_version.py` `__version__` in step). The support-matrix
   tests fail if the package source and manifest drift apart.
3. **Run the local release gate.** Every step below is mandatory and
   mirrors the workflow's jobs exactly (contract gate, version match,
   per-SDK build/test/pack, standalone smoke imports). The release is not
   valid until all of them pass:
   ```bash
   # Contract gate (workflow: contract job)
   npx vitest run src/lib/sdk-support-matrix.test.ts

   # Version match (workflow: contract job). Both manifests and both source
   # constants must declare the same version; substituting <VERSION> with
   # the version being released must not change the outcome.
   VERSION="$(node -p "require('./sdks/typescript/package.json').version")"
   PY_VERSION="$(sed -n 's/^version[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' \
     sdks/python/pyproject.toml)"
   test "$VERSION" = "$PY_VERSION"
   grep -q "export const VERSION = \"$VERSION\"" sdks/typescript/src/version.ts
   grep -q "__version__ = \"$VERSION\"" sdks/python/src/sheetbase/_version.py

   # TypeScript (workflow: typescript job): clean install from the lockfile,
   # tests, typecheck, build, standalone dist import, pack.
   cd sdks/typescript
   npm ci
   npm run typecheck && npm test && npm run build
   node --input-type=module -e "
     const m = await import('./dist/index.js');
     if (!m.SheetbaseClient || !m.API_VERSION) {
       throw new Error('built package does not export the public surface');
     }"
   npm pack --dry-run=false   # sheetbase-eln-sdk-<v>.tgz
   cd ../..

   # Python (workflow: python job): tests, wheel/sdist build, standalone
   # wheel import.
   cd sdks/python
   uv run --with pandas,httpx,pytest,respx,pytest-asyncio \
     --python 3.12 --with-editable . python -m pytest -q
   uv build --python 3.12
   uv run --python 3.12 --isolated --no-project \
     --with dist/*.whl python -c "import sheetbase; print('wheel import OK')"
   cd ../..
   ```
   Run the gate from a clean checkout on the release commit — `npm ci`
   fails on lockfile drift by design, and publishing from a dirty tree is
   forbidden.
4. **Publish manually** (maintainer with registry credentials):
   ```bash
   cd sdks/typescript && npm publish --access public   # @sheetbase/eln-sdk
   cd sdks/python && uvx twine upload dist/*           # sheetbase (PyPI)
   ```
5. **Tag the release** (`sdk-v<version>`) and update
   [`SUPPORT_MATRIX.md`](SUPPORT_MATRIX.md)'s compatibility table with the
   released package versions.

## Reproducibility

Artifacts are built from a clean checkout with pinned tool versions
(Node 22 + repo `package-lock.json`; Python 3.12 via `uv build`). Rebuilding
on the same commit runs the same tests over the same inputs, but the two
ecosystems differ in byte-level determinism:

- **Python (wheel/sdist):** reproducible. Hatchling normalises archive
  member metadata (timestamps, ordering), so `uv build` on the same commit
  produces byte-identical distributions.
- **TypeScript (`npm pack`):** *not* byte-reproducible across checkouts.
  npm does not normalise tarball mtimes/uids, so a fresh clone can produce a
  differently-encoded tarball for identical content. Treat npm artifacts as
  content-verified (clean build + standalone import smoke test), never
  claim byte-identity, and never publish from a dirty tree.
