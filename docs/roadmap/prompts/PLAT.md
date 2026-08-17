# Prompt — PLAT Platform, Operations & Security

Work on the active **PLAT — Platform, Operations & Security** epic in `phlohouse/sheetbase-eln`.

Read `docs/roadmap/NEXT.md`, `tasks/PLAT.md`, PC-00 operational/security findings, deployment docs and current CI/runtime infrastructure first.

## Objective

Make Sheetbase reliable, observable, recoverable and secure as a service without weakening the application-level scientific contracts.

## Principles

- immutable/repeatable deployment and migration procedures;
- tested backup and restore, not backup configuration alone;
- useful metrics/logs/traces with scientific/user secrets excluded;
- secrets remain server-side and rotatable;
- dependency/SAST/container/security controls are automated where practical;
- rate limiting and abuse controls protect public APIs without breaking legitimate bulk scientific work;
- operational admin surfaces do not bypass domain/RLS authority;
- performance work is measured against representative workflows.

## Working method

Implement only the active PLAT epic. Establish baseline evidence first, make changes reproducible in CI/deployment tooling, add failure/recovery tests where feasible and document operational procedures.

## Do not

Do not replace the product architecture with infrastructure complexity. Do not add managed services without a concrete need and ownership model. Do not log credentials, tokens or sensitive scientific payloads.

## Completion

Report operational capability, failure/recovery proof, security posture change, observability, performance evidence where relevant, tests and remaining operational risks.
