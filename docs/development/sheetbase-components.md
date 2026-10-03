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

Nothing is published yet, so the ELN does not depend on any of them: the
committed `.npmrc` and the registry path below are inert until the first
lockstep release. Until then, use the local link path in the next section.

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

Once `0.1.0` is released, add these exact versions to `dependencies` (no
ranges — the ELN pins exact versions) and commit the regenerated
`pnpm-lock.yaml` in the same PR:

```json
"@sheetbase-labs/sheetbase-shared": "0.1.0",
"@sheetbase-labs/sheetbase-table": "0.1.0",
"@sheetbase-labs/sheetbase-explorer": "0.1.0",
"@sheetbase-labs/sheetbase-advanced-search": "0.1.0"
```

Peers and styles:

- `react@^19.2.0` / `react-dom@^19.2.0` already satisfy the packages' `>=18`
  peer range.
- `@tanstack/react-virtual` is declared `^3.14.9` here but is **pinned to
  3.14.9** in `pnpm-lock.yaml`, while `@sheetbase-labs/sheetbase-table`
  requires `^3.14.10`. Bump it in the same PR that adds the packages
  (`pnpm up @tanstack/react-virtual`), or pnpm reports an unmet peer.
- Import the styles once from `src/styles.css`: the default preset
  (`@sheetbase-labs/sheetbase-shared/theme.css`) is not wanted here — load
  `@sheetbase-labs/sheetbase-shared/themes/v3.css` and map its variables onto
  the ELN tokens, plus `@sheetbase-labs/sheetbase-table/styles.css`.

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

## Still to do

- The first `v0.1.0` tag has not been pushed, so no version exists to install;
  the local `link:` path above is the only way to consume the packages today.
- When the dependencies land, add `packages: read`,
  `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and the
  `echo … >> ~/.npmrc` step above to every workflow that installs packages:
  `.github/workflows/ci.yml`, `deploy.yml`, `deploy-dev.yml`,
  `sdk-release.yml` and `security.yml`.
- Until then, every pnpm command prints the ignored project-level credential
  warning from `.npmrc`; it is harmless (no `@sheetbase-labs/*` package is
  requested yet) and disappears from the output only if the placeholder line is
  dropped in favour of documenting the token source.
