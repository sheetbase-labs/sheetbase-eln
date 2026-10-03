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
Packages (COMP-05). The ELN consumes four of them — `shared`, `table`,
`explorer` and `advanced-search` — at that exact version, resolved from the
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

The committed `.npmrc` routes the scope to GitHub Packages and states, without
a value, where the token comes from:

```ini
@sheetbase-labs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

pnpm 10 and later deliberately **ignore credentials in a project-level
`.npmrc`** (including `${NODE_AUTH_TOKEN}` placeholders), so that a committed
file cannot exfiltrate a secret to a registry someone else controls. Every pnpm
command therefore warns about the second line, and the token must arrive from a
trusted source instead:

- **Locally**, run
  `pnpm config set "//npm.pkg.github.com/:_authToken" <PAT>` with a personal
  access token (classic) with `read:packages` (or put the line in `~/.npmrc`).
- **In CI**, the built-in token both grants read access and is written to the
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

The parity suite is the release gate: a components release is only adopted once
the ELN renders match the v3 design renders in both themes.

## Status

COMP-05 step 2 is done: the four packages are pinned at `0.1.0` in
`package.json`, resolved with integrity from GitHub Packages in
`pnpm-lock.yaml`, and `pnpm install --frozen-lockfile` succeeds with the token.
`pnpm 11`'s supply-chain policy added the four freshly published packages to
`minimumReleaseAgeExclude` in `pnpm-workspace.yaml` when they were first
installed; those entries are what let a frozen install accept them, so they
stay until the releases age past the policy window.

Still to do:

- The sheet surfaces run on `sheetbase-table` (COMP-06) and the charts on
  `sheetbase-explorer` (COMP-07). `sheetbase-advanced-search` is installed but
  not rendered yet — wiring its filter builder into the product is COMP-06.
- `sheetbase-schemaeditor` and `sheetbase-rulesengine` are not consumed at all.
- Every pnpm command still prints the ignored project-level credential warning
  from `.npmrc` while the placeholder line is committed. It is harmless — the
  token comes from the user-level `~/.npmrc` (or `pnpm config set`) — and the
  warning disappears only if that line is dropped in favour of documenting the
  token source.
