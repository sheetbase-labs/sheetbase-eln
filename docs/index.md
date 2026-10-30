---
title: Sheetbase documentation
description: Run Sheetbase for your lab, and build on it.
---

Sheetbase is a scientific data workspace and electronic lab notebook. It is
self-hosted: you run it on your own server and your data stays in your own
PostgreSQL database.

## Run it for your lab

- [Running Sheetbase for your lab](operations/self-hosting.md): what to run, how
  people sign in, files, backups, restore and upgrades.
- [Configuration reference](operations/configuration.md): every setting and its
  default.
- [Authentication](operations/authentication.md): GitHub, company single
  sign-on and emailed links.
- [File storage](operations/file-storage.md) and
  [Workspace export and backups](operations/workspace-export-and-backups.md).
- [Recovery](operations/recovery.md) and [Deployment](operations/deployment.md).

## Use your data

- [Data access](operations/data-access.md): read-only SQL logins.
- [External API](api/external-api.md) and the
  [public API contract](api/public-api-contract.md).
- [Integrations](subsystems/integrations.md): instruments, parsers and
  connectors.

## Understand how it works

- [Administration](subsystems/administration.md) and
  [workspace roles](subsystems/governance-roles.md).
- [Pipelines](subsystems/pipelines.md) and
  [controlled protocols](subsystems/controlled-protocols.md).

## Develop on it

- [Development conventions](development/conventions.md),
  [database access](development/database-access.md),
  [migrations](development/migrations.md) and [testing](development/testing.md).
- Local setup is in the
  [README](https://github.com/sheetbase-labs/sheetbase-eln#local-development).
