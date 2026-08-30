# Prompt — INT Integrations

Work on the active **INT — Integrations** epic in `phlohouse/sheetbase-eln`.

Read `docs/roadmap/NEXT.md`, `tasks/INT.md`, PC-00 findings and completed API/DATA foundations relevant to the active integration before editing.

## Objective

Connect external scientific and enterprise systems through a reusable connector/ingestion model rather than one-off bespoke paths.

## Principles

- generic connector execution, credentials, mapping, retry and provenance precede broad vendor-specific integrations;
- imported data enters canonical Dataset/Record/file contracts;
- credentials are encrypted/scoped and never exposed to clients unnecessarily;
- runs have durable status, errors and attribution;
- retries are idempotent where writes are consequential;
- instrument-specific parsing does not become a second data model;
- external identity mapping is explicit.

## Working method

Implement only the active INT epic. Confirm API/DATA prerequisites exist. Add connector security, retry, mapping, failure and provenance tests. Prefer one end-to-end representative integration before a wide connector catalogue.

## Do not

Do not implement generic Pipelines under the name of integrations. Do not hard-code scientific semantics into a vendor connector when they belong in Models/Schemas/mappings.

## Completion

Report connector contract, credentials/security, mapping, execution/retry semantics, provenance, representative integration proof, tests and remaining prerequisites.
