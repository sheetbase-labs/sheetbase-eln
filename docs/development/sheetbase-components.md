# Consuming sheetbase-components

The ELN's v3 grids, charts and filter builder come from the sibling repository
`sheetbase-labs/sheetbase-components` (checked out next to this one as
`../sheetbase-components`). Its six library packages are **private** and publish
to **GitHub Packages**, scoped to the `sheetbase-labs` organisation — never to
public npm (DEC-12). The publishing side, the manifest `publishConfig` and the
release workflow are documented in
`sheetbase-components/docs/publishing.md`.

| Package                                     | Used for                         |
| ------------------------------------------- | -------------------------------- |
| `@sheetbase-labs/sheetbase-shared`          | field/query contracts, theme     |
| `@sheetbase-labs/sheetbase-table`           | the sheet grid                   |
| `@sheetbase-labs/sheetbase-explorer`        | charts and figures               |
| `@sheetbase-labs/sheetbase-advanced-search` | filter builder and chips         |
| `@sheetbase-labs/sheetbase-schemaeditor`    | schema editor (not consumed yet) |
| `@sheetbase-labs/sheetbase-rulesengine`     | rules engine (not consumed yet)  |

The first lockstep release published all six packages as `0.1.0` to GitHub
Packages (COMP-05). The ELN now consumes `shared`, `table`, `explorer` and
`advanced-search` at exact version `0.6.0`, resolved from the
registry and recorded with integrity in `pnpm-lock.yaml`. The schema editor and
the rules engine are not consumed yet. The committed `.npmrc` routes the scope;
the token arrives from the environment as described below.

## Local development against unreleased changes

Use a `link:` override so the ELN resolves the packages from the sibling
checkout. **Never commit it** — `package.json`, `pnpm-lock.yaml` and
`pnpm-workspace.yaml` must be clean in every PR.

```bash
# 1. Build the packages (their exports point at dist-lib)
cd ../sheetbase-components
bun install && bun run build:lib
```

Then, in this repository, point the packages at that checkout. pnpm reads
`overrides` from `pnpm-workspace.yaml`; add them locally (uncommitted):

```yaml
# pnpm-workspace.yaml (local only — remove before committing)
overrides:
  '@sheetbase-labs/sheetbase-shared': 'link:../sheetbase-components/packages/shared'
  '@sheetbase-labs/sheetbase-table': 'link:../sheetbase-components/packages/table'
  '@sheetbase-labs/sheetbase-explorer': 'link:../sheetbase-components/packages/explorer'
  '@sheetbase-labs/sheetbase-advanced-search': 'link:../sheetbase-components/packages/advanced-search'
```

An override only takes effect for a package that is also a dependency, so the
first time round add it directly as well and let the override redirect it:

```bash
pnpm add @sheetbase-labs/sheetbase-table@0.1.0   # then revert package.json/lockfile
pnpm install
pnpm ls @sheetbase-labs/sheetbase-table          # must resolve to ../sheetbase-components
```

Rebuild `dist-lib` after every components change (`bun run build:lib`, or the
package's `bun run dev` watch mode). Afterwards restore the working tree:

```bash
git restore package.json pnpm-lock.yaml pnpm-workspace.yaml
```

## Consuming from the registry

The committed `.npmrc` carries only the scope — never a credential:

```ini
@sheetbase-labs:registry=https://npm.pkg.github.com
```

pnpm 10 and later deliberately **ignore credentials in a project-level
`.npmrc`**, because a committed file must not be able to exfiltrate a secret to
a registry someone else controls. The token must therefore arrive from a trusted
source — the user-level `~/.npmrc`, or `pnpm config set`. One step covers every
case:

```bash
scripts/registry-auth.sh
```

It takes the token from `GITHUB_PACKAGES_TOKEN` (or `NODE_AUTH_TOKEN`, or
`GH_TOKEN`, falling back to `gh auth token`), writes
`//npm.pkg.github.com/:_authToken` into `~/.npmrc` at mode 0600, replaces any
previous entry, and never prints the value. In a managed agent or CI
environment, expose the platform secret as `GITHUB_PACKAGES_TOKEN` and run this
before `pnpm install`; the equivalent for a personal token is
`pnpm config set "//npm.pkg.github.com/:_authToken" <PAT>` with a classic token
carrying `read:packages`.

**In CI**, the built-in token both grants read access and is written to the
user-level `.npmrc` before installing. Jobs that run `pnpm install` need:

```yaml
permissions:
  contents: read
  packages: read

env:
  NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

steps:
  # …checkout, setup-node, setup-pnpm…
  - name: GitHub Packages auth
    run: echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> ~/.npmrc

  - run: pnpm install --frozen-lockfile
```

`GITHUB_TOKEN` reads the packages the `sheetbase-labs` organisation grants
the ELN repository access to. Repositories that publish a package from a
`repository`-linked manifest inherit access; otherwise grant it per package
under the package's _Manage Actions access_ settings.

Every workflow that installs dependencies carries this: `ci.yml` (all five
jobs), `deploy.yml` (`verify` and `build`, and the remote VPS install writes
the token from `GHCR_TOKEN` into `~/.npmrc` before `pnpm install`),
`deploy-dev.yml`, `sdk-release.yml` and `security.yml`. `packages: write`
already includes read where a job pushes images.

The ELN pins exact versions — no ranges — and regenerates `pnpm-lock.yaml` in
the same PR:

```json
"@sheetbase-labs/sheetbase-shared": "0.1.0",
"@sheetbase-labs/sheetbase-table": "0.1.0",
"@sheetbase-labs/sheetbase-explorer": "0.1.0",
"@sheetbase-labs/sheetbase-advanced-search": "0.1.0"
```

Peers and styles:

- `react@^19.2.0` / `react-dom@^19.2.0` already satisfy the packages' `>=18`
  peer range.
- `@tanstack/react-virtual` is declared `^3.14.10` — the range
  `@sheetbase-labs/sheetbase-table` requires — and `pnpm-lock.yaml` resolves
  3.14.13. Bumping the declaration is part of the same PR that adds the
  packages.
- `src/styles.css` imports the packages' styles once. Order matters:
  `@sheetbase-labs/sheetbase-table/styles.css` bundles the packages' **default**
  preset, so `@sheetbase-labs/sheetbase-shared/themes/v3.css` is imported after
  it to replace all 101 variables with the v3 values. Below both, the host
  mapping binds every package variable that has an ELN token onto that token
  (`--panel: var(--card)`, `--series-a: var(--chart-1)`, …). Its selectors are
  `:root`-prefixed, so it beats the preset's `:where(.sheetbase-scope)` rules
  whatever order the bundles land in, and its values are `var()` references, so
  `.dark` on `<html>` switches the packages with the ELN. Variables whose name
  and meaning already match an ELN token (`--border`, `--selection`, …) keep
  the v3 preset binding, and `--row-height` stays at the preset's 28px (the v3
  grid row, not the ELN's 32px list row). `src/lib/sheetbase-components.test.ts`
  pins the imports, the mapping and those exceptions.
- `src/routes/sheetbase-components.tsx` is a development-only demo (COMP-05
  Check-it) that renders the package grid inside that mapping; it redirects to
  `/` in production and is not part of the product navigation.

The dependency is only real when `pnpm install --frozen-lockfile` resolves it
from the registry in CI; a locally linked package is not evidence of that.

## Version bumps are ordinary PRs

The components packages release in lockstep: `bun run version:bump <semver>`
in `sheetbase-components`, a CHANGELOG entry, and a `v<semver>` tag whose
release workflow verifies, builds, pack-smokes and publishes all six packages
to GitHub Packages.

In the ELN, a version bump is a normal PR that:

1. moves every `@sheetbase-labs/sheetbase-*` dependency to the new exact
   version and regenerates `pnpm-lock.yaml`;
2. runs the parity suite, because a package release that changes a v3 screen
   must fail here rather than ship:

   ```bash
   pnpm test:parity          # design renders + Playwright parity project
   pnpm typecheck && pnpm lint && pnpm test
   ```

The parity project includes an unannotated installed-package comparison in
`tests/visual/package-parity.spec.ts`. It renders the States filter builder
through the development-only `/sheetbase-components` route in both themes.
`scripts/design-reference.mts` derives its expected 360 × 126 image from the
vendored States board, not from application screenshots.

Run the focused comparison after rendering its reference:

```bash
pnpm design:render States
pnpm exec playwright test --project=parity tests/visual/package-parity.spec.ts
```

Each test first requires the installed package to match at the project's
0.001 pixel-ratio tolerance. It then changes the package selector's padding
from 12px to 24px and requires the same screenshot assertion to reject the
result. This negative control cannot pass on an unrelated setup failure:
the clean comparison must pass first, and the rejection must report differing
pixels. No expected-failure annotation covers either comparison.

This proves rejection of simulated filter styling drift, not acceptance of
every package upgrade. The full-screen comparisons still have documented
expected failures, which can hide further drift. COMP-05 remains open until
the release gate covers those affected screens without that limitation.

The host imports the filter stylesheet into the existing `sheetbase` layer,
before the v3 preset. Package scopes read the root font values through
`--sb-host-font-sans` and `--sb-host-font-mono`, so they use the loaded
`Inter Variable` and `JetBrains Mono Variable` families instead of falling
back from the preset's different family names.

## Status

COMP-05 step 2 is done: the four packages are pinned at `0.6.0` in
`package.json`, resolved with integrity from GitHub Packages in
`pnpm-lock.yaml`, and `pnpm install --frozen-lockfile` succeeds with the token.
`pnpm 11`'s supply-chain policy adds each freshly published version to
`minimumReleaseAgeExclude` in `pnpm-workspace.yaml` when it is first installed;
those entries are what let a frozen install accept a new release, so they stay
until it ages past the policy window.

The ELN renders its sheets on `sheetbase-table` (COMP-06 — Handsontable is
removed) and its charts on `sheetbase-explorer` (COMP-07 — recharts is
removed). `sheetbase-advanced-search` is installed and its filter builder is
ported, but it is not yet mounted on the product list toolbars.

Still to do:

- Extend unannotated visual release coverage beyond the States filter builder.
  Full-screen DSYS-06 expected failures do not establish upgrade acceptance.
- `sheetbase-schemaeditor` and `sheetbase-rulesengine` are not consumed at all.
- The filter builder is not yet wired into the product lists.

The committed project `.npmrc` carries the scope only, so no pnpm command warns
about an ignored credential; `scripts/registry-auth.sh` writes the token to the
user-level `~/.npmrc`.
