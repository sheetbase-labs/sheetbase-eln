# Lint tooling reference

`pnpm lint` runs strict, type-aware Oxlint followed by a full-project React
Doctor scan. Both commands fail on warnings or errors. CI runs the same checks
as separate `Lint` and `React Doctor` jobs so both reports remain available
when one fails. There is no baseline, changed-files filter, or warning budget.

## Versions and responsibilities

| Tool              | Exact version | Responsibility                                                   |
| ----------------- | ------------- | ---------------------------------------------------------------- |
| Oxlint            | 1.93.0        | Native correctness and import rules, generic anti-slop rules     |
| `@oxlint/plugins` | 1.93.0        | JavaScript plugin compatibility for anti-slop                    |
| `oxlint-tsgolint` | 7.0.2006      | Native type-aware rules through `--type-aware`                   |
| React Doctor      | 0.9.22        | Its complete default project diagnostics, including React checks |

`.oxlintrc.json` enables every generic anti-slop rule at error severity plus
`oxc/no-accumulating-spread`. The plugin's pinned upstream revision, unchanged
production files, and licences are recorded in [anti-slop/UPSTREAM.md](anti-slop/UPSTREAM.md).
The optional Effect plugin is not installed because Sheetbase does not depend
directly on Effect.

`doctor.config.json` disables adoption of the root Oxlint configuration.
React Doctor therefore reports its own default rules rather than duplicating
the anti-slop pass. No React Doctor rule is disabled. Its CLI always receives
`--scope full --blocking warning --no-score --no-telemetry --yes`.
These flags disable the score API, share URL, and crash reporting. The default
Socket.dev dependency scan remains enabled and can make network requests.
React Doctor retains its own compatible Oxlint dependency instead of sharing
or overriding the root Oxlint binary.

## Existing ESLint coverage

The migration replaces the effective `@tanstack/eslint-config` 0.4.0 rules,
including the previous local overrides. ESLint is no longer a direct
dependency or a lint command. React Doctor can retain ESLint-related packages
transitively for its own plugins.

- JavaScript correctness rules have native equivalents. Legacy `no-octal`
  has no separately named Oxlint rule. Oxlint's strict-module parser rejects
  legacy octal literals, verified with an exported `012` literal.
- TypeScript rules use the native `typescript/` equivalents with the same
  options. `no-for-in-array`, `no-unnecessary-condition`, and
  `no-unnecessary-type-assertion` run through `oxlint-tsgolint`. A CLI probe
  verified all three against invalid TypeScript, rather than configuration
  loading alone. Implementations differ from TypeScript-ESLint, so this is
  rule coverage, not a claim of identical diagnostics in every case.
- Import rules retain native equivalents and their options. The previous
  Node `prefer-node-protocol` check uses `unicorn/prefer-node-protocol`.
- The previous warnings for `no-shadow` and `prefer-for-of` are now errors.
  Native correctness-category rules also run at error severity.
- Two stylistic checks have no native equivalent and are not retained:
  TypeScript type-parameter `naming-convention` and Stylistic `spaced-comment`.
  Prettier still owns formatting, while anti-slop owns readable blank lines.
  Neither replaces those two exact checks.
- Previously disabled `array-type`, `require-await`, `import/order`, and
  `sort-imports` remain outside the explicit migrated rule set.

There is no compatibility ESLint step because the useful behavioural checks
have native coverage. The old ReUI rule relaxations are not carried forward:
runtime `src/components/reui/` code remains checked under the strict rules.

## Scope and exclusions

The Oxlint command preserves the old application, scripts, performance, and
root-config paths. React Doctor scans the full discovered projects, not just
changed files. Its normal generated-file and dependency discovery rules still
apply, as do the repository's existing ignore files.

Both configurations explicitly exclude only these additional sources:

- `tools/oxlint/anti-slop/**` is unchanged third-party tooling, not application
  code. It retains upstream formatting and both MIT licences.
- `docs/knowledge/design/ui-system-v3/runtime/dc-runtime.js` is an immutable,
  checksummed, browser-only historical design reference. The snapshot's
  [README](../../docs/knowledge/design/ui-system-v3/README.md) states that
  nothing there is imported by the application. This exclusion does not cover
  application runtime files, other documentation, or ReUI components.

Prettier's existing verbatim-snapshot exclusions remain unchanged. The
vendored plugin is not a format target. `pnpm format` runs Prettier and then
safe Oxlint fixes on first-party lint targets. It can change application
files and is not a scoped migration command. `pnpm check` verifies formatting
and retains the colour, copy, and validation-trace checks.

## Diagnostic commands

`pnpm lint:oxlint` and `pnpm lint:react` run independently. For a scoped Oxlint
report, `pnpm exec oxlint --type-aware --deny-warnings <paths>` uses the same
root configuration. Adding `--format json` produces machine-readable output.
For React Doctor, `pnpm lint:react --json --json-out <path>` writes a full
report without weakening its blocking policy.

`pnpm exec oxlint --print-config` validates native configuration. A real
source scan also validates JavaScript plugin loading and type-aware execution.
Configuration loading does not mean the repository has no violations.

## Workflow credential boundaries

The three initial `build-pipeline-secret-boundary` findings in `deploy-dev`,
`deploy`, and `sdk-release` were real credential overlap, not suppressions.
Their shared `install-private` action fetches locked dependencies with
`--ignore-scripts`, a step-scoped package-read token, and a temporary npm
configuration. An exit trap deletes that configuration even if installation
fails. A separate step runs `pnpm rebuild --pending` without the token.
Checkouts do not persist credentials in the Git configuration.

The two deployment workflows build images in package-read jobs. Separate
package-write publisher jobs receive one-day image archives and only load
and push them. Publishers do not check out source, install packages, run
build scripts, or execute the images. This extra job and artifact transfer
prevent background build processes from reading later publishing credentials
on the same runner. Deployed image references still come from registry
digests after the pushes.

The production SSH script also installs dependencies without lifecycle
scripts. It removes temporary npm and Docker credentials and unsets the
registry token before rebuilding, then loads production configuration for
the existing deployment controller. The development script removes its
temporary registry credentials immediately after pulling images.

Manual dispatch inputs, deployment confirmation checks, environment gates,
the production main-branch restriction, and readiness checks are unchanged.
Static workflow checks do not prove a deployment or registry push succeeds.
No workflow dispatch is part of lint validation.
