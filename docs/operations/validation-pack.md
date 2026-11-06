# Validation pack (regulated labs)

Settings > Validation, shown when Regulated lab is on. It helps your own
validation team; it does not certify anything, and nothing in it says that
Sheetbase or your lab complies with a regulation or guideline.

## What it has

- **Checks run on your install.** Installation checks (database and migrations,
  roles, the API service, the clock, the address) and operation checks (audit
  trail chain, signed revisions, that audit entries and signatures cannot be
  changed, workspace isolation, session timeout, regulated settings, timestamps
  and the export key). Each result says what was done, what was expected, what
  was found, with the evidence.
- **A trace.** Each requirement is listed with the automated tests that cover it
  (found by `// @requirement VAL-...` lines in the tests) and the checks above
  that look at your install. `pnpm validation:trace` rebuilds it and
  `pnpm check` fails when it is out of date.
- **A pack.** `Download validation pack` gives a zip with a README, system
  facts, requirements and trace (CSV and Markdown), an IQ/OQ protocol with
  sign-off blocks for your people to fill in, recent runs, and the same offline
  verification scripts as a signed export bundle.

## Who can use it

Someone who manages the audit settings, in a workspace with Regulated lab on.
Runs are kept forever and cannot be edited.

## Verifying a pack

Unzip it, then `node verify.mjs` (Node only) or `sh verify.sh` (openssl 3 and
sha256sum). Both check every file against `checksums.sha256` and the manifest's
signature against `public-key.pem`. Compare the key fingerprint with the one
shown in Settings > Audit > Trusted timestamps.

## What the checks cannot see

They run from the server against its own database and settings. They do not
look at your network, your backups, your SOPs or how your people work; those
belong in your own validation plan.
