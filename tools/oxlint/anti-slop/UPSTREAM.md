# Vendored anti-slop

Source: https://github.com/dmmulroy/anti-slop

Pinned revision: `13909c9e07590f5a85d93c62712259fe14a883f7`

Retrieved on 9 November 2026. The root MIT `LICENSE` is retained verbatim.
The nested ESLint Stylistic implementation retains its own `LICENSE` and
`vendor/eslint-stylistic/UPSTREAM.md` provenance.

Copied byte-for-byte from upstream `src/`: `index.ts`, production files in
`rules/`, `shared/`, and `vendor/eslint-stylistic/`. Upstream tests, agent
assets, and the opt-in Effect plugin are not vendored. Sheetbase does not
depend directly on Effect. There are no local implementation changes.

All 18 generic rules are enabled at error severity in the root Oxlint config,
alongside native `oxc/no-accumulating-spread`. Oxlint and `@oxlint/plugins` are
pinned together at 1.93.0. Review upstream changes against this exact revision
before updating; preserve both licenses and record any local changes here.
