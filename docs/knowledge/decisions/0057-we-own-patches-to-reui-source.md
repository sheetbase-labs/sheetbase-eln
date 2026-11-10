# 0057. We now own patches to the adopted ReUI source

- **Status:** accepted
- **Date:** 2026-11-10
- **Ticket:** Oxlint, anti-slop and React Doctor migration
- **Supersedes:** ADR-0055 decision 2, the clause forbidding edits beyond import paths and token restyling

## Context

ADR-0055 pinned the ReUI registry to the Base UI build and installed its items
as copy-and-own source under `src/components/reui/**`. Decision 2 said that
directory "is not edited beyond import-path fixes and restyling to Sheetbase
tokens, which is why it carries its own scoped lint relaxation". Every installed
file repeats that instruction in its provenance header.

The strict lint migration changed the arithmetic. Against the whole ruleset the
directory produced 187 Oxlint findings and 60 React Doctor findings, and the
ones that matter are not style: a file-upload updater calls its change callback
from inside a React state updater, so StrictMode can deliver it twice, and the
stepper memoises on `ref.current`, so its trigger registration never re-runs.
Leaving the directory unexamined keeps those defects; exempting it from the
rules that found them hides them.

Two constraints now conflict: not editing the source, and not shipping code we
know is wrong. The owner chose the code, on 10 November 2026.

## Decision

`src/components/reui/**` is first-party-maintained source. It is linted and
fixed like the rest of `src`, including its React Doctor findings, and
restructured when a rule requires it.

What still holds from ADR-0055: the registry stays pinned to `@reui →
https://reui.io/r/base-nova/{name}.json`, items stay copy-and-own under that
directory, and ReUI is still never used for scientific surfaces.

## Consequences

- Each patched file records what diverged from the registry item and why, in the
  provenance header it already carries, so a future re-sync can see the delta
  instead of silently taking the upstream version over a fix.
- Updating a registry item is now a merge, not an overwrite: re-apply the local
  patches or move them upstream.
- The scoped lint relaxation added by the migration is removed; there is no
  directory-level exception for `src/components/reui/**` in `.oxlintrc.json` or
  `doctor.config.json`.
- The two defects ADR-0055's triage recorded rather than fixed are fixed here,
  with regression tests.
